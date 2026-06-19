import jupApi from './jupApi.js';
import { getOpenOrders, updateOrderPrice, getPendingLimitOrders, createOrder, updateLimitOrderStatus, markOrderTpAlerted } from './db.js';
import { formatToWIB } from './helpers/time.js';
import { SECRETS, CONFIG } from './config.js';
import { formatMcap } from './helpers/format.js';

/**
 * Periodically updates the current prices and market caps of all orders in the database.
 * Executes once every hour (or as configured).
 */
export async function monitorOrders() {
  console.log('[Order Monitor] Starting order price update check...');
  
  // 1. Check/execute pending limit orders first
  await checkLimitOrders();

  // 2. Update prices for regular orders
  const orders = getOpenOrders();
  if (orders.length > 0) {
    console.log(`[Order Monitor] Found ${orders.length} order(s) to check.`);
    for (const order of orders) {
      try {
        console.log(`[Order Monitor] Fetching latest price for ${order.symbol} (${order.address})...`);
        const details = await jupApi.searchAsset(order.address);
        if (details) {
          const currentPrice = details.usdPrice || 0;
          const currentMcap = details.mcap || 0;

          updateOrderPrice(order.id, currentPrice, currentMcap);
          console.log(`[Order Monitor] Updated ${order.symbol} (#${order.id}): Price = $${currentPrice.toFixed(8)}, Mcap = $${formatMcap(currentMcap)}`);

          // Check if Take Profit percentage is achieved and not yet alerted
          const buyPrice = order.price_usd || 0;
          const priceChangePct = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;
          const minTp = CONFIG.minTakeProfitPercent ?? 50;

          if (priceChangePct >= minTp && !order.tp_alerted) {
            console.log(`[Order Monitor] Take Profit met for ${order.symbol} (#${order.id}): ${priceChangePct.toFixed(2)}% >= ${minTp}%`);
            
            const targetId = SECRETS.TELEGRAM_CHAT_ID;
            const url = `https://api.telegram.org/bot${SECRETS.TELEGRAM_BOT_TOKEN}/sendMessage`;
            const modalUsd = order.buy_amount_usd || 0;
            const tokenQty = order.token_qty || 0;
            const currentValueUsd = tokenQty * currentPrice;
            const pnlUsd = currentValueUsd - modalUsd;

            let alertMsg = `🎯 *Take Profit Achieved! (Dry Run)*\n\n`;
            alertMsg += `📦 *Order ID:* \`#${order.id}\`\n`;
            alertMsg += `🪙 *Token:* \`${order.symbol || 'N/A'}\` (${order.name || 'N/A'})\n`;
            alertMsg += `🔗 *Address:* \`${order.address}\`\n`;
            alertMsg += `💵 *Initial Capital:* \`$${modalUsd.toFixed(2)}\` (${tokenQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
            alertMsg += `💰 *Entry Price:* \`$${buyPrice.toFixed(8)}\` (Mcap: \`$${order.mcap ? formatMcap(order.mcap) : 'N/A'}\`)\n`;
            alertMsg += `📈 *Current Price:* \`$${currentPrice.toFixed(8)}\` (Mcap: \`$${currentMcap ? formatMcap(currentMcap) : 'N/A'}\`)\n`;
            alertMsg += `🟢 *PnL:* \`+${priceChangePct.toFixed(2)}%\` (\`+$${pnlUsd.toFixed(2)}\`)\n`;
            alertMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n`;

            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: targetId,
                text: alertMsg,
                parse_mode: 'Markdown'
              })
            })
            .then(() => {
              markOrderTpAlerted(order.id);
              console.log(`[Order Monitor] Telegram take profit alert sent for ${order.symbol} (#${order.id})`);
            })
            .catch(err => console.error('[Order Monitor] Telegram notification failed:', err.message));
          }
        } else {
          console.warn(`[Order Monitor] Could not fetch details for ${order.symbol} (${order.address}).`);
        }
        
        // Delay slightly between requests to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`[Order Monitor] Error updating price for order #${order.id} (${order.symbol}):`, error.message);
      }
    }
  } else {
    console.log('[Order Monitor] No active orders to update.');
  }

  console.log('[Order Monitor] Order price update check completed.');
}

/**
 * Checks all pending limit orders and executes them if market cap drops below target.
 */
export async function checkLimitOrders() {
  console.log('[Limit Order Monitor] Checking pending limit orders...');
  const pending = getPendingLimitOrders();
  if (pending.length === 0) {
    console.log('[Limit Order Monitor] No pending limit orders.');
    return;
  }

  console.log(`[Limit Order Monitor] Found ${pending.length} pending limit order(s).`);

  for (const order of pending) {
    try {
      console.log(`[Limit Order Monitor] Checking ${order.address} for limit mcap: $${order.limit_mcap.toLocaleString()}`);
      const details = await jupApi.searchAsset(order.address);
      if (!details) {
        console.warn(`[Limit Order Monitor] Could not fetch details for address ${order.address}`);
        continue;
      }

      const currentMcap = details.mcap || 0;
      const currentPrice = details.usdPrice || 0;

      console.log(`[Limit Order Monitor] Token Mcap: $${currentMcap.toLocaleString()} (Limit: $${order.limit_mcap.toLocaleString()})`);

      if (currentMcap <= order.limit_mcap) {
        console.log(`[Limit Order Monitor] Limit triggered! Executing order for ${details.symbol}`);

        const buyAmount = order.buy_amount_usd;
        const tokenQty = currentPrice > 0 ? (buyAmount / currentPrice) : 0;

        // 1. Create the regular order in DB
        const newOrderId = createOrder({
          address: order.address,
          symbol: details.symbol || 'N/A',
          name: details.name || 'N/A',
          price_usd: currentPrice,
          mcap: currentMcap,
          type: 'dryrun',
          buy_amount_usd: buyAmount,
          token_qty: tokenQty
        });

        // 2. Mark limit order as executed
        updateLimitOrderStatus(order.id, 'executed');

        // 3. Send Telegram Alert
        const targetId = SECRETS.TELEGRAM_CHAT_ID;
        const url = `https://api.telegram.org/bot${SECRETS.TELEGRAM_BOT_TOKEN}/sendMessage`;

        let alertMsg = `🎯 *Limit Buy Order Executed (Dry Run)*\n\n`;
        alertMsg += `📦 *Order ID:* \`#${newOrderId}\` (Limit Order \`#${order.id}\` executed)\n`;
        alertMsg += `🪙 *Token:* \`${details.symbol || 'N/A'}\` (${details.name || 'N/A'})\n`;
        alertMsg += `🔗 *Address:* \`${order.address}\`\n`;
        alertMsg += `💵 *Initial Capital:* \`$${buyAmount.toFixed(2)}\` (${tokenQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
        alertMsg += `💰 *Entry Price:* \`$${currentPrice.toFixed(8)}\`\n`;
        alertMsg += `📊 *Trigger Mcap:* \`$${formatMcap(order.limit_mcap)}\` (Current: \`$${formatMcap(currentMcap)}\`)\n`;
        alertMsg += `🚦 *Type:* \`dryrun\`\n`;
        alertMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n`;

        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetId,
            text: alertMsg,
            parse_mode: 'Markdown'
          })
        }).catch(err => console.error('[Limit Order Monitor] Telegram notification failed:', err.message));

        console.log(`[Limit Order Monitor] Order executed successfully. regular ID: #${newOrderId}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[Limit Order Monitor] Error processing limit order #${order.id}:`, error.message);
    }
  }
}

export default {
  monitorOrders,
  checkLimitOrders
};

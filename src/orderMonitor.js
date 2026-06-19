import jupApi from './jupApi.js';
import { getOpenOrders, updateOrderPrice, getPendingLimitOrders, updateLimitOrderStatus, markOrderTpAlerted } from './db.js';
import { formatToWIB } from './helpers/time.js';
import { SECRETS, CONFIG, isLiveMode } from './config.js';
import { formatMcap } from './helpers/format.js';
import { trader } from './trader.js';

/**
 * Periodically updates the current prices and market caps of all orders in the database.
 * Executes once every hour (or as configured).
 * @param {object} [telegram] Telegraf telegram client used to send alerts (e.g. bot.telegram).
 */
export async function monitorOrders(telegram = null) {
  console.log('[Order Monitor] Starting order price update check...');

  // 1. Check/execute pending limit orders first
  await checkLimitOrders(telegram);

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
            const modalUsd = order.buy_amount_usd || 0;
            const tokenQty = order.token_qty || 0;
            const currentValueUsd = tokenQty * currentPrice;
            const pnlUsd = currentValueUsd - modalUsd;

            const tpModeLabel = isLiveMode() ? 'LIVE' : 'Dry Run';
            let alertMsg = `🎯 *Take Profit Achieved! (${tpModeLabel})*\n\n`;
            alertMsg += `📦 *Order ID:* \`#${order.id}\`\n`;
            alertMsg += `🪙 *Token:* \`${order.symbol || 'N/A'}\` (${order.name || 'N/A'})\n`;
            alertMsg += `🔗 *Address:* \`${order.address}\`\n`;
            alertMsg += `💵 *Initial Capital:* \`$${modalUsd.toFixed(2)}\` (${tokenQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
            alertMsg += `💰 *Entry Price:* \`$${buyPrice.toFixed(8)}\` (Mcap: \`$${order.mcap ? formatMcap(order.mcap) : 'N/A'}\`)\n`;
            alertMsg += `📈 *Current Price:* \`$${currentPrice.toFixed(8)}\` (Mcap: \`$${currentMcap ? formatMcap(currentMcap) : 'N/A'}\`)\n`;
            alertMsg += `🟢 *PnL:* \`+${priceChangePct.toFixed(2)}%\` (\`+$${pnlUsd.toFixed(2)}\`)\n`;
            alertMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n\n`;
            alertMsg += `Tap *Sell Now* to close this order.`;

            if (telegram) {
              try {
                await telegram.sendMessage(targetId, alertMsg, {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [[
                      { text: '✅ Sell Now', callback_data: `sell_tp:${order.id}` },
                      { text: '❌ Ignore', callback_data: `tp_ignore:${order.id}` },
                    ]],
                  },
                });
                markOrderTpAlerted(order.id);
                console.log(`[Order Monitor] Telegram take profit alert sent for ${order.symbol} (#${order.id})`);
              } catch (err) {
                console.error('[Order Monitor] Telegram notification failed:', err.message);
              }
            } else {
              console.warn('[Order Monitor] No telegram client provided; skipping take profit alert.');
            }
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
 * @param {object} [telegram] Telegraf telegram client used to send alerts (e.g. bot.telegram).
 */
export async function checkLimitOrders(telegram = null) {
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

        // 1. Execute buy via trader (dryrun records theoretical; live performs swap)
        const result = await trader.executeBuy({ address: order.address, buyAmountUsd: buyAmount });
        if (!result.ok) {
          console.warn(`[Limit Order Monitor] Execution failed for ${order.address}: ${result.reason}. Limit order stays pending.`);
          continue;
        }
        const newOrderId = result.order.id;
        const tokenQty = result.order.token_qty;
        const entryPrice = result.order.price_usd;

        // 2. Mark limit order as executed
        updateLimitOrderStatus(order.id, 'executed');

        // 3. Send Telegram Alert
        const targetId = SECRETS.TELEGRAM_CHAT_ID;
        const limitModeLabel = isLiveMode() ? 'LIVE' : 'Dry Run';

        let alertMsg = `🎯 *Limit Buy Order Executed (${limitModeLabel})*\n\n`;
        alertMsg += `📦 *Order ID:* \`#${newOrderId}\` (Limit Order \`#${order.id}\` executed)\n`;
        alertMsg += `🪙 *Token:* \`${details.symbol || 'N/A'}\` (${details.name || 'N/A'})\n`;
        alertMsg += `🔗 *Address:* \`${order.address}\`\n`;
        alertMsg += `💵 *Initial Capital:* \`$${buyAmount.toFixed(2)}\` (${tokenQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
        alertMsg += `💰 *Entry Price:* \`$${entryPrice.toFixed(8)}\`\n`;
        alertMsg += `📊 *Trigger Mcap:* \`$${formatMcap(order.limit_mcap)}\` (Current: \`$${formatMcap(currentMcap)}\`)\n`;
        alertMsg += `🚦 *Mode:* \`${isLiveMode() ? 'live' : 'dryrun'}\`\n`;
        if (result.order.signature) {
          alertMsg += `🔁 *Tx:* [solscan](https://solscan.io/tx/${result.order.signature})\n`;
        }
        alertMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n`;

        if (telegram) {
          try {
            await telegram.sendMessage(targetId, alertMsg, { parse_mode: 'Markdown' });
          } catch (err) {
            console.error('[Limit Order Monitor] Telegram notification failed:', err.message);
          }
        } else {
          console.warn('[Limit Order Monitor] No telegram client provided; skipping execution alert.');
        }

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

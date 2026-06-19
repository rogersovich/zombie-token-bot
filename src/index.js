import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { SECRETS, CONFIG } from './config.js';
import { runScreening, screenSingleToken } from './monitor.js';
import { formatToWIB, getNextCronOccurrence, dayjs } from './helpers/time.js';
import { buildSummaryMessage, buildSingleCheckMessage, buildPnLMessage, buildLimitOrdersMessage, buildAlertsMessage } from './helpers/message.js';
import { createOrder, getAllOrders, updateOrderPrice, createLimitOrder, getPendingLimitOrders, getLimitOrder, updateLimitOrderStatus, getAllAlerts, getBoughtAddresses, getPendingLimitAddresses, getOpenOrdersByAddress, getOrderById, closeOrder, getOpenOrders } from './db.js';
import jupApi from './jupApi.js';
import { monitorOrders } from './orderMonitor.js';
import { formatMcap } from './helpers/format.js';

// Setup validation
const isTokenConfigured = SECRETS.TELEGRAM_BOT_TOKEN && 
                          SECRETS.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN';
const isChatIdConfigured = SECRETS.TELEGRAM_CHAT_ID && 
                           SECRETS.TELEGRAM_CHAT_ID !== 'YOUR_TELEGRAM_CHAT_ID';

if (!isTokenConfigured || !isChatIdConfigured) {
  console.error('================================================================');
  console.error('⚠️  CRITICAL CONFIGURATION ERROR: TELEGRAM CREDENTIALS NOT FOUND');
  console.error('================================================================');
  console.error('Please configure your .env file with your actual Telegram credentials:');
  console.error('1. Edit: /Users/rogersovich/Documents/Coding/JS/dead-coin/.env');
  console.error('2. Set TELEGRAM_BOT_TOKEN to your Bot Token from @BotFather');
  console.error('3. Set TELEGRAM_CHAT_ID to your Chat ID from @userinfobot');
  console.error('================================================================');
  process.exit(1);
}

const bot = new Telegraf(SECRETS.TELEGRAM_BOT_TOKEN);

/**
 * Sends a long message by splitting it into smaller chunks if it exceeds Telegram's limit.
 * @param {object} telegramOrCtx The bot.telegram instance or command context
 * @param {string|number} targetId Chat ID (used if sending via bot.telegram)
 * @param {string} text The message text
 * @param {object} options Extra options (e.g. parse_mode, disable_web_page_preview)
 */
async function sendSplitMessage(telegramOrCtx, targetId, text, options = {}) {
  const isCtx = typeof telegramOrCtx.reply === 'function';
  
  if (text.length <= 4000) {
    if (isCtx) {
      return await telegramOrCtx.reply(text, options);
    } else {
      return await telegramOrCtx.sendMessage(targetId, text, options);
    }
  }

  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + '\n\n' + paragraph).length > 4000) {
      if (currentChunk.trim()) {
        if (isCtx) {
          await telegramOrCtx.reply(currentChunk.trim(), options);
        } else {
          await telegramOrCtx.sendMessage(targetId, currentChunk.trim(), options);
        }
      }
      currentChunk = paragraph;
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
    }
  }

  if (currentChunk.trim()) {
    if (isCtx) {
      await telegramOrCtx.reply(currentChunk.trim(), options);
    } else {
      await telegramOrCtx.sendMessage(targetId, currentChunk.trim(), options);
    }
  }
}

/**
 * Executes the screening and sends reports to Telegram.
 * @param {boolean} silentOnEmpty
 */
async function executeScreeningAndSend(ctx = null) {
  const notifyTarget = ctx ? ctx : bot.telegram;
  const targetId = ctx ? ctx.chat.id : SECRETS.TELEGRAM_CHAT_ID;

  const statusMsg = ctx 
    ? await ctx.reply('🔍 Starting Solana zombie token screening, please wait...') 
    : console.log('[Cron] Starting automated screening cycle.');

  try {
    const { results, csvPath, totalCandidates } = await runScreening();

    if (results.length === 0) {
      const emptyText = `🔍 Screening completed: No new tokens meet the criteria at this moment.\n(Monitored from: \`${totalCandidates || 0}\` candidates)`;
      if (ctx) {
        await ctx.reply(emptyText);
      } else {
        await bot.telegram.sendMessage(targetId, emptyText);
      }
      return;
    }

    // Send CSV report document
    await bot.telegram.sendDocument(targetId, {
      source: fs.readFileSync(csvPath),
      filename: path.basename(csvPath)
    }, {
      caption: `📁 Screening Report: ${results.length} out of ${totalCandidates} tokens found.`
    });

    // Send summary text details
    const textDetails = buildSummaryMessage(results, totalCandidates);
    await sendSplitMessage(bot.telegram, targetId, textDetails, { parse_mode: 'Markdown', disable_web_page_preview: true });

    if (ctx && statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  } catch (error) {
    console.error('[App] Screening execute error:', error.message);
    const errorText = `❌ An error occurred during screening: ${error.message}`;
    if (ctx) {
      await ctx.reply(errorText);
    } else {
      await bot.telegram.sendMessage(targetId, errorText);
    }
  }
}

// Command Listeners
bot.start((ctx) => {
  let welcome = `👋 Welcome to *Solana Zombie Token Monitor Bot*!\n\n`;
  welcome += `This bot monitors tokens that once reached a high ATH but are currently dormant (accumulating), while still showing daily transaction activity.\n\n`;
  welcome += `*Command Menu:*\n`;
  welcome += `🔹 /screen - Run manual screening now\n`;
  welcome += `🔹 /status - Check current bot filter configuration\n`;
  welcome += `🔹 /check {CA} - Check token details directly\n`;
  welcome += `🔹 /alerts - List all screened tokens in database\n`;
  welcome += `🔹 /buy {CA} [modal_usd] - Record mock token purchase (dryrun)\n`;
  welcome += `🔹 /buy_limit {CA} {limit_mcap} [modal_usd] - Set limit buy order (dryrun)\n`;
  welcome += `🔹 /limit_list - List all pending limit buy orders\n`;
  welcome += `🔹 /limit_cancel {limit_order_id} - Cancel a pending limit buy order\n`;
  welcome += `🔹 /pnl [CA] - Check order PnL report\n`;
  welcome += `🔹 /sell {CA|order_id} [all] - Manually Take Profit on an order\n`;
  welcome += `🔹 /tp {CA|order_id} [all] - Alias for /sell\n`;
  ctx.replyWithMarkdown(welcome);
});

bot.command('status', (ctx) => {
  const nextInfo = getNextCronOccurrence(CONFIG.cronScreenMinutes);

  let status = `⚙️ *Current Filter Configuration:*\n\n`;
  status += `• Min ATH Mcap: \`$${CONFIG.minAthMcap.toLocaleString()}\`\n`;
  status += `• Mcap Accumulation Range: \`$${CONFIG.minMcap.toLocaleString()}\` - \`$${CONFIG.maxMcap.toLocaleString()}\`\n`;
  status += `• Min 24h Volume: \`$${CONFIG.minVolume24h.toLocaleString()}\`\n`;
  status += `• Min Holder Count: \`${CONFIG.minHolderCount.toLocaleString()}\`\n`;
  status += `• Min Token Age: \`${CONFIG.minTokenAgeDays} days\`\n`;
  status += `• Min Largest Buy (7D): \`$${CONFIG.minLargestBuyUsd.toLocaleString()}\`\n\n`;
  status += `🕒 *Automated Schedule:* every \`${CONFIG.cronScreenMinutes} minutes\`\n`;
  status += `⏳ *Next Run:* \`${nextInfo.nextRunTimeWIB}\` (in *${nextInfo.remainingStr}*)\n`;
  ctx.replyWithMarkdown(status);
});

bot.command('screen', async (ctx) => {
  await executeScreeningAndSend(ctx);
});

bot.command('check', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const address = args[0]?.trim();

  if (!address) {
    return ctx.replyWithMarkdown('⚠️ *Invalid format.*\nPlease specify a contract address.\n\nExample:\n`/check 3ne9QxYRHybHK1LVmtEG8rH7L6nJ56W8KVWeB8ZGpump`');
  }

  const statusMsg = await ctx.reply(`🔍 Checking token: \`${address}\`...`);

  try {
    const info = await screenSingleToken(address);
    if (!info) {
      await ctx.reply(`❌ Token not found on Jupiter with that contract address.`);
      return;
    }

    const textDetails = buildSingleCheckMessage(info, CONFIG);
    await ctx.replyWithMarkdown(textDetails, { disable_web_page_preview: true });
  } catch (error) {
    console.error('[App] Single check error:', error.message);
    await ctx.reply(`❌ An error occurred while checking token: ${error.message}`);
  } finally {
    if (statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  }
});

bot.command('alerts', async (ctx) => {
  const statusMsg = await ctx.reply('🔍 Fetching screened tokens list, please wait...');

  try {
    const alerts = getAllAlerts();
    if (alerts.length === 0) {
      await ctx.reply('📝 *No screened tokens found in the database.*');
      return;
    }

    // Resolve details for the top 20 alerts to avoid too many API calls
    const resolvedAlerts = [];
    const alertsToProcess = alerts.slice(0, 20);

    for (const a of alertsToProcess) {
      try {
        const details = await jupApi.searchAsset(a.address);
        if (details) {
          resolvedAlerts.push({
            ...a,
            symbol: details.symbol,
            name: details.name
          });
        } else {
          resolvedAlerts.push(a);
        }
      } catch (err) {
        resolvedAlerts.push(a);
      }
      // slight delay to respect rate limit
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Append the remaining ones unresolved
    if (alerts.length > 20) {
      resolvedAlerts.push(...alerts.slice(20));
    }

    const boughtAddresses = getBoughtAddresses();
    const pendingLimitAddresses = getPendingLimitAddresses();
    const message = buildAlertsMessage(resolvedAlerts, boughtAddresses, pendingLimitAddresses);
    await sendSplitMessage(ctx, null, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('[App] Alerts list command error:', error.message);
    await ctx.reply(`❌ An error occurred while fetching screened tokens: ${error.message}`);
  } finally {
    if (statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  }
});

bot.command('buy', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const address = args[0]?.trim();
  const customModalStr = args[1]?.trim();

  if (!address) {
    return ctx.replyWithMarkdown('⚠️ *Invalid format.*\nPlease specify a contract address.\n\nExample:\n`/buy AKQsb5XKL7RohnLGWjRui5ArUYVSZWJ5VwDSa2EEpump [modal_usd]`');
  }

  // Parse custom modal or use config default
  let buyAmount = CONFIG.defaultBuyAmountUsd;
  if (customModalStr) {
    const parsed = parseFloat(customModalStr);
    if (!isNaN(parsed) && parsed > 0) {
      buyAmount = parsed;
    }
  }

  const statusMsg = await ctx.reply(`🛒 Processing buy order for token: \`${address}\` with capital $${buyAmount}...`);

  try {
    const details = await jupApi.searchAsset(address);
    if (!details) {
      await ctx.reply(`❌ Token not found on Jupiter with that contract address.`);
      return;
    }

    const priceUsd = details.usdPrice || 0;
    const mcap = details.mcap || 0;
    const symbol = details.symbol || 'N/A';
    const name = details.name || 'N/A';

    // Calculate token quantity
    const tokenQty = priceUsd > 0 ? (buyAmount / priceUsd) : 0;

    // Insert to DB as dryrun
    const orderId = createOrder({
      address,
      symbol,
      name,
      price_usd: priceUsd,
      mcap,
      type: 'dryrun',
      buy_amount_usd: buyAmount,
      token_qty: tokenQty
    });

    let successMsg = `✅ *Buy Record Success (Dry Run/Paper Trading)*\n\n`;
    successMsg += `📦 *Order ID:* \`#${orderId}\`\n`;
    successMsg += `🪙 *Token:* \`${symbol}\` (${name})\n`;
    successMsg += `🔗 *Address:* \`${address}\`\n`;
    successMsg += `💵 *Initial Capital:* \`$${buyAmount.toFixed(2)}\` (${tokenQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
    successMsg += `💰 *Entry Price:* \`$${priceUsd.toFixed(8)}\`\n`;
    successMsg += `📊 *Market Cap:* \`$${formatMcap(mcap)}\`\n`;
    successMsg += `🚦 *Type:* \`dryrun\`\n`;
    successMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n`;

    await ctx.replyWithMarkdown(successMsg, { disable_web_page_preview: true });
  } catch (error) {
    console.error('[App] Buy command error:', error.message);
    await ctx.reply(`❌ An error occurred during purchase: ${error.message}`);
  } finally {
    if (statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  }
});

bot.command('buy_limit', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const address = args[0]?.trim();
  const limitMcapStr = args[1]?.trim();
  const customModalStr = args[2]?.trim();

  if (!address || !limitMcapStr) {
    return ctx.replyWithMarkdown('⚠️ *Invalid format.*\nPlease specify a contract address and limit market cap.\n\nExample:\n`/buy_limit AKQsb5XKL7RohnLGWjRui5ArUYVSZWJ5VwDSa2EEpump 4.4k [modal_usd]`');
  }

  // Parse limit mcap shorthand (e.g. 4.4k -> 4400)
  const parseMcapShorthand = (str) => {
    const cleaned = str.trim().toLowerCase();
    if (cleaned.endsWith('k')) {
      return parseFloat(cleaned.slice(0, -1)) * 1000;
    }
    if (cleaned.endsWith('m')) {
      return parseFloat(cleaned.slice(0, -1)) * 1000000;
    }
    return parseFloat(cleaned);
  };

  const limitMcap = parseMcapShorthand(limitMcapStr);
  if (isNaN(limitMcap) || limitMcap <= 0) {
    return ctx.replyWithMarkdown('⚠️ *Invalid limit market cap value.*\nPlease enter a positive number or shorthand (e.g., 4.4k, 12k, 1M).');
  }

  // Parse custom modal or use config default
  let buyAmount = CONFIG.defaultBuyAmountUsd;
  if (customModalStr) {
    const parsed = parseFloat(customModalStr);
    if (!isNaN(parsed) && parsed > 0) {
      buyAmount = parsed;
    }
  }

  const statusMsg = await ctx.reply(`🛒 Creating limit buy order for token: \`${address}\` at Mcap <= $${formatMcap(limitMcap)}...`);

  try {
    const details = await jupApi.searchAsset(address);
    if (!details) {
      await ctx.reply(`❌ Token not found on Jupiter with that contract address.`);
      return;
    }

    const symbol = details.symbol || 'N/A';
    const name = details.name || 'N/A';

    // Insert to DB as pending limit order
    const limitOrderId = createLimitOrder({
      address,
      limit_mcap: limitMcap,
      buy_amount_usd: buyAmount
    });

    let successMsg = `✅ *Limit Buy Order Placed Successfully*\n\n`;
    successMsg += `📦 *Limit Order ID:* \`#${limitOrderId}\`\n`;
    successMsg += `🪙 *Token:* \`${symbol}\` (${name})\n`;
    successMsg += `🔗 *Address:* \`${address}\`\n`;
    successMsg += `💵 *Buy Capital:* \`$${buyAmount.toFixed(2)}\`\n`;
    successMsg += `🎯 *Target Mcap:* \`$${formatMcap(limitMcap)}\` (Current: \`$${formatMcap(details.mcap || 0)}\`)\n`;
    successMsg += `🚦 *Status:* \`pending\` (Runs on hourly check)\n`;
    successMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n`;

    await ctx.replyWithMarkdown(successMsg, { disable_web_page_preview: true });
  } catch (error) {
    console.error('[App] Buy limit command error:', error.message);
    await ctx.reply(`❌ An error occurred while creating limit order: ${error.message}`);
  } finally {
    if (statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  }
});

bot.command('limit_list', async (ctx) => {
  try {
    const pending = getPendingLimitOrders();
    const message = buildLimitOrdersMessage(pending);
    await ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error('[App] Limit list command error:', error.message);
    await ctx.reply(`❌ An error occurred while fetching limit orders: ${error.message}`);
  }
});

bot.command('limit_cancel', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const orderIdStr = args[0]?.trim();

  if (!orderIdStr) {
    return ctx.replyWithMarkdown('⚠️ *Invalid format.*\nPlease specify a limit order ID.\n\nExample:\n`/limit_cancel 1`');
  }

  const orderId = parseInt(orderIdStr);
  if (isNaN(orderId)) {
    return ctx.replyWithMarkdown('⚠️ *Invalid limit order ID.*\nPlease enter a valid integer.');
  }

  try {
    const order = getLimitOrder(orderId);
    if (!order) {
      await ctx.reply(`❌ Limit Order \`#${orderId}\` not found.`);
      return;
    }

    if (order.status !== 'pending') {
      await ctx.reply(`❌ Limit Order \`#${orderId}\` cannot be cancelled because its status is \`${order.status}\`.`);
      return;
    }

    updateLimitOrderStatus(orderId, 'cancelled');
    await ctx.reply(`✅ *Limit Order #${orderId} has been successfully cancelled.*`);
  } catch (error) {
    console.error('[App] Limit cancel command error:', error.message);
    await ctx.reply(`❌ An error occurred while cancelling limit order: ${error.message}`);
  }
});

bot.command('pnl', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const address = args[0]?.trim();

  const statusMsg = await ctx.reply('📊 Processing order PnL data, please wait...');

  try {
    let orders = [];
    if (address) {
      orders = getOpenOrdersByAddress(address);
    } else {
      orders = getOpenOrders();
    }

    if (orders.length === 0) {
      await ctx.reply(address 
        ? `❌ No active orders found for contract address: \`${address}\``
        : '📝 No active orders found.'
      );
      return;
    }

    // Fetch real-time price updates for unique addresses
    const uniqueAddresses = [...new Set(orders.map(o => o.address))];
    const latestDetails = {};
    for (const addr of uniqueAddresses) {
      try {
        const details = await jupApi.searchAsset(addr);
        if (details) {
          latestDetails[addr] = details;
        }
      } catch (err) {
        console.error(`[App] Failed to fetch latest price for ${addr} during PnL check:`, err.message);
      }
    }

    // Map the new prices and update the DB in parallel
    const updatedOrders = orders.map(o => {
      const details = latestDetails[o.address];
      if (details) {
        const currentPrice = details.usdPrice || 0;
        const currentMcap = details.mcap || 0;
        updateOrderPrice(o.id, currentPrice, currentMcap);
        return {
          ...o,
          current_price_usd: currentPrice,
          current_mcap: currentMcap,
          updated_at: Date.now()
        };
      }
      return o;
    });

    const pnlMessage = buildPnLMessage(updatedOrders, CONFIG);
    await sendSplitMessage(ctx, null, pnlMessage, { parse_mode: 'Markdown', disable_web_page_preview: true });

  } catch (error) {
    console.error('[App] PnL command error:', error.message);
    await ctx.reply(`❌ An error occurred while checking PnL: ${error.message}`);
  } finally {
    if (statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  }
});

// Manual Take Profit commands (sell / tp)
async function handleManualTakeProfit(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const input = args[0]?.trim();
  const option = args[1]?.trim()?.toLowerCase();

  if (!input) {
    let errorMsg = `⚠️ *Invalid format.*\nPlease specify a contract address or order ID.\n\n`;
    errorMsg += `*Examples:*\n`;
    errorMsg += `• Sell by Order ID: \`/sell 5\`\n`;
    errorMsg += `• Sell by Address: \`/sell 3ne9Q...ZGpump\`\n`;
    errorMsg += `• Sell all active orders for an address: \`/sell 3ne9Q...ZGpump all\``;
    return ctx.replyWithMarkdown(errorMsg);
  }

  const statusMsg = await ctx.reply('🛒 Processing manual take profit, please wait...');

  try {
    const orderId = parseInt(input);

    if (!isNaN(orderId)) {
      // 1. Process by Order ID
      const order = getOrderById(orderId);
      if (!order) {
        await ctx.reply(`❌ Order \`#${orderId}\` not found in database.`);
        return;
      }
      if (order.status === 'sold') {
        await ctx.reply(`❌ Order \`#${orderId}\` is already sold/closed.`);
        return;
      }

      // Fetch current price
      const details = await jupApi.searchAsset(order.address);
      const sellPrice = details?.usdPrice || order.current_price_usd || order.price_usd;
      const sellMcap = details?.mcap || order.current_mcap || order.mcap;

      // Close the order
      closeOrder(order.id, sellPrice, sellMcap);

      // Calculate PnL
      const buyPrice = order.price_usd || 0;
      const priceChangePct = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
      const modalUsd = order.buy_amount_usd || 0;
      const currentValueUsd = order.token_qty * sellPrice;
      const pnlUsd = currentValueUsd - modalUsd;
      const sign = priceChangePct >= 0 ? '+' : '';

      let successMsg = `✅ *Manual Take Profit Success*\n\n`;
      successMsg += `📦 *Order ID:* \`#${order.id}\`\n`;
      successMsg += `🪙 *Token:* \`${order.symbol || 'N/A'}\` (${order.name || 'N/A'})\n`;
      successMsg += `🔗 *Address:* \`${order.address}\`\n`;
      successMsg += `💵 *Initial Capital:* \`$${modalUsd.toFixed(2)}\` (${order.token_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
      successMsg += `💰 *Entry Price:* \`$${buyPrice.toFixed(8)}\` (Mcap: \`$${order.mcap ? formatMcap(order.mcap) : 'N/A'}\`)\n`;
      successMsg += `📈 *Sell Price:* \`$${sellPrice.toFixed(8)}\` (Mcap: \`$${sellMcap ? formatMcap(sellMcap) : 'N/A'}\`)\n`;
      successMsg += `💵 *Realized Value (Total):* \`$${currentValueUsd.toFixed(2)}\`\n`;
      successMsg += `🟢 *Realized PnL:* \`${sign}${priceChangePct.toFixed(2)}%\` (\`${sign}$${pnlUsd.toFixed(2)}\`)\n`;
      successMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n`;

      await ctx.replyWithMarkdown(successMsg, { disable_web_page_preview: true });
    } else {
      // 2. Process by Contract Address
      const address = input;
      const openOrders = getOpenOrdersByAddress(address);

      if (openOrders.length === 0) {
        await ctx.reply(`❌ No active/open orders found for address: \`${address}\``);
        return;
      }

      // Fetch current price once
      const details = await jupApi.searchAsset(address);
      if (!details) {
        await ctx.reply(`❌ Could not fetch latest price for address: \`${address}\`. Sell failed.`);
        return;
      }
      const sellPrice = details.usdPrice || 0;
      const sellMcap = details.mcap || 0;

      if (openOrders.length === 1 && option !== 'all') {
        // Only one active order: sell it immediately
        const order = openOrders[0];
        closeOrder(order.id, sellPrice, sellMcap);

        const buyPrice = order.price_usd || 0;
        const priceChangePct = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
        const modalUsd = order.buy_amount_usd || 0;
        const currentValueUsd = order.token_qty * sellPrice;
        const pnlUsd = currentValueUsd - modalUsd;
        const sign = priceChangePct >= 0 ? '+' : '';

        let successMsg = `✅ *Manual Take Profit Success*\n\n`;
        successMsg += `📦 *Order ID:* \`#${order.id}\`\n`;
        successMsg += `🪙 *Token:* \`${order.symbol || 'N/A'}\` (${order.name || 'N/A'})\n`;
        successMsg += `🔗 *Address:* \`${order.address}\`\n`;
        successMsg += `💵 *Initial Capital:* \`$${modalUsd.toFixed(2)}\` (${order.token_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
        successMsg += `💰 *Entry Price:* \`$${buyPrice.toFixed(8)}\` (Mcap: \`$${order.mcap ? formatMcap(order.mcap) : 'N/A'}\`)\n`;
        successMsg += `📈 *Sell Price:* \`$${sellPrice.toFixed(8)}\` (Mcap: \`$${sellMcap ? formatMcap(sellMcap) : 'N/A'}\`)\n`;
        successMsg += `💵 *Realized Value (Total):* \`$${currentValueUsd.toFixed(2)}\`\n`;
        successMsg += `🟢 *Realized PnL:* \`${sign}${priceChangePct.toFixed(2)}%\` (\`${sign}$${pnlUsd.toFixed(2)}\`)\n`;
        successMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n`;

        await ctx.replyWithMarkdown(successMsg, { disable_web_page_preview: true });
      } else {
        // Multiple orders exist, or option is 'all'
        if (option === 'all') {
          // Sell all orders for this address
          let summaryMsg = `✅ *Manual Take Profit Success (All Orders)*\n\n`;
          summaryMsg += `🪙 *Token:* \`${details.symbol || 'N/A'}\` (${details.name || 'N/A'})\n`;
          summaryMsg += `🔗 *Address:* \`${address}\`\n`;
          summaryMsg += `📈 *Sell Price:* \`$${sellPrice.toFixed(8)}\` (Mcap: \`$${formatMcap(sellMcap)}\`)\n`;
          summaryMsg += `📅 *Time:* \`${formatToWIB(Date.now())}\`\n\n`;

          let totalCapital = 0;
          let totalPnL = 0;

          openOrders.forEach((order, idx) => {
            closeOrder(order.id, sellPrice, sellMcap);
            const buyPrice = order.price_usd || 0;
            const priceChangePct = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
            const modalUsd = order.buy_amount_usd || 0;
            const currentValueUsd = order.token_qty * sellPrice;
            const pnlUsd = currentValueUsd - modalUsd;
            const sign = priceChangePct >= 0 ? '+' : '';

            totalCapital += modalUsd;
            totalPnL += pnlUsd;

            summaryMsg += `${idx + 1}. *Order #${order.id}*\n`;
            summaryMsg += `   • Capital: \`$${modalUsd.toFixed(2)}\`\n`;
            summaryMsg += `   • Entry: \`$${buyPrice.toFixed(8)}\`\n`;
            summaryMsg += `   • PnL: \`${sign}${priceChangePct.toFixed(2)}%\` (\`${sign}$${pnlUsd.toFixed(2)}\`)\n\n`;
          });

          const totalPnLPct = totalCapital > 0 ? (totalPnL / totalCapital) * 100 : 0;
          const totalSign = totalPnL >= 0 ? '+' : '';

          summaryMsg += `📊 *Total Portfolio PnL:* \`${totalSign}${totalPnLPct.toFixed(2)}%\` (\`${totalSign}$${totalPnL.toFixed(2)}\`)\n`;

          await sendSplitMessage(ctx, null, summaryMsg, { parse_mode: 'Markdown', disable_web_page_preview: true });
        } else {
          // List them and tell the user to select one or use "all"
          let listMsg = `⚠️ *Multiple active orders found for this token:*\n\n`;
          openOrders.forEach((o, i) => {
            listMsg += `${i + 1}. *Order #${o.id}*\n`;
            listMsg += `   • Initial Capital: \`$${o.buy_amount_usd.toFixed(2)}\` (${o.token_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
            listMsg += `   • Entry Price: \`$${o.price_usd.toFixed(8)}\`\n`;
            listMsg += `   • Created At: \`${formatToWIB(o.created_at)}\`\n\n`;
          });
          listMsg += `To sell a specific order, run:\n\`/sell {order_id}\` (e.g. \`/sell ${openOrders[0].id}\`)\n\n`;
          listMsg += `To sell ALL active orders for this token, run:\n\`/sell ${address} all\``;
          
          await ctx.replyWithMarkdown(listMsg, { disable_web_page_preview: true });
        }
      }
    }
  } catch (error) {
    console.error('[App] Sell/TP command error:', error.message);
    await ctx.reply(`❌ An error occurred during manual Take Profit: ${error.message}`);
  } finally {
    if (statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  }
}

bot.command('sell', handleManualTakeProfit);
bot.command('tp', handleManualTakeProfit);

// Start scheduler immediately (independently of bot.launch)
const startupTime = formatToWIB(Date.now());

const scheduleStr = CONFIG.cronScreenMinutes >= 60 
  ? `${CONFIG.cronScreenMinutes / 60} hour(s)` 
  : `${CONFIG.cronScreenMinutes} minute(s)`;

console.log('\n================================================================');
console.log('🚀 SOLANA ZOMBIE TOKEN MONITOR BOT IS RUNNING');
console.log('================================================================');
console.log(`[System] Started at: ${startupTime}`);
console.log(`[System] Schedule: Run every ${scheduleStr}`);
console.log(`[System] Order Monitor: Run every ${CONFIG.cronOrderMonitorHours} hour(s)`);
console.log(`[Filter] Min ATH Mcap: $${CONFIG.minAthMcap.toLocaleString()}`);
console.log(`[Filter] Mcap Accumulation: $${CONFIG.minMcap.toLocaleString()} - $${CONFIG.maxMcap.toLocaleString()}`);
console.log(`[Filter] Min 24h Volume: $${CONFIG.minVolume24h.toLocaleString()}`);
console.log(`[Filter] Min Holders: ${CONFIG.minHolderCount.toLocaleString()}`);
console.log(`[Filter] Min Token Age: ${CONFIG.minTokenAgeDays} days`);
console.log('================================================================\n');

// Calculate milliseconds remaining until the next aligned run
const nextInfo = getNextCronOccurrence(CONFIG.cronScreenMinutes);

// Format nextRunTimeWIB back to a dayjs object to get difference
const nextRunTime = dayjs(nextInfo.nextRunTimeWIB.replace(' WIB', ''), 'YYYY-MM-DD HH:mm:ss');
const delayMs = nextRunTime.diff(dayjs());

console.log(`[Scheduler] Next run is aligned at ${nextInfo.nextRunTimeWIB}. Delaying first run by ${(delayMs / 1000).toFixed(0)} seconds...`);

// First aligned run
setTimeout(async () => {
  console.log('[Scheduler] Running scheduled screening task (aligned)...');
  await executeScreeningAndSend();
  
  // Set up recurring interval runs
  setInterval(async () => {
    console.log('[Scheduler] Running scheduled screening task (interval)...');
    await executeScreeningAndSend();
  }, CONFIG.cronScreenMinutes * 60 * 1000);

}, delayMs);

// Start order monitor schedule
console.log(`[Scheduler] Order monitor scheduled to run every ${CONFIG.cronOrderMonitorHours} hour(s)`);
monitorOrders(bot.telegram).catch(err => console.error('[Scheduler] Initial order monitor run failed:', err.message));

setInterval(async () => {
  try {
    await monitorOrders(bot.telegram);
  } catch (err) {
    console.error('[Scheduler] Order monitoring cycle failed:', err.message);
  }
}, CONFIG.cronOrderMonitorHours * 60 * 60 * 1000);

// Launch Telegram Bot Listener in parallel
console.log('[Telegram] Connecting to Telegram API...');
bot.launch()
  .then(() => {
    console.log('[Telegram] Bot listener connected and polling.');
  })
  .catch(err => {
    console.error('[Telegram] Failed to start Telegram listener (will retry on next event):', err.message);
  });

// Graceful stop handlers
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

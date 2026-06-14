import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { SECRETS, CONFIG } from './config.js';
import { runScreening, screenSingleToken } from './monitor.js';
import { formatToWIB, getNextCronOccurrence, dayjs } from './helpers/time.js';
import { buildSummaryMessage, buildSingleCheckMessage, buildPnLMessage } from './helpers/message.js';
import { createOrder, getAllOrders, getOrdersByAddress, updateOrderPrice } from './db.js';
import jupApi from './jupApi.js';
import { monitorOrders } from './orderMonitor.js';

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
    await bot.telegram.sendMessage(targetId, textDetails, { parse_mode: 'Markdown', disable_web_page_preview: true });

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
  welcome += `🔹 /buy {CA} [modal_usd] - Record mock token purchase (dryrun)\n`;
  welcome += `🔹 /pnl [CA] - Check order PnL report\n`;
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
    successMsg += `📊 *Market Cap:* \`$${mcap.toLocaleString(undefined, { maximumFractionDigits: 2 })}\`\n`;
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

bot.command('pnl', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const address = args[0]?.trim();

  const statusMsg = await ctx.reply('📊 Processing order PnL data, please wait...');

  try {
    let orders = [];
    if (address) {
      orders = getOrdersByAddress(address);
    } else {
      orders = getAllOrders();
    }

    if (orders.length === 0) {
      await ctx.reply(address 
        ? `❌ No orders recorded for contract address: \`${address}\``
        : '📝 No orders recorded yet.'
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
    await ctx.replyWithMarkdown(pnlMessage, { disable_web_page_preview: true });

  } catch (error) {
    console.error('[App] PnL command error:', error.message);
    await ctx.reply(`❌ An error occurred while checking PnL: ${error.message}`);
  } finally {
    if (statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  }
});

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
monitorOrders().catch(err => console.error('[Scheduler] Initial order monitor run failed:', err.message));

setInterval(async () => {
  try {
    await monitorOrders();
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

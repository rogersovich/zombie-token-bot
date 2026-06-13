import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { SECRETS, CONFIG } from './config.js';
import { runScreening } from './monitor.js';
import { formatToWIB, getNextCronOccurrence, dayjs } from './helpers/time.js';
import { buildSummaryMessage } from './helpers/message.js';

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
    ? await ctx.reply('🔍 Memulai screening koin mati suri di Solana, mohon tunggu...') 
    : console.log('[Cron] Starting automated screening cycle.');

  try {
    const { results, csvPath, totalCandidates } = await runScreening();

    if (results.length === 0) {
      const emptyText = `🔍 Screening selesai: Tidak ada token baru yang memenuhi kriteria saat ini.\n(Dipantau dari total: \`${totalCandidates || 0}\` kandidat)`;
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
      caption: `📁 Laporan Screening: ${results.length} dari ${totalCandidates} token ditemukan.`
    });

    // Send summary text details
    const textDetails = buildSummaryMessage(results, totalCandidates);
    await bot.telegram.sendMessage(targetId, textDetails, { parse_mode: 'Markdown', disable_web_page_preview: true });

    if (ctx && statusMsg) {
      await ctx.deleteMessage(statusMsg.message_id).catch(() => {});
    }
  } catch (error) {
    console.error('[App] Screening execute error:', error.message);
    const errorText = `❌ Terjadi kesalahan saat menjalankan screening: ${error.message}`;
    if (ctx) {
      await ctx.reply(errorText);
    } else {
      await bot.telegram.sendMessage(targetId, errorText);
    }
  }
}

// Command Listeners
bot.start((ctx) => {
  let welcome = `👋 Selamat datang di *Solana Zombie Token Monitor Bot*!\n\n`;
  welcome += `Bot ini memantau koin yang pernah ATH tinggi namun sekarang sedang tertidur (akumulasi), tetapi masih memiliki aktivitas transaksi harian.\n\n`;
  welcome += `*Menu Perintah:*\n`;
  welcome += `🔹 /screen - Jalankan screening manual sekarang\n`;
  welcome += `🔹 /status - Cek konfigurasi filter bot saat ini\n`;
  ctx.replyWithMarkdown(welcome);
});

bot.command('status', (ctx) => {
  const nextInfo = getNextCronOccurrence(CONFIG.cronScreenMinutes);

  let status = `⚙️ *Konfigurasi Filter Saat Ini:*\n\n`;
  status += `• Minimal ATH Mcap: \`$${CONFIG.minAthMcap.toLocaleString()}\`\n`;
  status += `• Rentang Mcap Akumulasi: \`$${CONFIG.minMcap.toLocaleString()}\` - \`$${CONFIG.maxMcap.toLocaleString()}\`\n`;
  status += `• Minimal Volume 24 Jam: \`$${CONFIG.minVolume24h.toLocaleString()}\`\n`;
  status += `• Minimal Jumlah Holder: \`${CONFIG.minHolderCount.toLocaleString()}\`\n`;
  status += `• Minimal Umur Token: \`${CONFIG.minTokenAgeDays} hari\`\n\n`;
  status += `🕒 *Jadwal Otomatis:* setiap \`${CONFIG.cronScreenMinutes} menit\`\n`;
  status += `⏳ *Next Run:* \`${nextInfo.nextRunTimeWIB}\` (dalam *${nextInfo.remainingStr}*)\n`;
  ctx.replyWithMarkdown(status);
});

bot.command('screen', async (ctx) => {
  await executeScreeningAndSend(ctx);
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

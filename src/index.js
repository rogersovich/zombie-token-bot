import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { SECRETS, CONFIG } from './config.js';
import { runScreening } from './monitor.js';
import { formatToWIB } from './helpers/time.js';
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
    const { results, csvPath } = await runScreening();

    if (results.length === 0) {
      const emptyText = '🔍 Screening selesai: Tidak ada token mati suri baru yang memenuhi kriteria saat ini.';
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
      caption: `📁 Laporan Screening Token: ${results.length} token ditemukan.`
    });

    // Send summary text details
    const textDetails = buildSummaryMessage(results);
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
  let status = `⚙️ *Konfigurasi Filter Saat Ini:*\n\n`;
  status += `• Minimal ATH Mcap: \`$${CONFIG.minAthMcap.toLocaleString()}\`\n`;
  status += `• Rentang Mcap Akumulasi: \`$${CONFIG.minMcap.toLocaleString()}\` - \`$${CONFIG.maxMcap.toLocaleString()}\`\n`;
  status += `• Minimal Volume 24 Jam: \`$${CONFIG.minVolume24h.toLocaleString()}\`\n`;
  status += `• Minimal Jumlah Holder: \`${CONFIG.minHolderCount.toLocaleString()}\`\n`;
  status += `• Minimal Umur Token: \`${CONFIG.minTokenAgeDays} hari\`\n`;
  status += `• Jadwal Otomatis: setiap 4 jam (\`${SECRETS.CRON_SCHEDULE}\`)\n`;
  ctx.replyWithMarkdown(status);
});

bot.command('screen', async (ctx) => {
  await executeScreeningAndSend(ctx);
});

// Launch Bot
bot.launch().then(() => {
  console.log('🚀 Solana Zombie Token Monitor Telegram Bot is running...');
  console.log(`[Scheduler] Registered cron cycle: "${SECRETS.CRON_SCHEDULE}"`);
  
  // Register automated cron job (defaults to every 4 hours)
  cron.schedule(SECRETS.CRON_SCHEDULE, async () => {
    console.log('[Scheduler] Running automated cron task...');
    await executeScreeningAndSend();
  });
}).catch(err => {
  console.error('Failed to start Telegram Bot:', err.message);
});

// Graceful stop handlers
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

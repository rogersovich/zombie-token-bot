import fs from 'fs';
import path from 'path';
import { Telegraf } from 'telegraf';
import { SECRETS } from './config.js';
import { runScreening } from './monitor.js';
import { formatToWIB } from './helpers/time.js';
import { buildSummaryMessage } from './helpers/message.js';

async function main() {
  console.log('🧪 Running Test Screening for Solana Zombie Tokens...');
  console.log('Time (WIB):', formatToWIB(Date.now()));
  console.log('--------------------------------------------------');

  try {
    const { results, csvPath, totalCandidates } = await runScreening(3);
    
    console.log('--------------------------------------------------');
    console.log(`✅ Test execution completed successfully!`);
    console.log(`Found: ${results.length} tokens (screened from total ${totalCandidates} candidates)`);
    
    if (results.length > 0) {
      console.log(`CSV written to: ${csvPath}`);
      console.log('\nResults Preview:');
      results.forEach((token, idx) => {
        console.log(`\n${idx + 1}. ${token.symbol} (${token.name})`);
        console.log(`   Address: ${token.address}`);
        console.log(`   Age: ${token.age_days} days`);
        console.log(`   Current Mcap: $${token.current_mcap}`);
        console.log(`   ATH Mcap: $${token.ath_mcap} (-${token.dump_percent}%)`);
        console.log(`   Averages: 3D: $${token.avg_mcap_3d} | 7D: $${token.avg_mcap_7d} | 30D: $${token.avg_mcap_30d}`);
        console.log(`   Max Tx Gap: ${token.max_tx_gap_hours} hours (Last Tx: ${token.last_tx_time_wib})`);
      });

      // Conditional Telegram sending if secrets are configured
      const isTokenConfigured = SECRETS.TELEGRAM_BOT_TOKEN && 
                                SECRETS.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN';
      const isChatIdConfigured = SECRETS.TELEGRAM_CHAT_ID && 
                                 SECRETS.TELEGRAM_CHAT_ID !== 'YOUR_TELEGRAM_CHAT_ID';

      if (isTokenConfigured && isChatIdConfigured) {
        console.log('\n[Telegram] Credentials detected in .env. Sending test output to Telegram...');
        const bot = new Telegraf(SECRETS.TELEGRAM_BOT_TOKEN);
        
        // Send CSV document
        await bot.telegram.sendDocument(SECRETS.TELEGRAM_CHAT_ID, {
          source: fs.readFileSync(csvPath),
          filename: path.basename(csvPath)
        }, {
          caption: `🧪 Test Run: ${results.length} dari ${totalCandidates} token ditemukan.`
        });

        // Send summary text message
        const textDetails = buildSummaryMessage(results, totalCandidates);
        await bot.telegram.sendMessage(SECRETS.TELEGRAM_CHAT_ID, `🧪 *[TEST RUN SUMMARY]*\n\n` + textDetails, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });

        console.log('📬 [Telegram] Successfully sent CSV and summary message to Telegram!');
      } else {
        console.log('\n💡 [Telegram] Secrets not configured in .env. Skipping Telegram delivery.');
      }
    } else {
      console.log('No matching zombie tokens found in this run.');
    }
  } catch (error) {
    console.error('❌ Test execution failed:', error);
  }
}

main();

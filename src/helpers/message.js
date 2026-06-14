import { formatToWIB } from './time.js';

/**
 * Builds the summary text message for a list of tokens.
 * @param {Array<Object>} tokens
 * @param {number} [totalCandidates]
 * @returns {string}
 */
export function buildSummaryMessage(tokens, totalCandidates) {
  let message = `🎯 *Tokens Found (${tokens.length})*\n`;
  message += `Time: \`${formatToWIB(Date.now())}\`\n`;
  if (totalCandidates !== undefined) {
    message += `Filtered from: \`${totalCandidates}\` candidates\n`;
  }
  message += `\n`;

  tokens.forEach((t, i) => {
    message += `${i + 1}. *${t.symbol}* (${t.name})\n`;
    message += `   • Address: \`${t.address}\`\n`;
    message += `   • Age: \`${t.age_days} days\`\n`;
    message += `   • Current Mcap: \`$${t.current_mcap}\`\n`;
    message += `   • ATH Mcap: \`$${t.ath_mcap}\` (-${t.dump_percent}%)\n`;
    message += `   • Averages: 3D: \`$${t.avg_mcap_3d}\` | 7D: \`$${t.avg_mcap_7d}\` | 30D: \`$${t.avg_mcap_30d}\`\n`;
    message += `   • Max Tx Gap: \`${t.max_tx_gap_hours}h\` (Last: ${t.last_tx_time_wib})\n`;
    message += `   • Tx Count (24H): \`${t.buy_count_24h}x Buy | ${t.sell_count_24h}x Sell\`\n`;
    message += `   • Large Buy (1D): \`$${t.largest_buy_usd_1d}\` (Wallet: \`${t.largest_buy_wallet_1d}\` | Time: \`${t.largest_buy_time_wib_1d}\`)\n`;
    message += `   • Large Buy (3D): \`$${t.largest_buy_usd_3d}\` (Wallet: \`${t.largest_buy_wallet_3d}\` | Time: \`${t.largest_buy_time_wib_3d}\`)\n`;
    message += `   • Large Buy (7D): \`$${t.largest_buy_usd}\` (Wallet: \`${t.largest_buy_wallet}\` | Time: \`${t.largest_buy_time_wib}\`)\n`;
    message += `   • Socials: [Twitter](${t.twitter}) | [Website](${t.website})\n\n`;
  });

  return message;
}

/**
 * Builds the text message summary for a single checked token.
 * @param {Object} t
 * @param {Object} config
 * @returns {string}
 */
export function buildSingleCheckMessage(t, config) {
  let message = `🔍 *Hasil Check Token*\n`;
  message += `*${t.symbol}* (${t.name})\n\n`;
  message += `• Address: \`${t.address}\`\n`;
  message += `• Age: \`${t.age_days} days\` ${t.passesFilters.age ? '✅' : `❌ (min ${config.minTokenAgeDays}d)`}\n`;
  message += `• Current Mcap: \`$${t.current_mcap}\` ${t.passesFilters.mcap ? '✅' : `❌ (range $${(config.minMcap/1000).toFixed(1)}k - $${(config.maxMcap/1000).toFixed(1)}k)`}\n`;
  message += `• ATH Mcap: \`$${t.ath_mcap}\` (-${t.dump_percent}%) ${t.passesFilters.ath ? '✅' : `❌ (min $${(config.minAthMcap/1000).toFixed(1)}k)`}\n`;
  message += `• Averages: 3D: \`$${t.avg_mcap_3d}\` | 7D: \`$${t.avg_mcap_7d}\` | 30D: \`$${t.avg_mcap_30d}\`\n`;
  message += `• Max Tx Gap: \`${t.max_tx_gap_hours}h\` (Last: ${t.last_tx_time_wib}) ${t.passesFilters.gap ? '✅' : '❌ (>24h gap)'}\n`;
  message += `• Tx Count (24H): \`${t.buy_count_24h}x Buy | ${t.sell_count_24h}x Sell\`\n`;
  message += `• Large Buy (1D): \`$${t.largest_buy_usd_1d}\` (Wallet: \`${t.largest_buy_wallet_1d}\` | Time: \`${t.largest_buy_time_wib_1d}\`)\n`;
  message += `• Large Buy (3D): \`$${t.largest_buy_usd_3d}\` (Wallet: \`${t.largest_buy_wallet_3d}\` | Time: \`${t.largest_buy_time_wib_3d}\`)\n`;
  message += `• Large Buy (7D): \`$${t.largest_buy_usd}\` (Wallet: \`${t.largest_buy_wallet}\` | Time: \`${t.largest_buy_time_wib}\`) ${t.passesFilters.largestBuy ? '✅' : `❌ (min $${config.minLargestBuyUsd})`}\n`;
  message += `• Socials: [Twitter](${t.twitter}) | [Website](${t.website})\n\n`;
  
  const allPassed = Object.values(t.passesFilters).every(v => v);
  message += `🚦 *Status:* ${allPassed ? '🟢 *PASSED* (Koin ini memenuhi semua kriteria)' : '🔴 *FAILED* (Ada kriteria yang tidak terpenuhi)'}`;

  return message;
}

export default {
  buildSummaryMessage,
  buildSingleCheckMessage
};

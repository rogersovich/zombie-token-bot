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
    message += `   • Socials: [Twitter](${t.twitter}) | [Website](${t.website})\n\n`;
  });

  return message;
}

export default {
  buildSummaryMessage
};

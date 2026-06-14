import { formatToWIB } from './time.js';
import { formatMcap } from './format.js';

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
  let message = `🔍 *Token Check Results*\n`;
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
  message += `🚦 *Status:* ${allPassed ? '🟢 *PASSED* (This token meets all criteria)' : '🔴 *FAILED* (Some criteria are not met)'}`;

  return message;
}

export function buildPnLMessage(orders, config = null) {
  if (orders.length === 0) {
    return '📝 *No orders recorded yet.*';
  }

  let message = `📊 *Order Monitoring PnL Report (${orders.length})*\n\n`;

  orders.forEach((o, i) => {
    const buyPrice = o.price_usd || 0;
    const currentPrice = o.current_price_usd || buyPrice;
    const buyMcap = o.mcap || 0;
    const currentMcap = o.current_mcap || buyMcap;

    const priceChangePct = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;
    const mcapChangePct = buyMcap > 0 ? ((currentMcap - buyMcap) / buyMcap) * 100 : 0;

    const modalUsd = o.buy_amount_usd || 0;
    const tokenQty = o.token_qty || 0;
    const currentValueUsd = tokenQty * currentPrice;
    const pnlUsd = currentValueUsd - modalUsd;

    const minTp = config?.minTakeProfitPercent ?? 50;
    const tpAchieved = priceChangePct >= minTp;
    const tpMarker = tpAchieved ? ' 🎯 *Take Profit Achieved!*' : '';

    const statusEmoji = priceChangePct >= 0 ? '🟢' : '🔴';
    const sign = priceChangePct >= 0 ? '+' : '';

    message += `${i + 1}. *${o.symbol}* (${o.name}) \`[${o.type.toUpperCase()}]\`\n`;
    message += `   • Address: \`${o.address}\`\n`;
    message += `   • Initial Capital: \`$${modalUsd.toFixed(2)}\` (${tokenQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)\n`;
    message += `   • Buy Price: \`$${buyPrice.toFixed(8)}\` (Mcap: \`$${o.mcap ? formatMcap(o.mcap) : 'N/A'}\`)\n`;
    message += `   • Current Price: \`$${currentPrice.toFixed(8)}\` (Mcap: \`$${currentMcap ? formatMcap(currentMcap) : 'N/A'}\`)\n`;
    message += `   • Current Value: \`$${currentValueUsd.toFixed(2)}\`\n`;
    message += `   • PnL: ${statusEmoji} \`${sign}${priceChangePct.toFixed(2)}%\` (\`${sign}$${pnlUsd.toFixed(2)}\`)${tpMarker}\n`;
    message += `   • Purchased At: \`${formatToWIB(o.created_at)}\`\n`;
    if (o.updated_at) {
      message += `   • Last Updated: \`${formatToWIB(o.updated_at)}\`\n`;
    }
    message += `\n`;
  });

  return message;
}

export default {
  buildSummaryMessage,
  buildSingleCheckMessage,
  buildPnLMessage
};

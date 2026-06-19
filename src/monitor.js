import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';
import { shouldAlertToken, markTokenAlerted } from './db.js';
import jupApi from './jupApi.js';
import { formatToWIB, dayjs } from './helpers/time.js';
import { saveToCSV } from './helpers/csv.js';
import { formatMcap } from './helpers/format.js';

/**
 * Validates transaction gap for a token in the last 7 days.
 * Ensures the gap between consecutive buy/sell transactions is <= 24 hours.
 * Also ensures the most recent transaction is <= 24 hours old.
 * @param {string} address
 * @returns {Promise<{ isValid: boolean, maxGapHours: number, lastTxTime: string|null }>}
 */
async function validateTransactionGap(address) {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let allTxs = [];
  let offset = null;
  let offsetTs = null;
  let reachedLimit = false;

  // Fetch up to 500 transactions or until we cross the 7-day threshold
  for (let page = 0; page < 10; page++) {
    try {
      const response = await jupApi.getTransactions(address, offset, offsetTs);
      const txs = response.txs || [];
      if (txs.length === 0) break;

      allTxs.push(...txs);

      // Check if the oldest tx in this batch is already past 7 days
      const oldestTx = txs[txs.length - 1];
      const oldestTxTime = new Date(oldestTx.timestamp).getTime();

      if (oldestTxTime < oneWeekAgo) {
        reachedLimit = true;
        break;
      }

      if (!response.next) break;
      offset = response.next;
      // Get offset timestamp from the oldest tx in the page
      offsetTs = oldestTx.timestamp;
    } catch (error) {
      console.error(`[Monitor] Error fetching transactions for ${address}:`, error.message);
      break;
    }
  }

  // Filter transactions within the last 7 days
  const weekTxs = allTxs.filter(tx => new Date(tx.timestamp).getTime() >= oneWeekAgo);

  if (weekTxs.length === 0) {
    return {
      isValid: false,
      maxGapHours: 0,
      lastTxTime: null,
      largestBuyUsd: 0,
      largestBuyWallet: 'N/A',
      largestBuyTime: null,
      largestBuyUsd3d: 0,
      largestBuyWallet3d: 'N/A',
      largestBuyTime3d: null,
      largestBuyUsd1d: 0,
      largestBuyWallet1d: 'N/A',
      largestBuyTime1d: null,
      buyCount24h: 0,
      sellCount24h: 0
    };
  }

  // Sort transactions chronologically (oldest first)
  weekTxs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let maxGapHours = 0;
  const now = Date.now();
  let gapIsValid = true;

  // Check gap between current time and the most recent transaction
  const mostRecentTx = weekTxs[weekTxs.length - 1];
  const lastTxTimeMs = new Date(mostRecentTx.timestamp).getTime();
  const gapToNow = (now - lastTxTimeMs) / (1000 * 60 * 60);
  
  if (gapToNow > 24) {
    gapIsValid = false;
  }
  maxGapHours = gapToNow;

  // Check gap between consecutive transactions in the last 7 days
  for (let i = 1; i < weekTxs.length; i++) {
    const txA = weekTxs[i - 1];
    const txB = weekTxs[i];
    const timeA = new Date(txA.timestamp).getTime();
    const timeB = new Date(txB.timestamp).getTime();
    const gapHours = (timeB - timeA) / (1000 * 60 * 60);

    if (gapHours > maxGapHours) {
      maxGapHours = gapHours;
    }

    if (gapHours > 24) {
      gapIsValid = false;
    }
  }

  const nowMs = Date.now();
  const threeDaysAgoMs = nowMs - 3 * 24 * 60 * 60 * 1000;
  const oneDayAgoMs = nowMs - 24 * 60 * 60 * 1000;

  // Filter buys for different intervals
  const weekBuys = weekTxs.filter(tx => tx.type === 'buy');
  const threeDaysBuys = weekTxs.filter(tx => tx.type === 'buy' && new Date(tx.timestamp).getTime() >= threeDaysAgoMs);
  const oneDayBuys = weekTxs.filter(tx => tx.type === 'buy' && new Date(tx.timestamp).getTime() >= oneDayAgoMs);

  // 24h buy/sell counts
  const dayTxs = weekTxs.filter(tx => new Date(tx.timestamp).getTime() >= oneDayAgoMs);
  const buyCount24h = dayTxs.filter(tx => tx.type === 'buy').length;
  const sellCount24h = dayTxs.filter(tx => tx.type === 'sell').length;

  // Calculate 7D Largest Buy
  let largestBuyUsd = 0;
  let largestBuyWallet = 'N/A';
  let largestBuyTime = null;
  if (weekBuys.length > 0) {
    let maxBuyTx = weekBuys[0];
    for (let i = 1; i < weekBuys.length; i++) {
      if ((weekBuys[i].usdVolume || 0) > (maxBuyTx.usdVolume || 0)) {
        maxBuyTx = weekBuys[i];
      }
    }
    largestBuyUsd = maxBuyTx.usdVolume || 0;
    largestBuyWallet = maxBuyTx.traderAddress || 'N/A';
    largestBuyTime = maxBuyTx.timestamp || null;
  }

  // Calculate 3D Largest Buy
  let largestBuyUsd3d = 0;
  let largestBuyWallet3d = 'N/A';
  let largestBuyTime3d = null;
  if (threeDaysBuys.length > 0) {
    let maxBuyTx = threeDaysBuys[0];
    for (let i = 1; i < threeDaysBuys.length; i++) {
      if ((threeDaysBuys[i].usdVolume || 0) > (maxBuyTx.usdVolume || 0)) {
        maxBuyTx = threeDaysBuys[i];
      }
    }
    largestBuyUsd3d = maxBuyTx.usdVolume || 0;
    largestBuyWallet3d = maxBuyTx.traderAddress || 'N/A';
    largestBuyTime3d = maxBuyTx.timestamp || null;
  }

  // Calculate 1D Largest Buy
  let largestBuyUsd1d = 0;
  let largestBuyWallet1d = 'N/A';
  let largestBuyTime1d = null;
  if (oneDayBuys.length > 0) {
    let maxBuyTx = oneDayBuys[0];
    for (let i = 1; i < oneDayBuys.length; i++) {
      if ((oneDayBuys[i].usdVolume || 0) > (maxBuyTx.usdVolume || 0)) {
        maxBuyTx = oneDayBuys[i];
      }
    }
    largestBuyUsd1d = maxBuyTx.usdVolume || 0;
    largestBuyWallet1d = maxBuyTx.traderAddress || 'N/A';
    largestBuyTime1d = maxBuyTx.timestamp || null;
  }

  return {
    isValid: gapIsValid,
    maxGapHours,
    lastTxTime: mostRecentTx.timestamp,
    largestBuyUsd,
    largestBuyWallet,
    largestBuyTime,
    largestBuyUsd3d,
    largestBuyWallet3d,
    largestBuyTime3d,
    largestBuyUsd1d,
    largestBuyWallet1d,
    largestBuyTime1d,
    buyCount24h,
    sellCount24h
  };
}

/**
 * Helper to fetch all daily candles for a token using batching.
 * Fetches in chunks of 90 candles (3 months) using 1_DAY interval.
 * @param {string} address
 * @param {number} ageDays
 * @returns {Promise<Array<Object>>}
 */
async function fetchAllDailyCandles(address, ageDays) {
  const candlesToFetch = Math.ceil(ageDays) + 5;
  const batchSize = 90;
  const allCandles = [];
  let currentTo = Date.now();

  // Safeguard limit to avoid infinite loops on extremely old tokens
  const maxCandlesLimit = 730; // Max 2 years of daily data

  while (allCandles.length < Math.min(candlesToFetch, maxCandlesLimit)) {
    const remaining = Math.min(candlesToFetch, maxCandlesLimit) - allCandles.length;
    const limit = Math.min(remaining, batchSize);
    
    try {
      const batch = await jupApi.getCharts(address, '1_DAY', limit, currentTo);
      if (!batch || batch.length === 0) break;

      allCandles.push(...batch);

      // Sort batch to find the oldest candle in the batch
      batch.sort((a, b) => a.time - b.time);
      const oldestCandle = batch[0];

      // Next batch should fetch candles older than this oldest one.
      // oldestCandle.time is in seconds. Convert to ms and subtract 1 day.
      currentTo = (oldestCandle.time - 86400) * 1000;

      if (batch.length < limit) break; // Reached the beginning of the chart history
    } catch (error) {
      console.error(`[Monitor] Error fetching chart batch for ${address}:`, error.message);
      break;
    }
  }

  // Sort all merged candles chronologically
  allCandles.sort((a, b) => a.time - b.time);
  return allCandles;
}

/**
 * Calculates historical ATH and 3D, 7D, 30D average market caps.
 * Uses 1_DAY candle batches to assemble the full history.
 * @param {string} address
 * @param {number} ageDays
 * @returns {Promise<{ athMcap: number, avg3d: number, avg7d: number, avg30d: number }>}
 */
async function analyzeMarketCap(address, ageDays) {
  let athMcap = 0;
  let avg3d = 0;
  let avg7d = 0;
  let avg30d = 0;
  let min7d = 0;
  let min30d = 0;

  try {
    const dailyCandles = await fetchAllDailyCandles(address, ageDays);

    if (dailyCandles && dailyCandles.length > 0) {
      // 1. Calculate ATH
      athMcap = Math.max(...dailyCandles.map(c => c.high || 0));

      // 2. Calculate Averages and Minimums from the latest candles
      const closeValues = dailyCandles.map(c => c.close || 0);
      const lowValues = dailyCandles.map(c => c.low || c.close || 0);
      const len = closeValues.length;
      const sum = (arr) => arr.reduce((acc, val) => acc + val, 0);

      const last3 = closeValues.slice(Math.max(0, len - 3));
      const last7 = closeValues.slice(Math.max(0, len - 7));
      const last30 = closeValues.slice(Math.max(0, len - 30));

      const last7Lows = lowValues.slice(Math.max(0, len - 7));
      const last30Lows = lowValues.slice(Math.max(0, len - 30));

      avg3d = last3.length > 0 ? sum(last3) / last3.length : 0;
      avg7d = last7.length > 0 ? sum(last7) / last7.length : 0;
      avg30d = last30.length > 0 ? sum(last30) / last30.length : 0;

      min7d = last7Lows.length > 0 ? Math.min(...last7Lows) : 0;
      min30d = last30Lows.length > 0 ? Math.min(...last30Lows) : 0;
    }
  } catch (error) {
    console.error(`[Monitor] Error analyzing market cap for ${address}:`, error.message);
  }

  return {
    athMcap,
    avg3d,
    avg7d,
    avg30d,
    min7d,
    min30d
  };
}

/**
 * Runs the screening process.
 * @param {number|null} [maxTokensToProcess=null]
 * @returns {Promise<{ results: Array<Object>, csvPath: string|null }>}
 */
export async function runScreening(maxTokensToProcess = null) {
  console.log('[Monitor] Starting screening run at:', formatToWIB(Date.now()));
  console.log('[Monitor] Settings:', CONFIG);

  const matchedTokens = [];

  try {
    // 1. Get Top Trending list based on criteria
    const trending = await jupApi.getTopTrending({
      minMcap: CONFIG.minMcap,
      maxMcap: CONFIG.maxMcap,
      minVolume24h: CONFIG.minVolume24h,
      minHolderCount: CONFIG.minHolderCount,
      minTokenAgeDays: CONFIG.minTokenAgeDays
    });

    console.log(`[Monitor] Retrieved ${trending.length} trending candidates from Jupiter.`);

    let processedCount = 0;

    for (const token of trending) {
      if (maxTokensToProcess !== null && processedCount >= maxTokensToProcess) {
        console.log(`[Monitor] Reached testing token processing limit of ${maxTokensToProcess}. Stopping loop.`);
        break;
      }

      const address = token.id;

      // 2. Database Check to prevent duplicates within 24 hours
      if (!shouldAlertToken(address)) {
        console.log(`[Monitor] Token ${token.symbol} (${address}) recently alerted. Skipping.`);
        continue;
      }

      processedCount++;
      console.log(`[Monitor] Processing token (${processedCount}/${maxTokensToProcess || trending.length}): ${token.symbol} (${address})`);

      try {
        // 3. Fetch detailed search info to get createdAt and accurate social links
        const details = await jupApi.searchAsset(address);
        if (!details) {
          console.warn(`[Monitor] Details not found for ${address}. Skipping.`);
          continue;
        }

        // Calculate token age in days
        const createdAtMs = new Date(details.createdAt || token.createdAt).getTime();
        const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);

        if (ageDays <= CONFIG.minTokenAgeDays) {
          console.log(`[Monitor] Token ${token.symbol} age is ${ageDays.toFixed(1)} days (must be greater than ${CONFIG.minTokenAgeDays}). Skipping.`);
          continue;
        }

        // 4. Validate transaction gap (gap <= 24h) and largest buy USD
        const txValidation = await validateTransactionGap(address);
        if (!txValidation.isValid) {
          console.log(`[Monitor] Token ${token.symbol} transaction gap exceeds 24h. Skipping.`);
          continue;
        }

        if (txValidation.largestBuyUsd < CONFIG.minLargestBuyUsd) {
          console.log(`[Monitor] Token ${token.symbol} largest buy is $${txValidation.largestBuyUsd.toFixed(2)} (minimum $${CONFIG.minLargestBuyUsd} required). Skipping.`);
          continue;
        }

        // 5. Historical charts analysis (ATH & averages)
        const mcAnalysis = await analyzeMarketCap(address, ageDays);

        if (mcAnalysis.athMcap < CONFIG.minAthMcap) {
          console.log(`[Monitor] Token ${token.symbol} ATH Mcap is $${mcAnalysis.athMcap.toFixed(2)} (minimum $${CONFIG.minAthMcap} required). Skipping.`);
          continue;
        }

        // Calculate dump percentage from ATH to current market cap
        const currentMcap = details.mcap || token.mcap || 0;
        const dumpPercent = mcAnalysis.athMcap > 0 ? ((1 - currentMcap / mcAnalysis.athMcap) * 100) : 0;

        // Token passed all validations
        const resultObj = {
          address: address,
          name: details.name || token.name,
          symbol: details.symbol || token.symbol,
          age_days: ageDays.toFixed(1),
          current_mcap: formatMcap(currentMcap),
          ath_mcap: formatMcap(mcAnalysis.athMcap),
          dump_percent: dumpPercent.toFixed(1),
          avg_mcap_3d: formatMcap(mcAnalysis.avg3d),
          avg_mcap_7d: formatMcap(mcAnalysis.avg7d),
          avg_mcap_30d: formatMcap(mcAnalysis.avg30d),
          min_mcap_7d: formatMcap(mcAnalysis.min7d),
          min_mcap_30d: formatMcap(mcAnalysis.min30d),
          max_tx_gap_hours: txValidation.maxGapHours.toFixed(1),
          last_tx_time_wib: formatToWIB(txValidation.lastTxTime),
          largest_buy_usd: txValidation.largestBuyUsd.toFixed(1),
          largest_buy_wallet: txValidation.largestBuyWallet,
          largest_buy_time_wib: formatToWIB(txValidation.largestBuyTime),
          largest_buy_usd_3d: txValidation.largestBuyUsd3d.toFixed(1),
          largest_buy_wallet_3d: txValidation.largestBuyWallet3d,
          largest_buy_time_wib_3d: formatToWIB(txValidation.largestBuyTime3d),
          largest_buy_usd_1d: txValidation.largestBuyUsd1d.toFixed(1),
          largest_buy_wallet_1d: txValidation.largestBuyWallet1d,
          largest_buy_time_wib_1d: formatToWIB(txValidation.largestBuyTime1d),
          buy_count_24h: txValidation.buyCount24h,
          sell_count_24h: txValidation.sellCount24h,
          website: details.website || 'N/A',
          twitter: details.twitter || 'N/A'
        };

        console.log(`[Monitor] MATCH FOUND! ${token.symbol} - ATH: ${resultObj.ath_mcap}, Current Mcap: ${resultObj.current_mcap}`);
        matchedTokens.push(resultObj);
        
        // Mark token in database
        markTokenAlerted(address);
      } catch (tokenError) {
        console.error(`[Monitor] Error screening token ${token.symbol || 'N/A'} (${address}): ${tokenError.message}. Skipping to next token.`);
      }
    }

    if (matchedTokens.length === 0) {
      console.log('[Monitor] Screening completed. No matching tokens found.');
      return { results: [], csvPath: null, totalCandidates: trending.length };
    }

    // Generate CSV output file
    const reportsDir = path.resolve(process.cwd(), 'reports');
    const timestampStr = dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD_HH-mm-ss');
    const csvFileName = `zombie_tokens_${timestampStr}_WIB.csv`;
    const csvFilePath = path.join(reportsDir, csvFileName);

    const fields = [
      { key: 'symbol', label: 'Symbol' },
      { key: 'name', label: 'Name' },
      { key: 'address', label: 'Address' },
      { key: 'age_days', label: 'Age (Days)' },
      { key: 'current_mcap', label: 'Current Mcap ($)' },
      { key: 'ath_mcap', label: 'ATH Mcap ($)' },
      { key: 'dump_percent', label: 'Dump (%)' },
      { key: 'avg_mcap_3d', label: 'Avg Mcap 3D ($)' },
      { key: 'avg_mcap_7d', label: 'Avg Mcap 7D ($)' },
      { key: 'avg_mcap_30d', label: 'Avg Mcap 30D ($)' },
      { key: 'min_mcap_7d', label: 'Min Mcap 7D ($)' },
      { key: 'min_mcap_30d', label: 'Min Mcap 30D ($)' },
      { key: 'max_tx_gap_hours', label: 'Max Tx Gap (Hours)' },
      { key: 'last_tx_time_wib', label: 'Last Tx (WIB)' },
      { key: 'largest_buy_usd', label: 'Largest Buy 7D ($)' },
      { key: 'largest_buy_wallet', label: 'Largest Buy 7D Wallet' },
      { key: 'largest_buy_time_wib', label: 'Largest Buy 7D Time (WIB)' },
      { key: 'largest_buy_usd_3d', label: 'Largest Buy 3D ($)' },
      { key: 'largest_buy_wallet_3d', label: 'Largest Buy 3D Wallet' },
      { key: 'largest_buy_time_wib_3d', label: 'Largest Buy 3D Time (WIB)' },
      { key: 'largest_buy_usd_1d', label: 'Largest Buy 1D ($)' },
      { key: 'largest_buy_wallet_1d', label: 'Largest Buy 1D Wallet' },
      { key: 'largest_buy_time_wib_1d', label: 'Largest Buy 1D Time (WIB)' },
      { key: 'buy_count_24h', label: 'Buy Count 24H' },
      { key: 'sell_count_24h', label: 'Sell Count 24H' },
      { key: 'website', label: 'Website' },
      { key: 'twitter', label: 'Twitter' }
    ];

    saveToCSV(matchedTokens, fields, csvFilePath);
    console.log(`[Monitor] Screening completed. ${matchedTokens.length} tokens saved to: ${csvFilePath}`);

    return {
      results: matchedTokens,
      csvPath: csvFilePath,
      totalCandidates: trending.length
    };

  } catch (error) {
    console.error('[Monitor] Screening process failed:', error.message);
    throw error;
  }
}

/**
 * Analyzes and screens a single token by its contract address.
 * Bypasses database alerted checks and database writes.
 * @param {string} address
 * @returns {Promise<Object|null>}
 */
export async function screenSingleToken(address) {
  console.log(`[Monitor] Manual single token check initiated for: ${address}`);
  
  const details = await jupApi.searchAsset(address);
  if (!details) {
    return null;
  }

  // Calculate token age
  const createdAtMs = new Date(details.createdAt).getTime();
  const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);

  // Validate transaction gap
  const txValidation = await validateTransactionGap(address);

  // Historical charts analysis (ATH & averages)
  const mcAnalysis = await analyzeMarketCap(address, ageDays);

  const currentMcap = details.mcap || 0;
  const dumpPercent = mcAnalysis.athMcap > 0 ? ((1 - currentMcap / mcAnalysis.athMcap) * 100) : 0;

  return {
    address: address,
    name: details.name,
    symbol: details.symbol,
    age_days: ageDays.toFixed(1),
    current_mcap: formatMcap(currentMcap),
    ath_mcap: formatMcap(mcAnalysis.athMcap),
    dump_percent: dumpPercent.toFixed(1),
    avg_mcap_3d: formatMcap(mcAnalysis.avg3d),
    avg_mcap_7d: formatMcap(mcAnalysis.avg7d),
    avg_mcap_30d: formatMcap(mcAnalysis.avg30d),
    min_mcap_7d: formatMcap(mcAnalysis.min7d),
    min_mcap_30d: formatMcap(mcAnalysis.min30d),
    max_tx_gap_hours: txValidation.maxGapHours.toFixed(1),
    last_tx_time_wib: formatToWIB(txValidation.lastTxTime),
    largest_buy_usd: txValidation.largestBuyUsd.toFixed(1),
    largest_buy_wallet: txValidation.largestBuyWallet,
    largest_buy_time_wib: formatToWIB(txValidation.largestBuyTime),
    largest_buy_usd_3d: txValidation.largestBuyUsd3d.toFixed(1),
    largest_buy_wallet_3d: txValidation.largestBuyWallet3d,
    largest_buy_time_wib_3d: formatToWIB(txValidation.largestBuyTime3d),
    largest_buy_usd_1d: txValidation.largestBuyUsd1d.toFixed(1),
    largest_buy_wallet_1d: txValidation.largestBuyWallet1d,
    largest_buy_time_wib_1d: formatToWIB(txValidation.largestBuyTime1d),
    buy_count_24h: txValidation.buyCount24h,
    sell_count_24h: txValidation.sellCount24h,
    website: details.website || 'N/A',
    twitter: details.twitter || 'N/A',
    passesFilters: {
      age: ageDays > CONFIG.minTokenAgeDays,
      mcap: currentMcap >= CONFIG.minMcap && currentMcap <= CONFIG.maxMcap,
      gap: txValidation.isValid,
      ath: mcAnalysis.athMcap >= CONFIG.minAthMcap,
      largestBuy: txValidation.largestBuyUsd >= CONFIG.minLargestBuyUsd
    }
  };
}

export default {
  runScreening,
  screenSingleToken
};

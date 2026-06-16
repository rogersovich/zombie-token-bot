/**
 * Jupiter Data API Wrapper Module
 * Uses native fetch built into Node.js.
 */

const BASE_URL = 'https://datapi.jup.ag';

/**
 * Utility function to perform fetch with retries on rate limits (429) or temporary errors.
 * @param {string} url
 * @param {number} retries
 * @param {number} delayMs
 * @returns {Promise<any>}
 */
async function fetchWithRetry(url, retries = 3, delayMs = 10000) {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds hard timeout

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        console.warn(`[API Rate Limit 429] Retrying URL: ${url} (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, i)));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (i === retries - 1) {
        throw error;
      }
      console.warn(`[API Request Error] ${error.message === 'The user aborted a request.' ? 'Request Timeout (30s)' : error.message}. Retrying ${url} in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Fetches the top trending assets based on config parameters.
 * @param {Object} params
 * @param {number} params.minMcap
 * @param {number} params.maxMcap
 * @param {number} params.minVolume24h
 * @param {number} params.minHolderCount
 * @param {number} params.minTokenAgeDays
 * @returns {Promise<Array<Object>>}
 */
export async function getTopTrending({
  minMcap = 2000,
  maxMcap = 5000,
  minVolume24h = 1000,
  minHolderCount = 100,
  minTokenAgeDays = 7
}) {
  const minTokenAgeMinutes = minTokenAgeDays * 24 * 60;
  const url = `${BASE_URL}/v2/assets/toptrending/24h?sortBy=listedTime&sortDir=desc&minVolume24h=${minVolume24h}&minMcap=${minMcap}&maxMcap=${maxMcap}&minHolderCount=${minHolderCount}&hasSocials=true&onlyDexPaid=true&onlyDevSold=true&minTokenAge=${minTokenAgeMinutes}`;
  
  console.log(`[JUP-API] Querying Top Trending: ${url}`);
  const result = await fetchWithRetry(url);
  return result.assets || [];
}

/**
 * Searches details for a specific asset token address.
 * @param {string} address
 * @returns {Promise<Object|null>}
 */
export async function searchAsset(address) {
  const url = `${BASE_URL}/v1/assets/search?query=${address}&filters=exact_address`;
  const result = await fetchWithRetry(url);
  if (Array.isArray(result) && result.length > 0) {
    return result[0];
  }
  return null;
}

/**
 * Fetches transactions of type buy and sell for an asset.
 * @param {string} address
 * @param {string} [offset] Optional pagination offset
 * @param {string} [offsetTs] Optional pagination offset timestamp
 * @returns {Promise<{txs: Array<Object>, next: string|null}>}
 */
export async function getTransactions(address, offset = null, offsetTs = null) {
  let url = `${BASE_URL}/v1/txs/${address}?dir=desc&types=buy%2Csell`;
  if (offset) {
    url += `&offset=${offset}`;
  }
  if (offsetTs) {
    url += `&offsetTs=${encodeURIComponent(offsetTs)}`;
  }
  const result = await fetchWithRetry(url);
  return {
    txs: Array.isArray(result) ? result : (result.txs || []),
    next: result.next || null
  };
}

/**
 * Fetches market cap charts for an asset.
 * @param {string} address
 * @param {'1_DAY'|'1_WEEK'} interval
 * @param {number} candles
 * @param {number} toTimestampMs Epoch timestamp in milliseconds
 * @returns {Promise<Array<Object>>}
 */
export async function getCharts(address, interval = '1_DAY', candles = 30, toTimestampMs = Date.now()) {
  const url = `${BASE_URL}/v2/charts/${address}?interval=${interval}&to=${toTimestampMs}&candles=${candles}&type=mcap&quote=usd`;
  const result = await fetchWithRetry(url);
  return result.candles || [];
}

export default {
  getTopTrending,
  searchAsset,
  getTransactions,
  getCharts
};

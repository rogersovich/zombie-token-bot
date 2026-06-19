/**
 * Formatting utility helpers
 */

/**
 * Formats a market cap number to a shorthand string (e.g., 3400 -> 3.4k, 1200000 -> 1.2M).
 * @param {number|string} value
 * @returns {string}
 */
export function formatMcap(value) {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    return '0';
  }
  if (num >= 1000000) {
    const val = Number((num / 1000000).toFixed(2));
    return `${val}M`;
  }
  if (num >= 1000) {
    const val = Number((num / 1000).toFixed(2));
    return `${val}k`;
  }
  return num.toFixed(0);
}

export default {
  formatMcap
};

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

// Set default timezone to WIB (Asia/Jakarta)
const WIB_TZ = 'Asia/Jakarta';

/**
 * Formats a given timestamp, ISO string, or Date to WIB timezone string.
 * @param {string|number|Date|dayjs.Dayjs} val
 * @param {string} [formatStr='YYYY-MM-DD HH:mm:ss [WIB]']
 * @returns {string}
 */
export function formatToWIB(val, formatStr = 'YYYY-MM-DD HH:mm:ss [WIB]') {
  if (!val) return 'N/A';
  return dayjs(val).tz(WIB_TZ).format(formatStr);
}

/**
 * Returns current time in WIB as a dayjs object.
 * @returns {dayjs.Dayjs}
 */
export function nowWIB() {
  return dayjs().tz(WIB_TZ);
}

/**
 * Formats the current time to WIB string.
 * @returns {string}
 */
export function nowWIBString() {
  return formatToWIB(Date.now(), 'YYYY-MM-DD_HH-mm-ss_[WIB]');
}

/**
 * Calculates absolute hour difference between two date inputs.
 * @param {string|number|Date} a
 * @param {string|number|Date} b
 * @returns {number}
 */
export function hourDiff(a, b) {
  const t1 = dayjs(a);
  const t2 = dayjs(b);
  return Math.abs(t1.diff(t2, 'hour', true));
}

export { dayjs };
export default {
  dayjs,
  formatToWIB,
  nowWIB,
  nowWIBString,
  hourDiff
};

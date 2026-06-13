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

/**
 * Calculates the next occurrence of a cron job matching "0 */N * * *"
 * and formats the result in WIB timezone along with remaining duration.
 * @param {string} cronExpression
 * @returns {{ nextRunTimeWIB: string, remainingStr: string }}
 */
export function getNextCronOccurrence(cronExpression) {
  let intervalHours = 4;
  try {
    const match = cronExpression.match(/0\s+\*\/(\d+)/);
    if (match) {
      intervalHours = parseInt(match[1], 10);
    }
  } catch (e) {}

  const now = dayjs(); // Local system time (e.g. UTC on VPS)
  const currentHour = now.hour();
  
  // Calculate next hour divisible by the interval
  let nextHour = Math.floor(currentHour / intervalHours) * intervalHours + intervalHours;
  let nextRun = now.hour(nextHour).minute(0).second(0).millisecond(0);
  
  const diffMs = nextRun.diff(now);
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  return {
    nextRunTimeWIB: nextRun.tz(WIB_TZ).format('YYYY-MM-DD HH:mm:ss [WIB]'),
    remainingStr: `${diffHours} jam ${diffMins} menit`
  };
}

export { dayjs };
export default {
  dayjs,
  formatToWIB,
  nowWIB,
  nowWIBString,
  hourDiff,
  getNextCronOccurrence
};

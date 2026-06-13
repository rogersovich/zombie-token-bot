import { dayjs } from './time.js';

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

/**
 * Overrides the default console logging methods to automatically prefix
 * every message with a WIB (Asia/Jakarta) timestamp.
 */
export function setupWibLogger() {
  console.log = (...args) => {
    const timestamp = dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
    originalLog(`[${timestamp}]`, ...args);
  };

  console.warn = (...args) => {
    const timestamp = dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
    originalWarn(`[${timestamp}] [WARN] ⚠️`, ...args);
  };

  console.error = (...args) => {
    const timestamp = dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
    originalError(`[${timestamp}] [ERROR] ❌`, ...args);
  };
}

export default setupWibLogger;

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'bot.db');
const db = new Database(dbPath);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS token_alerts (
    address TEXT PRIMARY KEY,
    alerted_at INTEGER NOT NULL
  )
`);

/**
 * Checks if a token should be alerted.
 * Returns true if the token has never been alerted or if the last alert was more than 24 hours ago.
 * @param {string} address
 * @returns {boolean}
 */
export function shouldAlertToken(address) {
  const row = db.prepare('SELECT alerted_at FROM token_alerts WHERE address = ?').get(address);
  if (!row) {
    return true;
  }
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return row.alerted_at < oneDayAgo;
}

/**
 * Records that a token has been alerted at the current timestamp.
 * @param {string} address
 */
export function markTokenAlerted(address) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO token_alerts (address, alerted_at)
    VALUES (?, ?)
    ON CONFLICT(address) DO UPDATE SET alerted_at = excluded.alerted_at
  `).run(address, now);
}

/**
 * Clears old alerts from the database.
 * Optional clean up utility.
 */
export function clearOldAlerts() {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM token_alerts WHERE alerted_at < ?').run(oneWeekAgo);
}

export default db;

import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'bot.db');
const db = new Database(dbPath);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS token_alerts (
    address TEXT PRIMARY KEY,
    alerted_at INTEGER NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    symbol TEXT,
    name TEXT,
    price_usd REAL,
    mcap REAL,
    type TEXT DEFAULT 'dryrun',
    created_at INTEGER NOT NULL,
    current_price_usd REAL,
    current_mcap REAL,
    updated_at INTEGER,
    buy_amount_usd REAL,
    token_qty REAL
  );

  CREATE TABLE IF NOT EXISTS limit_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    limit_mcap REAL NOT NULL,
    buy_amount_usd REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );
`);

// Alter existing tables if columns do not exist
try {
  db.exec('ALTER TABLE orders ADD COLUMN current_price_usd REAL');
} catch (_) {}
try {
  db.exec('ALTER TABLE orders ADD COLUMN current_mcap REAL');
} catch (_) {}
try {
  db.exec('ALTER TABLE orders ADD COLUMN updated_at INTEGER');
} catch (_) {}
try {
  db.exec('ALTER TABLE orders ADD COLUMN buy_amount_usd REAL');
} catch (_) {}
try {
  db.exec('ALTER TABLE orders ADD COLUMN token_qty REAL');
} catch (_) {}

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
 * Creates a mock/live order record in the database.
 * @param {Object} order
 * @param {string} order.address
 * @param {string} order.symbol
 * @param {string} order.name
 * @param {number} order.price_usd
 * @param {number} order.mcap
 * @param {'dryrun'|'live'} [order.type='dryrun']
 * @param {number} order.buy_amount_usd
 * @param {number} order.token_qty
 * @returns {number} The ID of the inserted order
 */
export function createOrder({ address, symbol, name, price_usd, mcap, type = 'dryrun', buy_amount_usd, token_qty }) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO orders (address, symbol, name, price_usd, mcap, type, created_at, buy_amount_usd, token_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(address, symbol, name, price_usd, mcap, type, now, buy_amount_usd, token_qty);
  
  return info.lastInsertRowid;
}

/**
 * Fetches all orders.
 * @returns {Array<Object>}
 */
export function getAllOrders() {
  return db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
}

/**
 * Fetches orders by token address.
 * @param {string} address
 * @returns {Array<Object>}
 */
export function getOrdersByAddress(address) {
  return db.prepare('SELECT * FROM orders WHERE address = ? ORDER BY created_at DESC').all();
}

/**
 * Updates current price, market cap, and checked timestamp for an order.
 * @param {number} id
 * @param {number} currentPriceUsd
 * @param {number} currentMcap
 */
export function updateOrderPrice(id, currentPriceUsd, currentMcap) {
  const now = Date.now();
  db.prepare(`
    UPDATE orders 
    SET current_price_usd = ?, current_mcap = ?, updated_at = ?
    WHERE id = ?
  `).run(currentPriceUsd, currentMcap, now, id);
}

/**
 * Creates a limit order.
 * @param {Object} limitOrder
 * @param {string} limitOrder.address
 * @param {number} limitOrder.limit_mcap
 * @param {number} limitOrder.buy_amount_usd
 * @returns {number}
 */
export function createLimitOrder({ address, limit_mcap, buy_amount_usd }) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO limit_orders (address, limit_mcap, buy_amount_usd, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(address, limit_mcap, buy_amount_usd, now);
  
  return info.lastInsertRowid;
}

/**
 * Fetches all pending limit orders.
 * @returns {Array<Object>}
 */
export function getPendingLimitOrders() {
  return db.prepare("SELECT * FROM limit_orders WHERE status = 'pending'").all();
}

/**
 * Updates the status of a limit order.
 * @param {number} id
 * @param {'pending'|'executed'|'cancelled'} status
 */
export function updateLimitOrderStatus(id, status) {
  db.prepare('UPDATE limit_orders SET status = ? WHERE id = ?').run(status, id);
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

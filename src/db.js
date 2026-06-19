import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'bot.db');
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
    token_qty REAL,
    tp_alerted INTEGER DEFAULT 0,
    status TEXT DEFAULT 'open'
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
try {
  db.exec('ALTER TABLE orders ADD COLUMN tp_alerted INTEGER DEFAULT 0');
} catch (_) {}
try {
  db.exec("ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'open'");
} catch (_) {}
try {
  db.exec("ALTER TABLE orders ADD COLUMN mode TEXT DEFAULT 'dryrun'");
} catch (_) {}
try {
  db.exec('ALTER TABLE orders ADD COLUMN tx_signature TEXT');
} catch (_) {}
try {
  db.exec('ALTER TABLE orders ADD COLUMN sell_tx_signature TEXT');
} catch (_) {}
try {
  db.exec('ALTER TABLE orders ADD COLUMN realized_sol REAL');
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
export function createOrder({ address, symbol, name, price_usd, mcap, type = 'dryrun', buy_amount_usd, token_qty, mode = 'dryrun', tx_signature = null }) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO orders (address, symbol, name, price_usd, mcap, type, created_at, buy_amount_usd, token_qty, mode, tx_signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(address, symbol, name, price_usd, mcap, type, now, buy_amount_usd, token_qty, mode, tx_signature);

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

export function getPendingLimitOrders() {
  return db.prepare("SELECT * FROM limit_orders WHERE status = 'pending'").all();
}

/**
 * Fetches a limit order by ID.
 * @param {number} id
 * @returns {Object|undefined}
 */
export function getLimitOrder(id) {
  return db.prepare('SELECT * FROM limit_orders WHERE id = ?').get(id);
}

/**
 * Updates the status of a limit order.
 * @param {number} id
 * @param {'pending'|'executed'|'cancelled'} status
 */
export function updateLimitOrderStatus(id, status) {
  db.prepare('UPDATE limit_orders SET status = ? WHERE id = ?').run(status, id);
}

export function getAllAlerts() {
  return db.prepare('SELECT * FROM token_alerts ORDER BY alerted_at DESC').all();
}

/**
 * Fetches unique token addresses that have been bought.
 * @returns {Array<string>}
 */
export function getBoughtAddresses() {
  const rows = db.prepare('SELECT DISTINCT address FROM orders').all();
  return rows.map(r => r.address);
}

/**
 * Fetches unique token addresses that have pending limit buy orders.
 * @returns {Array<string>}
 */
export function getPendingLimitAddresses() {
  const rows = db.prepare("SELECT DISTINCT address FROM limit_orders WHERE status = 'pending'").all();
  return rows.map(r => r.address);
}

/**
 * Clears old alerts from the database.
 * Optional clean up utility.
 */
export function clearOldAlerts() {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM token_alerts WHERE alerted_at < ?').run(oneWeekAgo);
}

/**
 * Updates the tp_alerted flag for an order to prevent duplicate notifications.
 * @param {number} id
 * @param {number} status
 */
export function markOrderTpAlerted(id, status = 1) {
  db.prepare('UPDATE orders SET tp_alerted = ? WHERE id = ?').run(status, id);
}

/**
 * Retrieves all active orders.
 * @returns {Array<Object>}
 */
export function getOpenOrders() {
  return db.prepare("SELECT * FROM orders WHERE status = 'open' ORDER BY created_at DESC").all();
}

/**
 * Retrieves active orders by address.
 * @param {string} address
 * @returns {Array<Object>}
 */
export function getOpenOrdersByAddress(address) {
  return db.prepare("SELECT * FROM orders WHERE address = ? AND status = 'open' ORDER BY created_at DESC").all(address);
}

/**
 * Fetches an order by its ID.
 * @param {number} id
 * @returns {Object|undefined}
 */
export function getOrderById(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

/**
 * Closes an order by marking its status as 'sold' and updating final price and timestamp.
 * @param {number} id
 * @param {number} sellPriceUsd
 * @param {number} sellMcap
 */
export function closeOrder(id, sellPriceUsd, sellMcap, sellTxSignature = null, realizedSol = null) {
  const now = Date.now();
  db.prepare(`
    UPDATE orders
    SET status = 'sold', current_price_usd = ?, current_mcap = ?, updated_at = ?, sell_tx_signature = ?, realized_sol = ?
    WHERE id = ?
  `).run(sellPriceUsd, sellMcap, now, sellTxSignature, realizedSol, id);
}

export default db;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const TMP_DB = '/tmp/dead-coin-test.db';

before(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
  process.env.DB_PATH = TMP_DB;
});

after(() => {
  if (fs.existsSync(TMP_DB)) fs.unlinkSync(TMP_DB);
});

test('createOrder stores mode and tx_signature; closeOrder stores sell fields', async () => {
  const { createOrder, getOrderById, closeOrder } = await import('./db.js');

  const id = createOrder({
    address: 'ADDR', symbol: 'X', name: 'X Token',
    price_usd: 0.001, mcap: 3000, type: 'dryrun',
    buy_amount_usd: 5, token_qty: 5000,
    mode: 'live', tx_signature: 'SIG_BUY',
  });

  let order = getOrderById(id);
  assert.equal(order.mode, 'live');
  assert.equal(order.tx_signature, 'SIG_BUY');
  assert.equal(order.status, 'open');

  closeOrder(id, 0.002, 6000, 'SIG_SELL', 0.15);
  order = getOrderById(id);
  assert.equal(order.status, 'sold');
  assert.equal(order.sell_tx_signature, 'SIG_SELL');
  assert.equal(order.realized_sol, 0.15);
});

test('createOrder defaults mode to dryrun and tx_signature to null', async () => {
  const { createOrder, getOrderById } = await import('./db.js');
  const id = createOrder({
    address: 'ADDR2', symbol: 'Y', name: 'Y',
    price_usd: 0.01, mcap: 2000, buy_amount_usd: 5, token_qty: 500,
  });
  const order = getOrderById(id);
  assert.equal(order.mode, 'dryrun');
  assert.equal(order.tx_signature, null);
});

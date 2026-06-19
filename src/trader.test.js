import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTrader } from './trader.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

function baseIo(overrides = {}) {
  return {
    isLive: false,
    config: { maxBuyUsd: 10, minSolReserve: 0.05, maxSlippageBps: 300 },
    searchAsset: async () => ({ symbol: 'X', name: 'X Token', usdPrice: 0.001, mcap: 3000, decimals: 6 }),
    swap: async () => ({ ok: true, signature: 'SIG', inAmount: 100_000_000, outAmount: 5_000_000_000 }),
    getSolPriceUsd: async () => 50,
    getSolBalance: async () => 1 * LAMPORTS_PER_SOL,
    lamportsForUsd: (usd, price) => Math.floor((usd / price) * LAMPORTS_PER_SOL),
    solMint: 'SOL',
    createOrder: () => 1,
    closeOrder: () => {},
    ...overrides,
  };
}

test('dryrun buy records theoretical qty and does not swap', async () => {
  let swapCalled = false;
  let recorded = null;
  const io = baseIo({
    isLive: false,
    swap: async () => { swapCalled = true; return { ok: true }; },
    createOrder: (o) => { recorded = o; return 7; },
  });
  const { executeBuy } = makeTrader(io);

  const res = await executeBuy({ address: 'ADDR', buyAmountUsd: 5 });

  assert.equal(res.ok, true);
  assert.equal(swapCalled, false);
  assert.equal(recorded.mode, 'dryrun');
  // qty = 5 / 0.001 = 5000
  assert.equal(recorded.token_qty, 5000);
});

test('live buy over MAX_BUY_USD is rejected, nothing recorded', async () => {
  let recorded = false;
  const io = baseIo({ isLive: true, createOrder: () => { recorded = true; return 1; } });
  const { executeBuy } = makeTrader(io);

  const res = await executeBuy({ address: 'ADDR', buyAmountUsd: 999 });

  assert.equal(res.ok, false);
  assert.match(res.reason, /MAX_BUY_USD|exceeds/i);
  assert.equal(recorded, false);
});

test('live buy with insufficient SOL is rejected, nothing recorded', async () => {
  let recorded = false;
  const io = baseIo({
    isLive: true,
    getSolBalance: async () => 0.01 * LAMPORTS_PER_SOL, // below reserve
    createOrder: () => { recorded = true; return 1; },
  });
  const { executeBuy } = makeTrader(io);

  const res = await executeBuy({ address: 'ADDR', buyAmountUsd: 5 });

  assert.equal(res.ok, false);
  assert.match(res.reason, /balance|SOL|reserve/i);
  assert.equal(recorded, false);
});

test('live buy success records actual qty from swap outAmount and signature', async () => {
  let recorded = null;
  const io = baseIo({
    isLive: true,
    // outAmount 5_000_000_000 raw, decimals 6 → 5000 tokens
    swap: async () => ({ ok: true, signature: 'SIGBUY', inAmount: 100_000_000, outAmount: 5_000_000_000 }),
    createOrder: (o) => { recorded = o; return 9; },
  });
  const { executeBuy } = makeTrader(io);

  const res = await executeBuy({ address: 'ADDR', buyAmountUsd: 5 });

  assert.equal(res.ok, true);
  assert.equal(recorded.mode, 'live');
  assert.equal(recorded.tx_signature, 'SIGBUY');
  assert.equal(recorded.token_qty, 5000);
  // entry price = 5 / 5000 = 0.001
  assert.ok(Math.abs(recorded.price_usd - 0.001) < 1e-9);
});

test('live buy records nothing when swap fails', async () => {
  let recorded = false;
  const io = baseIo({
    isLive: true,
    swap: async () => ({ ok: false, reason: 'slippage' }),
    createOrder: () => { recorded = true; return 1; },
  });
  const { executeBuy } = makeTrader(io);

  const res = await executeBuy({ address: 'ADDR', buyAmountUsd: 5 });

  assert.equal(res.ok, false);
  assert.equal(recorded, false);
});

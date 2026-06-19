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
    getTokenBalance: async () => 10_000_000_000,
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

test('dryrun sell closes all orders without swapping', async () => {
  let swapCalled = false;
  const closed = [];
  const io = baseIo({
    isLive: false,
    swap: async () => { swapCalled = true; return { ok: true }; },
    closeOrder: (id, p, m, s, r) => closed.push({ id, p, s, r }),
  });
  const { executeSell } = makeTrader(io);

  const orders = [
    { id: 1, address: 'ADDR', token_qty: 5000, price_usd: 0.001, buy_amount_usd: 5 },
    { id: 2, address: 'ADDR', token_qty: 5000, price_usd: 0.001, buy_amount_usd: 5 },
  ];
  const res = await executeSell({ orders, currentPriceUsd: 0.002, currentMcap: 6000 });

  assert.equal(res.ok, true);
  assert.equal(swapCalled, false);
  assert.equal(closed.length, 2);
  assert.equal(closed[0].s, null); // no sell signature in dryrun
});

test('live sell uses one combined swap and splits proceeds proportionally', async () => {
  let swapCount = 0;
  let swapInput = null;
  const closed = [];
  const io = baseIo({
    isLive: true,
    searchAsset: async () => ({ symbol: 'X', name: 'X', usdPrice: 0.002, mcap: 6000, decimals: 6 }),
    getSolPriceUsd: async () => 50,
    swap: async (p) => { swapCount++; swapInput = p; return { ok: true, signature: 'SIGSELL', inAmount: 10_000_000_000, outAmount: 400_000_000 }; },
    closeOrder: (id, price, mcap, sig, sol) => closed.push({ id, price, sig, sol }),
  });
  const { executeSell } = makeTrader(io);

  // two orders: qty 3000 and 1000 → total 4000; raw input = 4000 * 10^6
  const orders = [
    { id: 1, address: 'ADDR', token_qty: 3000, price_usd: 0.001, buy_amount_usd: 3 },
    { id: 2, address: 'ADDR', token_qty: 1000, price_usd: 0.001, buy_amount_usd: 1 },
  ];
  const res = await executeSell({ orders, currentPriceUsd: 0.002, currentMcap: 6000 });

  assert.equal(res.ok, true);
  assert.equal(swapCount, 1); // single combined swap
  assert.equal(swapInput.amountLamports, 4000 * 1_000_000);
  assert.equal(closed.length, 2);
  // outAmount 400_000_000 lamports = 0.4 SOL; split 75% / 25%
  assert.ok(Math.abs(closed[0].sol - 0.3) < 1e-9);
  assert.ok(Math.abs(closed[1].sol - 0.1) < 1e-9);
  assert.equal(closed[0].sig, 'SIGSELL');
});

test('live sell failure keeps orders open (no close calls)', async () => {
  const closed = [];
  const io = baseIo({
    isLive: true,
    searchAsset: async () => ({ symbol: 'X', name: 'X', usdPrice: 0.002, mcap: 6000, decimals: 6 }),
    swap: async () => ({ ok: false, reason: 'tx not landed' }),
    closeOrder: (id) => closed.push(id),
  });
  const { executeSell } = makeTrader(io);

  const orders = [{ id: 1, address: 'ADDR', token_qty: 5000, price_usd: 0.001, buy_amount_usd: 5 }];
  const res = await executeSell({ orders, currentPriceUsd: 0.002, currentMcap: 6000 });

  assert.equal(res.ok, false);
  assert.equal(closed.length, 0);
});

test('live sell swaps actual token balance when it is less than db qty (slippage/fee mitigation)', async () => {
  let swapInput = null;
  const io = baseIo({
    isLive: true,
    searchAsset: async () => ({ symbol: 'X', name: 'X', usdPrice: 0.002, mcap: 6000, decimals: 6 }),
    getTokenBalance: async () => 4_500_000, // 4.5 tokens, less than DB 5.0 tokens
    swap: async (p) => { swapInput = p; return { ok: true, signature: 'SIG', inAmount: 4_500_000, outAmount: 100_000 }; },
  });
  const { executeSell } = makeTrader(io);

  const orders = [{ id: 1, address: 'ADDR', token_qty: 5, price_usd: 0.001, buy_amount_usd: 5 }];
  const res = await executeSell({ orders, currentPriceUsd: 0.002, currentMcap: 6000 });

  assert.equal(res.ok, true);
  assert.equal(swapInput.amountLamports, 4_500_000); // limited to on-chain balance
});

test('live sell fails when on-chain token balance is 0', async () => {
  const io = baseIo({
    isLive: true,
    searchAsset: async () => ({ symbol: 'X', name: 'X', usdPrice: 0.002, mcap: 6000, decimals: 6 }),
    getTokenBalance: async () => 0,
  });
  const { executeSell } = makeTrader(io);

  const orders = [{ id: 1, address: 'ADDR', token_qty: 5, price_usd: 0.001, buy_amount_usd: 5 }];
  const res = await executeSell({ orders, currentPriceUsd: 0.002, currentMcap: 6000 });

  assert.equal(res.ok, false);
  assert.match(res.reason, /No token balance found on-chain/i);
});

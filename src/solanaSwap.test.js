import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lamportsForUsd, exceedsSlippage, SOL_MINT } from './solanaSwap.js';

test('SOL_MINT is wrapped SOL', () => {
  assert.equal(SOL_MINT, 'So11111111111111111111111111111111111111112');
});

test('lamportsForUsd converts USD to SOL lamports', () => {
  // $10 at $50/SOL = 0.2 SOL = 200_000_000 lamports
  assert.equal(lamportsForUsd(10, 50), 200_000_000);
});

test('lamportsForUsd floors to integer lamports', () => {
  const out = lamportsForUsd(1, 3);
  assert.ok(Number.isInteger(out));
});

test('exceedsSlippage compares price impact fraction to bps cap', () => {
  // 1.2% impact vs 3% (300 bps) cap → does not exceed
  assert.equal(exceedsSlippage(0.012, 300), false);
  // 4% impact vs 3% cap → exceeds
  assert.equal(exceedsSlippage(0.04, 300), true);
});

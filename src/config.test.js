import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLiveMode, validateLiveConfig } from './config.js';

test('isLiveMode returns false by default (dryrun)', () => {
  // TRADING_MODE unset in test env → default dryrun
  assert.equal(isLiveMode(), false);
});

test('validateLiveConfig passes in dryrun regardless of missing keys', () => {
  const res = validateLiveConfig();
  assert.equal(res.ok, true);
});

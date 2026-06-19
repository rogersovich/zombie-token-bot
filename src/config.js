import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environmental variables from .env
dotenv.config();

const configPath = path.resolve(process.cwd(), 'config.json');
const configExamplePath = path.resolve(process.cwd(), 'config.example.json');

let appConfig = {};

try {
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    appConfig = JSON.parse(raw);
  } else if (fs.existsSync(configExamplePath)) {
    const raw = fs.readFileSync(configExamplePath, 'utf-8');
    appConfig = JSON.parse(raw);
  }
} catch (error) {
  console.error('Failed to load config.json or config.example.json, using hardcoded defaults:', error.message);
  appConfig = {
    min_ath_mcap: 20000,
    min_mcap: 2000,
    max_mcap: 5000,
    min_volume_24h: 1000,
    min_holder_count: 100,
    min_token_age_days: 7
  };
}

const cronScreenMinutes = Number(appConfig.cron_screen_minutes ?? 240);

// Helper to convert minutes to a valid cron pattern
let generatedCron = '0 */4 * * *';
if (cronScreenMinutes < 60) {
  generatedCron = `*/${cronScreenMinutes} * * * *`;
} else {
  const hours = Math.floor(cronScreenMinutes / 60);
  generatedCron = `0 */${hours} * * *`;
}

export const SECRETS = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  CRON_SCHEDULE: generatedCron,
  TRADING_MODE: (process.env.TRADING_MODE || 'dryrun').toLowerCase(),
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY,
};

export const CONFIG = {
  minAthMcap: Number(appConfig.min_ath_mcap ?? 20000),
  minMcap: Number(appConfig.min_mcap ?? 2000),
  maxMcap: Number(appConfig.max_mcap ?? 5000),
  minVolume24h: Number(appConfig.min_volume_24h ?? 1000),
  minHolderCount: Number(appConfig.min_holder_count ?? 100),
  minTokenAgeDays: Number(appConfig.min_token_age_days ?? 7),
  cronScreenMinutes: cronScreenMinutes,
  minLargestBuyUsd: Number(appConfig.min_largest_buy_usd ?? 5),
  cronOrderMonitorHours: Number(appConfig.cron_order_monitor_hours ?? 1),
  defaultBuyAmountUsd: Number(appConfig.default_buy_amount_usd ?? 5),
  minTakeProfitPercent: Number(appConfig.min_take_profit_percent ?? 50),
  maxBuyUsd: Number(appConfig.max_buy_usd ?? 10),
  minSolReserve: Number(appConfig.min_sol_reserve ?? 0.05),
  maxSlippageBps: Number(appConfig.max_slippage_bps ?? 300),
  priorityFeeLamports: Number(appConfig.priority_fee_lamports ?? 100000),
};

/**
 * @returns {boolean} true when running in live trading mode.
 */
export function isLiveMode() {
  return SECRETS.TRADING_MODE === 'live';
}

/**
 * Validates that live-mode secrets are present.
 * In dryrun mode it always passes.
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function validateLiveConfig() {
  if (!isLiveMode()) {
    return { ok: true, reason: null };
  }
  if (!SECRETS.SOLANA_RPC_URL) {
    return { ok: false, reason: 'TRADING_MODE=live but SOLANA_RPC_URL is missing' };
  }
  if (!SECRETS.WALLET_PRIVATE_KEY) {
    return { ok: false, reason: 'TRADING_MODE=live but WALLET_PRIVATE_KEY is missing' };
  }
  return { ok: true, reason: null };
}

export default {
  SECRETS,
  CONFIG
};

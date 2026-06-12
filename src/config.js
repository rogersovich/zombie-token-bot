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

export const SECRETS = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  CRON_SCHEDULE: process.env.CRON_SCHEDULE || '0 */4 * * *',
};

export const CONFIG = {
  minAthMcap: Number(appConfig.min_ath_mcap ?? 20000),
  minMcap: Number(appConfig.min_mcap ?? 2000),
  maxMcap: Number(appConfig.max_mcap ?? 5000),
  minVolume24h: Number(appConfig.min_volume_24h ?? 1000),
  minHolderCount: Number(appConfig.min_holder_count ?? 100),
  minTokenAgeDays: Number(appConfig.min_token_age_days ?? 7),
};

export default {
  SECRETS,
  CONFIG
};

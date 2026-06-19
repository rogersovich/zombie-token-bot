/**
 * One-shot CLI: generate a new Solana keypair and save it to a
 * wallet_<randomcode>.json file. Run: npm run gen-wallet
 *
 * The output file is gitignored (wallet_*.json). It holds a plaintext private
 * key — treat it like cash. The random suffix means each run creates a fresh
 * file, so an existing funded wallet file is never clobbered.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const randomCode = crypto.randomBytes(4).toString('hex');
const fileName = `wallet_${randomCode}.json`;
const OUT_FILE = path.resolve(process.cwd(), fileName);

const kp = Keypair.generate();
const address = kp.publicKey.toBase58();
const privateKey = bs58.encode(kp.secretKey);

const data = {
  address,
  privateKey,
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2));

console.log('================================================================');
console.log(`✅ New Solana wallet generated and saved to ${fileName}`);
console.log('================================================================');
console.log(`Address (fund this):  ${address}`);
console.log('Private key:          (saved in wallet_1.json — never share/commit)');
console.log('================================================================');
console.log('Next:');
console.log('1. Send a small amount of SOL to the address above.');
console.log('2. Put the private key into .env as WALLET_PRIVATE_KEY=');
console.log('3. Set TRADING_MODE=live only after a dryrun smoke test.');
console.log('================================================================');

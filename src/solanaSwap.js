/**
 * Solana on-chain swap module (Jupiter aggregator).
 * Pure: does NOT import db or telegram.
 */
import { Connection, Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { SECRETS, CONFIG } from './config.js';
import jupApi from './jupApi.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUP_SWAP_BASE = 'https://lite-api.jup.ag/swap/v1';
const LAMPORTS_PER_SOL = 1_000_000_000;

let connection = null;
let wallet = null;

function init() {
  if (!connection) connection = new Connection(SECRETS.SOLANA_RPC_URL, 'confirmed');
  if (!wallet) wallet = Keypair.fromSecretKey(bs58.decode(SECRETS.WALLET_PRIVATE_KEY));
  return { connection, wallet };
}

/**
 * Converts a USD amount into integer SOL lamports.
 * @param {number} usd
 * @param {number} solPriceUsd
 * @returns {number}
 */
export function lamportsForUsd(usd, solPriceUsd) {
  if (!solPriceUsd || solPriceUsd <= 0) return 0;
  return Math.floor((usd / solPriceUsd) * LAMPORTS_PER_SOL);
}

/**
 * @param {number} priceImpactPct Fraction, e.g. 0.012 for 1.2%.
 * @param {number} slippageBps Cap in basis points (300 = 3%).
 * @returns {boolean} true if impact exceeds the cap.
 */
export function exceedsSlippage(priceImpactPct, slippageBps) {
  return priceImpactPct * 10000 > slippageBps;
}

/**
 * @returns {Promise<number>} SOL price in USD (0 if unavailable).
 */
export async function getSolPriceUsd() {
  const details = await jupApi.searchAsset(SOL_MINT);
  return details?.usdPrice || 0;
}

/**
 * @returns {Promise<number>} wallet SOL balance in lamports.
 */
export async function getSolBalance() {
  const { connection, wallet } = init();
  return await connection.getBalance(wallet.publicKey);
}

/**
 * Executes a swap via Jupiter. Returns a result object; never throws.
 * @param {{ inputMint: string, outputMint: string, amountLamports: number, slippageBps: number }} params
 * @returns {Promise<{ ok: boolean, signature?: string, inAmount?: number, outAmount?: number, reason?: string }>}
 */
export async function swap({ inputMint, outputMint, amountLamports, slippageBps }) {
  try {
    const { connection, wallet } = init();

    // 1. Quote
    const quoteUrl = `${JUP_SWAP_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`;
    const quoteRes = await fetch(quoteUrl, { headers: { Accept: 'application/json' } });
    if (!quoteRes.ok) return { ok: false, reason: `Quote HTTP ${quoteRes.status}` };
    const quote = await quoteRes.json();

    // 2. Slippage / price impact guard
    const impactPct = parseFloat(quote.priceImpactPct || '0');
    if (exceedsSlippage(impactPct, slippageBps)) {
      return { ok: false, reason: `Price impact ${(impactPct * 100).toFixed(2)}% exceeds cap ${(slippageBps / 100).toFixed(2)}%` };
    }

    // 3. Build swap transaction
    const swapRes = await fetch(`${JUP_SWAP_BASE}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: CONFIG.priorityFeeLamports,
        dynamicComputeUnitLimit: true,
      }),
    });
    if (!swapRes.ok) return { ok: false, reason: `Swap build HTTP ${swapRes.status}` };
    const { swapTransaction } = await swapRes.json();

    // 4. Sign
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([wallet]);

    // 5. Send
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });

    // 6. Confirm
    const conf = await connection.confirmTransaction(signature, 'confirmed');
    if (conf.value && conf.value.err) {
      return { ok: false, signature, reason: `Tx failed on-chain: ${JSON.stringify(conf.value.err)}` };
    }

    return { ok: true, signature, inAmount: Number(quote.inAmount), outAmount: Number(quote.outAmount) };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Gets the balance of a specific token mint in the wallet.
 * @param {string} tokenMintAddress
 * @returns {Promise<number>} token balance in raw lamports (integer)
 */
export async function getTokenBalance(tokenMintAddress) {
  const { connection, wallet } = init();
  try {
    const res = await connection.getTokenAccountsByOwner(wallet.publicKey, {
      mint: new PublicKey(tokenMintAddress),
    });
    if (res.value.length === 0) return 0;
    const balRes = await connection.getTokenAccountBalance(res.value[0].pubkey);
    return Number(balRes.value.amount || 0);
  } catch (err) {
    console.error(`[solanaSwap] Failed to get token balance for ${tokenMintAddress}:`, err.message);
    return 0;
  }
}

export default { lamportsForUsd, exceedsSlippage, getSolPriceUsd, getSolBalance, swap, getTokenBalance, SOL_MINT };

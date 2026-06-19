/**
 * Trader bridge. Branches between dryrun (DB only) and live (Jupiter swap + DB).
 * Use makeTrader(io) with injected externals for testing; the default `trader`
 * export is wired to the real modules.
 */
import { CONFIG, isLiveMode } from './config.js';
import * as solanaSwap from './solanaSwap.js';
import { createOrder, closeOrder } from './db.js';
import jupApi from './jupApi.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

export function makeTrader(io) {
  /**
   * @param {{ address: string, buyAmountUsd: number }} params
   * @returns {Promise<{ ok: boolean, order?: object, reason?: string }>}
   */
  async function executeBuy({ address, buyAmountUsd }) {
    const details = await io.searchAsset(address);
    if (!details) {
      return { ok: false, reason: 'Token not found on Jupiter' };
    }

    if (!io.isLive) {
      const priceUsd = details.usdPrice || 0;
      const tokenQty = priceUsd > 0 ? buyAmountUsd / priceUsd : 0;
      const id = io.createOrder({
        address,
        symbol: details.symbol || 'N/A',
        name: details.name || 'N/A',
        price_usd: priceUsd,
        mcap: details.mcap || 0,
        type: 'dryrun',
        buy_amount_usd: buyAmountUsd,
        token_qty: tokenQty,
        mode: 'dryrun',
        tx_signature: null,
      });
      return { ok: true, order: { id, token_qty: tokenQty, price_usd: priceUsd } };
    }

    // LIVE
    if (buyAmountUsd > io.config.maxBuyUsd) {
      return { ok: false, reason: `Buy $${buyAmountUsd} exceeds MAX_BUY_USD $${io.config.maxBuyUsd}` };
    }

    const solPrice = await io.getSolPriceUsd();
    if (!solPrice) {
      return { ok: false, reason: 'Could not fetch SOL price' };
    }
    const amountLamports = io.lamportsForUsd(buyAmountUsd, solPrice);

    const balance = await io.getSolBalance();
    const reserveLamports = io.config.minSolReserve * LAMPORTS_PER_SOL;
    if (balance - amountLamports < reserveLamports) {
      return { ok: false, reason: `Insufficient SOL: balance ${(balance / LAMPORTS_PER_SOL).toFixed(4)} below reserve after buy` };
    }

    const result = await io.swap({
      inputMint: io.solMint,
      outputMint: address,
      amountLamports,
      slippageBps: io.config.maxSlippageBps,
    });
    if (!result.ok) {
      return { ok: false, reason: result.reason || 'Swap failed' };
    }

    const decimals = details.decimals ?? 0;
    const actualQty = result.outAmount / Math.pow(10, decimals);
    const entryPrice = actualQty > 0 ? buyAmountUsd / actualQty : 0;

    const id = io.createOrder({
      address,
      symbol: details.symbol || 'N/A',
      name: details.name || 'N/A',
      price_usd: entryPrice,
      mcap: details.mcap || 0,
      type: 'live',
      buy_amount_usd: buyAmountUsd,
      token_qty: actualQty,
      mode: 'live',
      tx_signature: result.signature,
    });
    return { ok: true, order: { id, token_qty: actualQty, price_usd: entryPrice, signature: result.signature } };
  }

  /**
   * @param {{ orders: Array<object>, currentPriceUsd: number, currentMcap: number }} params
   * @returns {Promise<{ ok: boolean, results?: Array<{ id: number, sellPrice: number, realizedUsd: number }>, reason?: string }>}
   */
  async function executeSell({ orders, currentPriceUsd, currentMcap }) {
    if (!orders || orders.length === 0) {
      return { ok: false, reason: 'No orders to sell' };
    }
    const address = orders[0].address;

    if (!io.isLive) {
      const results = orders.map((o) => {
        io.closeOrder(o.id, currentPriceUsd, currentMcap, null, null);
        const realizedUsd = o.token_qty * currentPriceUsd;
        return { id: o.id, sellPrice: currentPriceUsd, realizedUsd };
      });
      return { ok: true, results };
    }

    // LIVE — single combined swap token -> SOL
    const details = await io.searchAsset(address);
    if (!details) {
      return { ok: false, reason: 'Could not fetch token details for sell' };
    }
    const decimals = details.decimals ?? 0;
    const totalQty = orders.reduce((sum, o) => sum + (o.token_qty || 0), 0);
    const amountLamports = Math.floor(totalQty * Math.pow(10, decimals));

    const result = await io.swap({
      inputMint: address,
      outputMint: io.solMint,
      amountLamports,
      slippageBps: io.config.maxSlippageBps,
    });
    if (!result.ok) {
      return { ok: false, reason: result.reason || 'Swap failed' };
    }

    const solPrice = await io.getSolPriceUsd();
    const totalSolOut = result.outAmount / LAMPORTS_PER_SOL;
    const totalUsdOut = totalSolOut * solPrice;
    const sellMcap = details.mcap || currentMcap || 0;

    const results = orders.map((o) => {
      const share = totalQty > 0 ? (o.token_qty / totalQty) : 0;
      const orderSol = totalSolOut * share;
      const realizedUsd = totalUsdOut * share;
      const sellPrice = o.token_qty > 0 ? realizedUsd / o.token_qty : 0;
      io.closeOrder(o.id, sellPrice, sellMcap, result.signature, orderSol);
      return { id: o.id, sellPrice, realizedUsd };
    });

    return { ok: true, results, signature: result.signature };
  }

  return { executeBuy, executeSell };
}

const realIo = {
  isLive: isLiveMode(),
  config: {
    maxBuyUsd: CONFIG.maxBuyUsd,
    minSolReserve: CONFIG.minSolReserve,
    maxSlippageBps: CONFIG.maxSlippageBps,
  },
  searchAsset: (address) => jupApi.searchAsset(address),
  swap: (params) => solanaSwap.swap(params),
  getSolPriceUsd: () => solanaSwap.getSolPriceUsd(),
  getSolBalance: () => solanaSwap.getSolBalance(),
  lamportsForUsd: (usd, price) => solanaSwap.lamportsForUsd(usd, price),
  solMint: solanaSwap.SOL_MINT,
  createOrder: (o) => createOrder(o),
  closeOrder: (id, p, m, s, r) => closeOrder(id, p, m, s, r),
};

export const trader = makeTrader(realIo);
export default trader;

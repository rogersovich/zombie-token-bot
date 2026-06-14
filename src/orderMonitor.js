import jupApi from './jupApi.js';
import { getAllOrders, updateOrderPrice } from './db.js';
import { formatToWIB } from './helpers/time.js';

/**
 * Periodically updates the current prices and market caps of all orders in the database.
 * Executes once every hour (or as configured).
 */
export async function monitorOrders() {
  console.log('[Order Monitor] Starting order price update check...');
  
  const orders = getAllOrders();
  if (orders.length === 0) {
    console.log('[Order Monitor] No orders to update.');
    return;
  }

  console.log(`[Order Monitor] Found ${orders.length} order(s) to check.`);

  for (const order of orders) {
    try {
      console.log(`[Order Monitor] Fetching latest price for ${order.symbol} (${order.address})...`);
      const details = await jupApi.searchAsset(order.address);
      if (details) {
        const currentPrice = details.usdPrice || 0;
        const currentMcap = details.mcap || 0;

        updateOrderPrice(order.id, currentPrice, currentMcap);
        console.log(`[Order Monitor] Updated ${order.symbol} (#${order.id}): Price = $${currentPrice.toFixed(8)}, Mcap = $${currentMcap.toFixed(2)}`);
      } else {
        console.warn(`[Order Monitor] Could not fetch details for ${order.symbol} (${order.address}).`);
      }
      
      // Delay slightly between requests to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[Order Monitor] Error updating price for order #${order.id} (${order.symbol}):`, error.message);
    }
  }

  console.log('[Order Monitor] Order price update check completed.');
}

export default {
  monitorOrders
};

import { screenSingleToken } from './monitor.js';
import { buildSingleCheckMessage } from './helpers/message.js';
import { CONFIG } from './config.js';

async function main() {
  const address = 'AKQsb5XKL7RohnLGWjRui5ArUYVSZWJ5VwDSa2EEpump';
  console.log(`Testing screenSingleToken for: ${address}`);
  try {
    const result = await screenSingleToken(address);
    if (!result) {
      console.log('Token details not found or error occurred.');
      return;
    }
    console.log('Result object:', JSON.stringify(result, null, 2));
    
    const message = buildSingleCheckMessage(result, CONFIG);
    console.log('\n--- Telegram Message Output ---');
    console.log(message);
    console.log('-------------------------------');
  } catch (error) {
    console.error('Error testing single token:', error);
  }
}

main();

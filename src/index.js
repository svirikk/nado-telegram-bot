import { TradingBot } from './bot.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    logger.info('═══════════════════════════════════════');
    logger.info('  NADO TELEGRAM TRADING BOT v1.0.0');
    logger.info('═══════════════════════════════════════');
    
    const bot = new TradingBot();
    global.bot = bot; // For graceful shutdown
    
    await bot.start();
    
    // Keep process alive
    process.stdin.resume();
    
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();

import { NadoClient } from './nado/client.js';
import { TradeManager } from './trading/tradeManager.js';
import { TelegramListener } from './telegram/listener.js';
import { TelegramNotifier } from './telegram/notifier.js';
import { TradingHours } from './utils/tradingHours.js';
import { logger } from './utils/logger.js';
import { config } from './config.js';

export class TradingBot {
  constructor() {
    this.nado = null;
    this.tradeManager = null;
    this.telegramListener = null;
    this.notifier = null;
    this.isRunning = false;
  }
  
  async start() {
    try {
      logger.info('Starting Nado Trading Bot...');
      
      // Initialize Nado client
      this.nado = new NadoClient();
      logger.info('Nado client initialized');
      
      // Connect WebSocket
      await this.nado.connectWebSocket();
      
      // Initialize notifier
      this.notifier = new TelegramNotifier();
      logger.info('Telegram notifier initialized');
      
      // Verify account setup
      await this.verifyAccountSetup();
      
      // Initialize trade manager
      this.tradeManager = new TradeManager(this.nado, this.notifier);
      logger.info('Trade manager initialized');
      
      // Subscribe to order fill events
      this.nado.subscribe('order_fill', (data) => {
        this.tradeManager.handleOrderFill(data);
      });
      
      // Initialize Telegram listener
      this.telegramListener = new TelegramListener(this.tradeManager);
      
      // Send startup notification
      const balance = await this.nado.getSubaccountBalance();
      const availableUSDT = balance.USDT0 || 0;
      const tradingHoursStatus = TradingHours.getStatusMessage();
      
      await this.notifier.sendStartup(
        this.nado.signer.getAddress(),
        availableUSDT,
        tradingHoursStatus
      );
      
      // Schedule daily summary (at 23:55 UTC)
      this.scheduleDailySummary();
      
      this.isRunning = true;
      logger.info('✅ Bot is now running');
      
    } catch (error) {
      logger.error('Bot startup failed:', error);
      throw error;
    }
  }
  
  async verifyAccountSetup() {
    try {
      // Check balance
      const balance = await this.nado.getSubaccountBalance();
      const availableUSDT = balance.USDT0 || 0;
      
      if (availableUSDT < 5) {
        throw new Error(
          `Insufficient balance: $${availableUSDT.toFixed(2)} USDT0. ` +
          `Minimum $5 USDT0 required for trading on Nado.`
        );
      }
      
      logger.info(`✅ Balance verified: $${availableUSDT.toFixed(2)} USDT0`);
      
      // Check if products are accessible
      const products = await this.nado.getProducts();
      if (!products || products.length === 0) {
        throw new Error('No products available. Check Nado API connectivity.');
      }
      
      logger.info(`✅ Products accessible: ${products.length} markets`);
      
    } catch (error) {
      logger.error('Account verification failed:', error);
      throw error;
    }
  }
  
  scheduleDailySummary() {
    // Check every hour if it's time to send summary
    setInterval(async () => {
      const now = new Date();
      if (now.getUTCHours() === 23 && now.getUTCMinutes() >= 55) {
        await this.sendDailySummary();
      }
    }, 60 * 60 * 1000); // Check every hour
  }
  
  async sendDailySummary() {
    try {
      const stats = this.tradeManager.getDailyStats();
      
      // Calculate total PnL (simplified - would need to track all closed positions)
      // For now, just send the stats
      await this.notifier.sendDailySummary(stats, 0);
      
    } catch (error) {
      logger.error('Failed to send daily summary:', error);
    }
  }
  
  async stop() {
    logger.info('Stopping bot...');
    
    if (this.telegramListener) {
      this.telegramListener.stop();
    }
    
    if (this.nado && this.nado.ws) {
      this.nado.ws.close();
    }
    
    this.isRunning = false;
    logger.info('Bot stopped');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal');
  if (global.bot) {
    await global.bot.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal');
  if (global.bot) {
    await global.bot.stop();
  }
  process.exit(0);
});

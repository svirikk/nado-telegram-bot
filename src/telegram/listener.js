import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { TradingHours } from '../utils/tradingHours.js';

export class TelegramListener {
  constructor(tradeManager) {
    this.bot = new TelegramBot(config.telegram.botToken, { 
      polling: {
        interval: 1000,
        autoStart: true,
      }
    });
    this.tradeManager = tradeManager;
    this.channelId = config.telegram.channelId;
    
    this.setupListeners();
  }
  
  setupListeners() {
    // Handle all messages including channel posts
    this.bot.on('message', (msg) => this.handleMessage(msg));
    this.bot.on('channel_post', (msg) => this.handleMessage(msg));
    
    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error:', error);
    });
    
    logger.info('Telegram listener started');
  }
  
  async handleMessage(msg) {
    try {
      // Only process messages from the configured channel
      if (msg.chat.id.toString() !== this.channelId.toString()) {
        return;
      }
      
      const text = msg.text || '';
      
      // Check if message contains signal pattern
      if (!text.includes('SIGNAL DETECTED')) {
        return;
      }
      
      logger.debug('Signal message received');
      
      // Parse the signal
      const signal = this.parseSignal(text);
      
      if (!signal) {
        logger.error('Failed to parse signal');
        return;
      }
      
      // Validate signal
      if (!this.validateSignal(signal)) {
        logger.info(`Signal ignored: ${signal.symbol} (validation failed)`);
        return;
      }
      
      // Check trading hours
      if (!TradingHours.isWithinTradingHours()) {
        logger.info('Signal ignored: outside trading hours');
        return;
      }
      
      // Execute trade
      await this.tradeManager.executeTrade(signal);
      
    } catch (error) {
      logger.error('Message handling error:', error);
    }
  }
  
  parseSignal(text) {
    try {
      // Extract JSON from message
      const jsonMatch = text.match(/```json?\s*([\s\S]*?)\s*```/);
      
      if (!jsonMatch) {
        // Try to parse without code block
        const lines = text.split('\n');
        let symbol = null;
        let signalType = null;
        
        for (const line of lines) {
          if (line.includes('Symbol:')) {
            symbol = line.split(':')[1]?.trim();
          }
          if (line.includes('Type:')) {
            signalType = line.split(':')[1]?.trim();
          }
        }
        
        if (!symbol || !signalType) {
          return null;
        }
        
        return {
          symbol,
          signalType,
          stats: {},
        };
      }
      
      const jsonData = JSON.parse(jsonMatch[1]);
      return jsonData;
      
    } catch (error) {
      logger.error('Signal parsing error:', error);
      return null;
    }
  }
  
  validateSignal(signal) {
    // Check if symbol is in whitelist
    if (!config.allowedSymbols.includes(signal.symbol)) {
      logger.debug(`Symbol ${signal.symbol} not in whitelist`);
      return false;
    }
    
    // Check if signal type is valid
    const validTypes = ['SHORT_SQUEEZE', 'LONG_FLUSH'];
    if (!validTypes.includes(signal.signalType)) {
      logger.debug(`Invalid signal type: ${signal.signalType}`);
      return false;
    }
    
    return true;
  }
  
  stop() {
    this.bot.stopPolling();
    logger.info('Telegram listener stopped');
  }
}

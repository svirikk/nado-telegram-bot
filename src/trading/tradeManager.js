import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export class TradeManager {
  constructor(nadoClient, notifier) {
    this.nado = nadoClient;
    this.notifier = notifier;
    this.openPositions = new Map(); // digest -> position data
    this.dailyTrades = 0;
    this.lastResetDate = new Date().toDateString();
  }
  
  resetDailyCounterIfNeeded() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.dailyTrades = 0;
      this.lastResetDate = today;
      logger.info('Daily trade counter reset');
    }
  }
  
  canOpenNewPosition() {
    this.resetDailyCounterIfNeeded();
    
    if (this.dailyTrades >= config.risk.maxDailyTrades) {
      return false;
    }
    
    if (this.openPositions.size >= config.risk.maxOpenPositions) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Execute trade based on signal
   * @param {Object} signal - Parsed signal data
   */
  async executeTrade(signal) {
    try {
      if (!this.canOpenNewPosition()) {
        return;
      }
      
      const { symbol, signalType } = signal;
      
      // Determine side based on signal type (mean reversion)
      const side = signalType === 'SHORT_SQUEEZE' ? 'SHORT' : 'LONG';
      
      logger.trade(`Executing ${side} on ${symbol}`);
      
      // Get product info
      const product = await this.nado.getProductBySymbol(symbol);
      if (!product) {
        logger.error(`Product not found: ${symbol}`);
        return;
      }
      
      // Get current balance
      const balance = await this.nado.getSubaccountBalance();
      const availableUSDT = balance.USDT0 || 0;
      
      if (availableUSDT < 5) {
        logger.error('Insufficient balance (minimum $5 USDT0 required)');
        await this.notifier.sendMessage('⚠️ Insufficient balance for trading');
        return;
      }
      
      // Calculate position size
      const positionSize = this.calculatePositionSize(availableUSDT);
      
      // Get current market price from product
      const entryPrice = product.mark_price_x18 
        ? this.nado.fromX18(product.mark_price_x18) 
        : signal.stats?.lastPrice || 0;
      
      if (!entryPrice) {
        logger.error('Cannot determine entry price');
        return;
      }
      
      // Calculate TP and SL prices
      const tpPrice = side === 'LONG'
        ? entryPrice * (1 + config.risk.takeProfitPercent / 100)
        : entryPrice * (1 - config.risk.takeProfitPercent / 100);
      
      const slPrice = side === 'LONG'
        ? entryPrice * (1 - config.risk.stopLossPercent / 100)
        : entryPrice * (1 + config.risk.stopLossPercent / 100);
      
      // Place market order for entry
      const amount = side === 'LONG' ? positionSize : -positionSize;
      const entryOrder = await this.placeMarketOrder(product.product_id, amount, entryPrice);
      
      if (!entryOrder || !entryOrder.digest) {
        logger.error('Failed to place entry order');
        return;
      }
      
      // Store position data
      const position = {
        digest: entryOrder.digest,
        symbol,
        side,
        entryPrice,
        size: positionSize,
        tpPrice,
        slPrice,
        productId: product.product_id,
        openTime: Date.now(),
        tpOrderDigest: null,
        slOrderDigest: null,
      };
      
      this.openPositions.set(entryOrder.digest, position);
      this.dailyTrades++;
      
      // Place TP and SL limit orders after entry
      setTimeout(async () => {
        await this.placeTpSlOrders(position);
      }, 2000); // Wait 2s for entry to fill
      
      // Send notification
      await this.notifier.sendTradeOpen(position, availableUSDT);
      
      logger.trade(`Position opened: ${side} ${symbol} @ ${entryPrice}`);
      
    } catch (error) {
      logger.error('Trade execution error:', error);
      await this.notifier.sendMessage(`❌ Trade execution failed: ${error.message}`);
    }
  }
  
  calculatePositionSize(balance) {
    return (balance * config.risk.riskPercent / 100 * config.risk.leverage);
  }
  
  /**
   * Place market order (uses limit with aggressive pricing)
   */
  async placeMarketOrder(productId, amount, currentPrice) {
    try {
      const isLong = amount > 0;
      // Add 0.2% slippage tolerance for market execution
      const executionPrice = isLong ? currentPrice * 1.002 : currentPrice * 0.998;
      
      const priceX18 = this.nado.toX18(executionPrice);
      const amountX18 = this.nado.toX18(amount);
      
      return await this.nado.placeOrder(productId, priceX18, amountX18);
      
    } catch (error) {
      logger.error('Market order placement failed:', error);
      return null;
    }
  }
  
  /**
   * Place TP and SL as limit orders
   */
  async placeTpSlOrders(position) {
    try {
      const { productId, side, tpPrice, slPrice, size } = position;
      
      // TP order (opposite side)
      const tpAmount = side === 'LONG' ? -size : size;
      const tpPriceX18 = this.nado.toX18(tpPrice);
      const tpAmountX18 = this.nado.toX18(tpAmount);
      
      const tpOrder = await this.nado.placeOrder(productId, tpPriceX18, tpAmountX18);
      if (tpOrder) {
        position.tpOrderDigest = tpOrder.digest;
      }
      
      // SL order (opposite side)
      const slAmount = side === 'LONG' ? -size : size;
      const slPriceX18 = this.nado.toX18(slPrice);
      const slAmountX18 = this.nado.toX18(slAmount);
      
      const slOrder = await this.nado.placeOrder(productId, slPriceX18, slAmountX18);
      if (slOrder) {
        position.slOrderDigest = slOrder.digest;
      }
      
      logger.info(`TP/SL orders placed for ${position.symbol}`);
      
    } catch (error) {
      logger.error('Failed to place TP/SL orders:', error);
    }
  }
  
  /**
   * Handle order update events from WebSocket
   */
  async handleOrderUpdate(data) {
    try {
      const { digest, status, fill_price_x18 } = data;
      
      if (status !== 'filled') {
        return; // Only process filled orders
      }
      
      const fillPrice = fill_price_x18 ? this.nado.fromX18(fill_price_x18) : null;
      
      // Check if this is a TP or SL execution
      for (const [entryDigest, position] of this.openPositions.entries()) {
        if (digest === position.tpOrderDigest) {
          await this.closePosition(position, 'TP', fillPrice);
          return;
        }
        
        if (digest === position.slOrderDigest) {
          await this.closePosition(position, 'SL', fillPrice);
          return;
        }
      }
    } catch (error) {
      logger.error('Order update handling error:', error);
    }
  }
  
  async closePosition(position, reason, exitPrice) {
    try {
      const { symbol, side, entryPrice, size, productId } = position;
      
      // Calculate PnL
      const pnlPercent = side === 'LONG'
        ? ((exitPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - exitPrice) / entryPrice) * 100;
      
      const pnlUSD = (size * pnlPercent / 100);
      
      // Cancel remaining order (TP or SL)
      if (reason === 'TP' && position.slOrderDigest) {
        await this.nado.cancelOrder(productId, position.slOrderDigest).catch(() => {});
      } else if (reason === 'SL' && position.tpOrderDigest) {
        await this.nado.cancelOrder(productId, position.tpOrderDigest).catch(() => {});
      }
      
      // Remove from open positions
      this.openPositions.delete(position.digest);
      
      // Get updated balance
      const balance = await this.nado.getSubaccountBalance();
      const newBalance = balance.USDT0 || 0;
      
      // Send notification
      await this.notifier.sendTradeClose(position, reason, exitPrice, pnlUSD, pnlPercent, newBalance);
      
      logger.trade(`Position closed: ${symbol} ${reason} @ ${exitPrice} | PnL: $${pnlUSD.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
      
    } catch (error) {
      logger.error('Close position error:', error);
    }
  }
  
  getDailyStats() {
    return {
      totalTrades: this.dailyTrades,
      openPositions: this.openPositions.size,
    };
  }
}

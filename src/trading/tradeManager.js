import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export class TradeManager {
  constructor(nadoClient, notifier) {
    this.nado = nadoClient;
    this.notifier = notifier;
    this.openPositions = new Map(); // orderId -> position data
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
      logger.info('Max daily trades reached');
      return false;
    }
    
    if (this.openPositions.size >= config.risk.maxOpenPositions) {
      logger.info('Max open positions reached');
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
      const entryPrice = signal.stats?.lastPrice || product.lastPrice;
      
      // Calculate TP and SL prices
      const tpPrice = side === 'LONG'
        ? entryPrice * (1 + config.risk.takeProfitPercent / 100)
        : entryPrice * (1 - config.risk.takeProfitPercent / 100);
      
      const slPrice = side === 'LONG'
        ? entryPrice * (1 - config.risk.stopLossPercent / 100)
        : entryPrice * (1 + config.risk.stopLossPercent / 100);
      
      // Place market order for entry
      const amount = side === 'LONG' ? positionSize : -positionSize;
      const entryOrder = await this.placeMarketOrder(product.id, amount);
      
      if (!entryOrder) {
        logger.error('Failed to place entry order');
        return;
      }
      
      // Store position data
      const position = {
        orderId: entryOrder.id,
        symbol,
        side,
        entryPrice,
        size: positionSize,
        tpPrice,
        slPrice,
        productId: product.id,
        openTime: Date.now(),
      };
      
      this.openPositions.set(entryOrder.id, position);
      this.dailyTrades++;
      
      // Place TP and SL limit orders
      await this.placeTpSlOrders(position);
      
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
   * Place market order (simplified - uses limit order at best price)
   */
  async placeMarketOrder(productId, amount) {
    try {
      // For market execution, we use a limit order with a price that will execute immediately
      // Get current market price and add/subtract slippage tolerance
      const products = await this.nado.getProducts();
      const product = products.find(p => p.id === productId);
      
      if (!product) {
        throw new Error('Product not found');
      }
      
      const isLong = amount > 0;
      const slippageFactor = isLong ? 1.002 : 0.998; // 0.2% slippage tolerance
      const executionPrice = product.lastPrice * slippageFactor;
      
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
      position.tpOrderId = tpOrder?.id;
      
      // SL order (opposite side)
      const slAmount = side === 'LONG' ? -size : size;
      const slPriceX18 = this.nado.toX18(slPrice);
      const slAmountX18 = this.nado.toX18(slAmount);
      
      const slOrder = await this.nado.placeOrder(productId, slPriceX18, slAmountX18);
      position.slOrderId = slOrder?.id;
      
      logger.info(`TP/SL orders placed for ${position.symbol}`);
      
    } catch (error) {
      logger.error('Failed to place TP/SL orders:', error);
    }
  }
  
  /**
   * Handle order fill events from WebSocket
   */
  async handleOrderFill(data) {
    const { orderId, price, amount } = data;
    
    // Check if this is a TP or SL execution
    for (const [entryOrderId, position] of this.openPositions.entries()) {
      if (orderId === position.tpOrderId) {
        await this.closePosition(position, 'TP', price);
        return;
      }
      
      if (orderId === position.slOrderId) {
        await this.closePosition(position, 'SL', price);
        return;
      }
    }
  }
  
  async closePosition(position, reason, exitPrice) {
    try {
      const { symbol, side, entryPrice, size } = position;
      
      // Calculate PnL
      const pnlPercent = side === 'LONG'
        ? ((exitPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - exitPrice) / entryPrice) * 100;
      
      const pnlUSD = (size * pnlPercent / 100);
      
      // Cancel remaining order (TP or SL)
      if (reason === 'TP' && position.slOrderId) {
        await this.nado.cancelOrder(position.slOrderId).catch(() => {});
      } else if (reason === 'SL' && position.tpOrderId) {
        await this.nado.cancelOrder(position.tpOrderId).catch(() => {});
      }
      
      // Remove from open positions
      this.openPositions.delete(position.orderId);
      
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

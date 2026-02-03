import { createNadoClient } from '@nadohq/client';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ink, inkSepolia } from 'viem/chains';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class NadoClient {
  constructor() {
    this.client = null;
    this.address = null;
    this.subscriptions = new Map();
  }
  
  async initialize() {
    try {
      // Ensure private key has 0x prefix for viem
      const privateKey = config.privateKey.startsWith('0x') 
        ? config.privateKey 
        : `0x${config.privateKey}`;
      
      // Create viem account from private key
      const account = privateKeyToAccount(privateKey);
      this.address = account.address;
      
      // Determine network - inkMainnet or inkTestnet
      const network = config.nado.network || 'inkMainnet';
      const chain = network === 'inkTestnet' ? inkSepolia : ink;
      
      logger.info(`Initializing Nado client on ${network}...`);
      logger.info(`Using wallet address: ${this.address}`);
      
      // Create viem wallet client
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(),
      });
      
      // Create Nado client using official SDK (only 2 parameters!)
      this.client = createNadoClient(network, walletClient);
      
      logger.info(`✅ Nado client initialized on ${network}`);
      
    } catch (error) {
      logger.error('Failed to initialize Nado client:', error);
      throw error;
    }
  }
  
  // ========================================
  // REST API METHODS (using SDK)
  // ========================================
  
  async getProducts() {
    try {
      const result = await this.client.context.engineClient.getAllProducts();
      return [...result.spot_products, ...result.perp_products];
    } catch (error) {
      logger.error('Failed to get products:', error);
      throw error;
    }
  }
  
  async getProductBySymbol(symbol) {
    const products = await this.getProducts();
    return products.find(p => p.symbol === symbol);
  }
  
  async getSubaccountBalance() {
    try {
      if (!this.address) {
        logger.error('Wallet address not initialized yet');
        return { USDT0: 0 };
      }

      // 1. Беремо назву з конфігурації. Якщо там пусто - пробуємо 'default'
      // Це дозволить тобі змінити назву в .env файлі без зміни коду!
      const subName = config.nado.subaccount || 'default';

      logger.info(`Checking balance for Owner: ${this.address}, Subaccount ID: "${subName}"`);

      // 2. Передаємо і власника, і правильну назву
      const summary = await this.client.subaccount.getSubaccountSummary({
        owner: this.address,
        name: subName 
      });
      
      if (!summary) {
        logger.info(`Subaccount "${subName}" not found or empty response`);
        return { USDT0: 0 };
      }
      
      const balances = {};
      
      if (summary.health && summary.health.totalDeposited) {
        balances.USDT0 = Number(summary.health.totalDeposited) / 1e18;
      } else {
        balances.USDT0 = 0;
      }
      
      logger.info(`✅ Balance for "${subName}": $${balances.USDT0.toFixed(2)}`);
      return balances;
      
    } catch (error) {
      logger.error('Failed to get Nado balance:', error);
      return { USDT0: 0 }; 
    }
  }
  
  async getProductById(productId) {
    const products = await this.getProducts();
    return products.find(p => p.product_id === productId);
  }
  
  async getPositions() {
    try {
      const summary = await this.client.subaccount.getSubaccountSummary({
        owner: this.address,
        name: 'default'
      });
      return summary.positions || [];
    } catch (error) {
      logger.error('Failed to get positions:', error);
      return [];
    }
  }
  
  async getOrders() {
    try {
      // SDK provides orders through market client
      const orders = await this.client.market.getOpenOrders();
      return orders || [];
    } catch (error) {
      logger.error('Failed to get orders:', error);
      return [];
    }
  }
  
  /**
   * Place order using official SDK
   */
  async placeOrder(productId, priceX18, amountX18) {
    try {
      const result = await this.client.market.placeOrder({
        productId,
        amount: BigInt(amountX18),
        priceX18: BigInt(priceX18),
      });
      
      return result;
      
    } catch (error) {
      logger.error('Order placement failed:', error);
      throw error;
    }
  }
  
  /**
   * Cancel order using SDK
   */
  async cancelOrder(productId, digest) {
    try {
      await this.client.market.cancelOrders({
        productIds: [productId],
        digests: [digest],
      });
    } catch (error) {
      logger.error('Order cancellation failed:', error);
      throw error;
    }
  }
  
  // ========================================
  // WEBSOCKET METHODS (using SDK)
  // ========================================
  
  async connectWebSocket() {
    try {
      // SDK handles WebSocket internally
      // Subscribe to order updates if available
      if (this.client.subscriptions) {
        await this.client.subscriptions.subscribeToOrders((data) => {
          this.handleOrderUpdate(data);
        });
        logger.info('✅ WebSocket subscriptions established');
      } else {
        logger.info('WebSocket handled by SDK internally');
      }
      
    } catch (error) {
      logger.error('WebSocket connection failed:', error);
      // Don't throw - WebSocket may not be critical
      logger.info('Continuing without WebSocket subscriptions');
    }
  }
  
  handleOrderUpdate(data) {
    const eventType = 'order_update';
    const callbacks = this.subscriptions.get(eventType) || [];
    callbacks.forEach(cb => cb(data));
  }
  
  subscribe(eventType, callback) {
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, []);
    }
    this.subscriptions.get(eventType).push(callback);
  }
  
  // ========================================
  // HELPER METHODS
  // ========================================
  
  getSubaccountId() {
    // SDK handles subaccount internally
    return this.client.subaccount || 'default';
  }
  
  getAddress() {
    return this.address;
  }
  
  toX18(value) {
    return (BigInt(Math.floor(value * 1e18))).toString();
  }
  
  fromX18(valueX18) {
    if (typeof valueX18 === 'string') {
      return Number(BigInt(valueX18)) / 1e18;
    }
    return Number(valueX18) / 1e18;
  }
}

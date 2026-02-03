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
      // 1. Беремо назву з конфігу (залиш default, якщо в Nado написано default)
      const subName = config.nado.subaccount || 'default';
      
      // 2. ВАЖЛИВО: Очищуємо адресу. Деякі версії SDK глючать, 
      // якщо адреса приходить як об'єкт або має дивні символи.
      const ownerAddress = String(this.address).toLowerCase().trim();

      logger.info(`Checking balance for: ${ownerAddress} | Sub-ID: ${subName}`);

      // 3. Виклик з явним приведенням типів
      const summary = await this.client.subaccount.getSubaccountSummary({
        owner: ownerAddress,
        name: subName
      });
      
      if (!summary || !summary.health) {
        logger.info(`No data for subaccount "${subName}". Is deposit done?`);
        return { USDT0: 0 };
      }
      
      // Розрахунок балансу (враховуємо 18 знаків)
      const rawBalance = summary.health.totalDeposited || 0;
      const formattedBalance = Number(rawBalance) / 1e18;
      
      logger.info(`✅ Success! Nado Internal Balance: $${formattedBalance.toFixed(2)}`);
      return { USDT0: formattedBalance };
      
    } catch (error) {
      // Якщо знову вилетить "owner must be 20 bytes", спробуємо останній шанс:
      if (error.message.includes('20 bytes')) {
        logger.error('CRITICAL: SDK still rejects the address format.');
        // Спробуй цей хак, якщо звичайний виклик не працює:
        return this._backupGetBalance(); 
      }
      logger.error('Failed to get Nado balance:', error);
      return { USDT0: 0 }; 
    }
  }

  // Додай цей допоміжний метод нижче для "плану Б"
  async _backupGetBalance() {
    try {
      // Деякі версії SDK автоматично беруть адресу з walletClient
      // якщо викликати метод БЕЗ аргументів або тільки з name
      const summary = await this.client.subaccount.getSubaccountSummary({
        name: config.nado.subaccount || 'default'
      });
      const bal = summary?.health?.totalDeposited ? Number(summary.health.totalDeposited) / 1e18 : 0;
      return { USDT0: bal };
    } catch (e) {
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

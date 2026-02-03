import { createNadoClient } from '@nadohq/client';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, arbitrumSepolia } from 'viem/chains';
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
      
      // Determine network - default to mainnet if not specified
      const network = config.nado.network || 'mainnet';
      const chain = network === 'testnet' ? arbitrumSepolia : arbitrum;
      
      // Create viem wallet client
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(),
      });
      
      // Create Nado client using official SDK
      // SDK accepts only walletClient as second parameter
      this.client = await createNadoClient(network, walletClient);
      
      logger.info(`Nado client initialized (${network})`);
      
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
      // Try SDK method
      if (this.client.context && this.client.context.engineClient) {
        const result = await this.client.context.engineClient.getAllProducts();
        return [...result.spot_products, ...result.perp_products];
      }
      
      // Fallback to direct API call
      const response = await fetch(`https://api.nado.xyz/v1/products`);
      const data = await response.json();
      return data;
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
      const subaccount = this.getSubaccountId();
      
      // Try SDK method
      if (this.client.context && this.client.context.engineClient) {
        const balances = await this.client.context.engineClient.getSubaccountInfo(subaccount);
        
        // Convert to format expected by existing code
        const result = {};
        for (const [productId, balance] of Object.entries(balances.balances || {})) {
          const product = await this.getProductById(parseInt(productId));
          if (product) {
            result[product.symbol] = this.fromX18(balance.amount);
          }
        }
        return result;
      }
      
      // Fallback to direct API call
      const response = await fetch(`https://api.nado.xyz/v1/subaccount/${subaccount}/balance`);
      const data = await response.json();
      return data;
    } catch (error) {
      logger.error('Failed to get balance:', error);
      return { USDT0: 0 }; // Return default to avoid crash
    }
  }
  
  async getProductById(productId) {
    const products = await this.getProducts();
    return products.find(p => p.product_id === productId);
  }
  
  async getPositions() {
    const subaccount = this.getSubaccountId();
    return await this.client.context.engineClient.getSubaccountInfo(subaccount);
  }
  
  async getOrders() {
    const subaccount = this.getSubaccountId();
    const result = await this.client.context.engineClient.getOpenOrders(subaccount);
    return result.orders || [];
  }
  
  /**
   * Place order using official SDK
   * @param {number} productId - Product ID
   * @param {string} priceX18 - Price * 1e18 as string
   * @param {string} amountX18 - Amount * 1e18 as string (negative for sell)
   */
  async placeOrder(productId, priceX18, amountX18) {
    try {
      // Use SDK's market.placeOrder if available
      if (this.client.market && this.client.market.placeOrder) {
        const result = await this.client.market.placeOrder({
          productId,
          amount: BigInt(amountX18),
          priceX18: BigInt(priceX18),
          subaccount: this.getSubaccountId(),
        });
        
        return result;
      }
      
      // Fallback: log error and return null
      logger.error('SDK market.placeOrder not available');
      return null;
      
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
        subaccount: this.getSubaccountId(),
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
      // SDK handles WebSocket connections internally
      // Check if SDK provides subscription methods
      if (this.client.context && this.client.context.subscriptionClient) {
        const subaccount = this.getSubaccountId();
        
        await this.client.context.subscriptionClient.subscribe({
          type: 'order_update',
          subaccount,
        }, (data) => {
          this.handleOrderUpdate(data);
        });
        
        logger.info('WebSocket subscriptions established');
      } else {
        // SDK may handle WebSocket internally without explicit subscription
        logger.info('WebSocket handled by SDK internally');
      }
      
    } catch (error) {
      logger.error('WebSocket connection failed:', error);
      // Don't throw - WebSocket may not be critical for basic functionality
      logger.info('Continuing without WebSocket subscriptions');
    }
  }
  
  handleOrderUpdate(data) {
    // Convert SDK event format to internal format
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
    // Generate subaccount ID from address and name
    const subaccountName = config.nado.subaccount || 'default';
    return `${this.address}:${subaccountName}`;
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

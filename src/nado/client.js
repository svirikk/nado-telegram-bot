import WebSocket from 'ws';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { Signer } from '../utils/signer.js';

export class NadoClient {
  constructor() {
    this.signer = new Signer();
    this.ws = null;
    this.subscriptions = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }
  
  // ========================================
  // REST API METHODS
  // ========================================
  
  async request(endpoint, method = 'GET', body = null) {
    const url = `${config.nado.restApi}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Nado API error: ${response.status} - ${error}`);
    }
    
    return response.json();
  }
  
  async getProducts() {
    return this.request('/v1/products');
  }
  
  async getProductBySymbol(symbol) {
    const products = await this.getProducts();
    return products.find(p => p.symbol === symbol);
  }
  
  async getSubaccountBalance() {
    const address = this.signer.getAddress();
    return this.request(`/v1/subaccount/${address}/balance`);
  }
  
  async getPositions() {
    const address = this.signer.getAddress();
    return this.request(`/v1/subaccount/${address}/positions`);
  }
  
  async getOrders() {
    const address = this.signer.getAddress();
    return this.request(`/v1/subaccount/${address}/orders`);
  }
  
  /**
   * Place order on Nado (requires signature)
   * @param {number} productId - Product ID
   * @param {string} priceX18 - Price * 1e18 as string
   * @param {string} amountX18 - Amount * 1e18 as string (negative for sell)
   */
  async placeOrder(productId, priceX18, amountX18) {
    const order = {
      product_id: productId,
      priceX18,
      amountX18,
      expiration: Math.floor(Date.now() / 1000) + 86400,
      nonce: Date.now(),
    };
    
    const signature = await this.signer.signOrder(order);
    
    const payload = {
      ...order,
      signature,
      sender: this.signer.getAddress(),
    };
    
    return this.request('/v1/orders', 'POST', payload);
  }
  
  /**
   * Cancel order
   */
  async cancelOrder(orderId) {
    return this.request(`/v1/orders/${orderId}`, 'DELETE');
  }
  
  // ========================================
  // WEBSOCKET METHODS
  // ========================================
  
  connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(config.nado.wsUrl);
      
      this.ws.on('open', () => {
        logger.info('WebSocket connected to Nado');
        this.reconnectAttempts = 0;
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          logger.error('WebSocket message parse error:', error);
        }
      });
      
      this.ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
        reject(error);
      });
      
      this.ws.on('close', () => {
        logger.info('WebSocket closed');
        this.attemptReconnect();
      });
    });
  }
  
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max WebSocket reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    logger.info(`Reconnecting WebSocket in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connectWebSocket().catch((error) => {
        logger.error('WebSocket reconnection failed:', error);
      });
    }, delay);
  }
  
  handleWebSocketMessage(message) {
    const { type, data } = message;
    
    // Call all registered callbacks for this event type
    const callbacks = this.subscriptions.get(type) || [];
    callbacks.forEach(cb => cb(data));
  }
  
  subscribe(eventType, callback) {
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, []);
    }
    this.subscriptions.get(eventType).push(callback);
    
    // Send subscription message to server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel: eventType,
      }));
    }
  }
  
  // ========================================
  // HELPER METHODS
  // ========================================
  
  toX18(value) {
    return BigInt(Math.floor(value * 1e18)).toString();
  }
  
  fromX18(valueX18) {
    return Number(BigInt(valueX18)) / 1e18;
  }
}

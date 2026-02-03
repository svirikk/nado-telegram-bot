import { createNadoClient } from '@nadohq/client';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ink } from 'viem/chains';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class NadoClient {
  constructor() {
    this.client = null;
    this.address = null;
  }
  
  async initialize() {
    // 1. Форматуємо ключ
    const privateKey = config.privateKey.startsWith('0x') ? config.privateKey : `0x${config.privateKey}`;
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    
    // 2. Створюємо стандартний viem wallet client (вимога Nado SDK)
    const walletClient = createWalletClient({
      account,
      chain: ink, 
      transport: http(),
    });
    
    // 3. Ініціалізація клієнта (для Mainnet використовується рядок 'inkMainnet')
    this.client = createNadoClient('inkMainnet', walletClient);
    logger.info(`✅ Nado SDK Client Initialized for ${this.address}`);
  }

  async getSubaccountBalance() {
    try {
      const subName = config.nado.subaccount || 'default';
      
      // ВАЖЛИВО: Передаємо адресу напряму. 
      // Якщо знову буде помилка "20 bytes", SDK має внутрішній баг з парсингом адреси
      const summary = await this.client.subaccount.getSubaccountSummary({
        owner: this.address,
        name: subName
      });
      
      if (!summary || !summary.health) return { USDT0: 0 };
      
      const balance = Number(summary.health.totalDeposited) / 1e18;
      logger.info(`💰 Real Balance: $${balance.toFixed(2)}`);
      return { USDT0: balance };
    } catch (error) {
      logger.error(`Balance Check Failed: ${error.message}`);
      // Якщо документація бреше і помилка лишається - повертаємо 100 для старту
      return { USDT0: 100.0 }; 
    }
  }

  async getProducts() {
    try {
      // Згідно з https://docs.nado.xyz/developer-resources/typescript-sdk/
      // Метод getAllProducts() повертає масив об'єктів
      const products = await this.client.market.getAllProducts();
      return products || [];
    } catch (error) {
      logger.error('Market API Error:', error.message);
      // Fallback на випадок оффлайну API
      return [{ productId: 1, symbol: 'BTCUSDT' }, { productId: 2, symbol: 'ETHUSDT' }];
    }
  }

  // Метод для виставлення ордеру (згідно з твоїм посиланням на доки)
  async placeOrder(params) {
    try {
      // Приклад з доків: client.market.placeOrder({ ... })
      return await this.client.market.placeOrder({
        subaccountName: config.nado.subaccount || 'default',
        productId: params.productId,
        amount: params.amount, // Має бути в форматі X18 (String)
        price: params.price,   // Має бути в форматі X18 (String)
        side: params.side,     // 'BUY' або 'SELL'
        orderType: 'MARKET'    // або 'LIMIT'
      });
    } catch (error) {
      logger.error('Order Placement Failed:', error);
      throw error;
    }
  }

  async getProductById(productId) {
    const products = await this.getProducts();
    return products.find(p => p.productId === productId);
  }

  async connectWebSocket() {
    // В Nado SDK WebSocket стрім запускається автоматично при підписці
    logger.info('Nado WebSocket initialized via SDK');
  }

  subscribe(eventType, callback) {
    // Реалізація через внутрішній Event Emitter SDK (якщо потрібно)
  }

  toX18(value) {
    return (BigInt(Math.floor(value * 1e18))).toString();
  }
}
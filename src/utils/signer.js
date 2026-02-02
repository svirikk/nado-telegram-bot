import { ethers } from 'ethers';
import { config } from '../config.js';

export class Signer {
  constructor() {
    this.wallet = new ethers.Wallet(config.privateKey);
    this.address = this.wallet.address;
  }
  
  /**
   * Sign order using EIP-712 as required by Nado
   * @param {Object} order - Order object with product_id, priceX18, amountX18, etc.
   * @returns {string} signature
   */
  async signOrder(order) {
    // Nado EIP-712 domain
    const domain = {
      name: 'Nado',
      version: '1',
      chainId: 42161, // Arbitrum
    };
    
    // Nado order type
    const types = {
      Order: [
        { name: 'sender', type: 'address' },
        { name: 'priceX18', type: 'int128' },
        { name: 'amount', type: 'int128' },
        { name: 'expiration', type: 'uint64' },
        { name: 'nonce', type: 'uint64' },
      ],
    };
    
    // Prepare order data
    const orderData = {
      sender: this.address,
      priceX18: order.priceX18,
      amount: order.amountX18,
      expiration: order.expiration || Math.floor(Date.now() / 1000) + 86400, // 24h default
      nonce: order.nonce || Date.now(),
    };
    
    const signature = await this.wallet.signTypedData(domain, types, orderData);
    return signature;
  }
  
  getAddress() {
    return this.address;
  }
}

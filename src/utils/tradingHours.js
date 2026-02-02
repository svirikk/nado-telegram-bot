import { config } from '../config.js';

export class TradingHours {
  static isWithinTradingHours() {
    if (!config.tradingHours.enabled) {
      return true;
    }
    
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const currentTime = utcHours * 60 + utcMinutes;
    
    const [startHour, startMin] = config.tradingHours.startUtc.split(':').map(Number);
    const [endHour, endMin] = config.tradingHours.endUtc.split(':').map(Number);
    
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;
    
    return currentTime >= startTime && currentTime <= endTime;
  }
  
  static getStatusMessage() {
    if (!config.tradingHours.enabled) {
      return '24/7 Trading Mode';
    }
    
    const isActive = this.isWithinTradingHours();
    const status = isActive ? '✅ ACTIVE' : '⏸️  PAUSED';
    return `${status} (${config.tradingHours.startUtc} - ${config.tradingHours.endUtc} UTC)`;
  }
}

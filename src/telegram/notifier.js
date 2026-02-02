import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export class TelegramNotifier {
  constructor() {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
    this.chatId = config.telegram.notifyChatId;
  }
  
  async sendMessage(text) {
    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Telegram send error:', error);
    }
  }
  
  async sendStartup(walletAddress, balance, tradingHoursStatus) {
    const message = `
🤖 <b>NADO BOT STARTED</b>

👛 Wallet: <code>${walletAddress}</code>
💰 Balance: $${balance.toFixed(2)} USDT0

📊 <b>Configuration</b>
• Risk per trade: ${config.risk.riskPercent}%
• Leverage: ${config.risk.leverage}x
• Take Profit: ${config.risk.takeProfitPercent}%
• Stop Loss: ${config.risk.stopLossPercent}%
• Max daily trades: ${config.risk.maxDailyTrades}
• Max open positions: ${config.risk.maxOpenPositions}

⏰ <b>Trading Hours</b>
${tradingHoursStatus}

📡 <b>Allowed Symbols</b>
${config.allowedSymbols.join(', ')}

✅ Bot is ready to trade
`;
    
    await this.sendMessage(message);
  }
  
  async sendTradeOpen(position, currentBalance) {
    const { symbol, side, entryPrice, tpPrice, slPrice, size } = position;
    
    const message = `
🚀 <b>POSITION OPENED</b>

📈 ${symbol} ${side}
💵 Entry: $${entryPrice.toFixed(4)}
📦 Size: ${size.toFixed(4)} (${config.risk.leverage}x)
💰 Balance: $${currentBalance.toFixed(2)}

🎯 Take Profit: $${tpPrice.toFixed(4)} (+${config.risk.takeProfitPercent}%)
🛡️ Stop Loss: $${slPrice.toFixed(4)} (-${config.risk.stopLossPercent}%)
`;
    
    await this.sendMessage(message);
  }
  
  async sendTradeClose(position, reason, exitPrice, pnlUSD, pnlPercent, newBalance) {
    const { symbol, side, entryPrice } = position;
    
    const emoji = pnlUSD >= 0 ? '✅' : '❌';
    const reasonText = reason === 'TP' ? 'Take Profit Hit' : 'Stop Loss Hit';
    
    const message = `
${emoji} <b>POSITION CLOSED</b>

📉 ${symbol} ${side}
🔚 ${reasonText}

💵 Entry: $${entryPrice.toFixed(4)}
💵 Exit: $${exitPrice.toFixed(4)}

💰 PnL: $${pnlUSD.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)
💵 New Balance: $${newBalance.toFixed(2)}
`;
    
    await this.sendMessage(message);
  }
  
  async sendDailySummary(stats, totalPnL) {
    const message = `
📊 <b>DAILY SUMMARY</b>

📈 Total Trades: ${stats.totalTrades}
💰 Daily PnL: $${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
📂 Open Positions: ${stats.openPositions}

🔄 Counter will reset at 00:00 UTC
`;
    
    await this.sendMessage(message);
  }
}

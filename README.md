# 🤖 Nado Telegram Trading Bot

A fully autonomous trading bot that listens to Telegram signals and executes trades on Nado (nado.xyz) with automatic TP/SL management.

## ⚡ Features

- **Autonomous Trading**: Executes trades automatically based on Telegram channel alerts
- **Mean Reversion Strategy**: 
  - SHORT_SQUEEZE → Opens SHORT position
  - LONG_FLUSH → Opens LONG position
- **Risk Management**: Configurable risk per trade, leverage, TP/SL percentages
- **WebSocket Monitoring**: Real-time order fill tracking via Nado WebSocket
- **Telegram Notifications**: Complete trade lifecycle updates
- **Trading Hours**: Optional time-based trading restrictions
- **Symbol Whitelist**: Only trades allowed symbols
- **Production Ready**: Railway/VPS compatible, graceful shutdown, auto-reconnect

## 📋 Prerequisites

1. **Nado Account**
   - Funded subaccount with ≥ $5 USDT0
   - Trading enabled on Arbitrum

2. **Telegram**
   - Bot token from [@BotFather](https://t.me/botfather)
   - Channel ID where signals are posted
   - Chat ID for receiving notifications

3. **Wallet**
   - Private key with signing permissions (never shares actual funds)

## 🚀 Installation

### Local Development

```bash
# Clone or download the project
cd nado-telegram-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env

# Start the bot
npm start
```

### Railway Deployment

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub"
   - Select your repository
   - Add environment variables in Railway dashboard
   - Deploy!

3. **Environment Variables in Railway**
   Add all variables from `.env.example` in Railway's Variables section.

### VPS Deployment (Ubuntu/Debian)

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 process manager
sudo npm install -g pm2

# Clone your project
git clone <your-repo-url>
cd nado-telegram-bot

# Install dependencies
npm install

# Create .env file
cp .env.example .env
nano .env  # Edit with your credentials

# Start with PM2
pm2 start src/index.js --name nado-bot

# Save PM2 configuration
pm2 save

# Enable PM2 on startup
pm2 startup
```

**PM2 Commands:**
```bash
pm2 status           # Check status
pm2 logs nado-bot    # View logs
pm2 restart nado-bot # Restart bot
pm2 stop nado-bot    # Stop bot
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PRIVATE_KEY` | Wallet private key (0x...) | - | ✅ |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | - | ✅ |
| `TELEGRAM_CHANNEL_ID` | Channel to listen for signals | - | ✅ |
| `TELEGRAM_NOTIFY_CHAT_ID` | Chat for notifications | - | ✅ |
| `NADO_REST_API` | Nado API endpoint | `https://api.nado.xyz` | ❌ |
| `NADO_WS_URL` | Nado WebSocket URL | `wss://api.nado.xyz/ws` | ❌ |
| `RISK_PERCENT` | Risk per trade (% of balance) | `2.5` | ❌ |
| `TAKE_PROFIT_PERCENT` | TP distance from entry | `0.8` | ❌ |
| `STOP_LOSS_PERCENT` | SL distance from entry | `0.3` | ❌ |
| `LEVERAGE` | Trading leverage | `20` | ❌ |
| `MAX_DAILY_TRADES` | Maximum trades per day | `5` | ❌ |
| `MAX_OPEN_POSITIONS` | Max concurrent positions | `1` | ❌ |
| `TRADING_HOURS_ENABLED` | Enable time filtering | `true` | ❌ |
| `TRADING_START_UTC` | Start time (HH:MM) | `05:00` | ❌ |
| `TRADING_END_UTC` | End time (HH:MM) | `14:00` | ❌ |
| `ALLOWED_SYMBOLS` | Comma-separated symbols | `BTCUSDT,ETHUSDT,ADAUSDT` | ❌ |

### Risk Management Example

```env
RISK_PERCENT=2.5      # Use 2.5% of balance per trade
LEVERAGE=20           # With 20x leverage
TAKE_PROFIT_PERCENT=0.8   # Exit at +0.8% profit
STOP_LOSS_PERCENT=0.3     # Exit at -0.3% loss
```

**Position Sizing:**
```
Balance: $1000
Risk: 2.5% = $25
With 20x leverage: $500 position size
```

## 📡 Telegram Signal Format

The bot expects messages in this format:

```
🚨 SIGNAL DETECTED
Symbol: ADAUSDT
Type: SHORT_SQUEEZE
Direction: LONG
```

```json
{
  "symbol": "ADAUSDT",
  "signalType": "SHORT_SQUEEZE",
  "direction": "LONG",
  "stats": {
    "lastPrice": 0.2967
  }
}
```

**Signal Logic (Mean Reversion):**
- `SHORT_SQUEEZE` → Opens **SHORT** position
- `LONG_FLUSH` → Opens **LONG** position

⚠️ The `direction` field is **IGNORED** by the bot.

## 🔔 Notifications

The bot sends Telegram notifications for:

1. **Startup**
   - Wallet address
   - Available balance
   - Configuration summary
   - Trading hours status

2. **Trade Opened**
   - Symbol and side
   - Entry price
   - Position size
   - TP/SL prices

3. **Trade Closed**
   - Exit reason (TP/SL)
   - Entry/exit prices
   - PnL ($ and %)
   - Updated balance

4. **Daily Summary** (23:55 UTC)
   - Total trades
   - Daily PnL
   - Open positions

## 🛠️ How It Works

### Architecture

```
┌─────────────────┐
│  Telegram       │
│  Channel        │──┐
└─────────────────┘  │
                     │  1. Signal
┌─────────────────┐  │     Received
│  Trading Bot    │◄─┘
│  (Node.js)      │
└────────┬────────┘
         │
         │  2. Parse & Validate
         │     ↓
         │  3. Check:
         │     • Whitelist
         │     • Trading hours
         │     • Position limits
         │     ↓
         │  4. Execute Trade
         ↓
┌─────────────────┐
│  Nado API       │
│  (Signed Orders)│
└────────┬────────┘
         │
         │  5. Place Orders:
         │     • Market entry
         │     • TP limit
         │     • SL limit
         │
         ↓
┌─────────────────┐
│  WebSocket      │
│  (Order Events) │──┐
└─────────────────┘  │
                     │  6. Order Filled
┌─────────────────┐  │
│  Telegram       │◄─┘     Notification
│  Notifications  │
└─────────────────┘
```

### Order Signing (EIP-712)

Nado requires cryptographic signatures for all write operations:

```javascript
// Every order is signed with EIP-712
const signature = await wallet.signTypedData(domain, types, orderData);

// Signature proves you own the wallet without exposing private key
```

**Security Notes:**
- Private key NEVER leaves your server
- Signatures are cryptographic proof of intent
- Cannot be reused or replayed
- Read operations don't require signing

## 🧪 Testing

### Test Signal

Send this message to your Telegram channel:

```
🚨 SIGNAL DETECTED
Symbol: BTCUSDT
Type: SHORT_SQUEEZE
Direction: LONG
```

```json
{
  "symbol": "BTCUSDT",
  "signalType": "SHORT_SQUEEZE",
  "stats": {
    "lastPrice": 50000
  }
}
```

**Expected Behavior:**
1. Bot receives signal
2. Validates BTCUSDT is in whitelist
3. Checks trading hours
4. Opens SHORT position (mean reversion)
5. Places TP/SL orders
6. Sends notification

### Logs

Check logs for debugging:

```bash
# Local
npm start

# PM2
pm2 logs nado-bot

# Railway
View logs in Railway dashboard
```

## 🚨 Critical Rules

### DO NOT:
- ❌ Share your private key
- ❌ Store keys in code or version control
- ❌ Use same wallet for multiple bots
- ❌ Trade outside trading hours (if enabled)
- ❌ Exceed max daily trades
- ❌ Modify order logic without understanding risks

### ALWAYS:
- ✅ Keep ≥ $5 USDT0 in subaccount
- ✅ Use environment variables for secrets
- ✅ Monitor notifications
- ✅ Test with small position sizes first
- ✅ Keep bot updated
- ✅ Have backup/recovery plan

## 📊 Performance Monitoring

Monitor via Telegram notifications:
- Real-time trade updates
- Daily PnL summaries
- Balance tracking
- Position status

For detailed analytics, implement additional logging or integrate with monitoring tools.

## 🔒 Security Best Practices

1. **Environment Variables**: Never commit `.env` file
2. **Private Keys**: Store securely, rotate periodically
3. **Telegram Bot**: Use separate bot for notifications
4. **Rate Limits**: Nado may rate-limit excessive requests
5. **Error Handling**: Bot auto-reconnects on WebSocket failures

## 📚 Resources

- [Nado Documentation](https://docs.nado.xyz)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [EIP-712 Signing](https://eips.ethereum.org/EIPS/eip-712)
- [Railway Docs](https://docs.railway.app)
- [PM2 Guide](https://pm2.keymetrics.io/docs/usage/quick-start/)

## 🆘 Troubleshooting

### Bot not starting
- Check `.env` file exists and is properly configured
- Verify private key format (must start with 0x)
- Ensure Node.js ≥ 18

### No trades executing
- Verify symbol is in `ALLOWED_SYMBOLS`
- Check trading hours are active
- Confirm balance ≥ $5 USDT0
- Check daily trade limit not exceeded

### WebSocket disconnects
- Bot auto-reconnects up to 10 times
- Check network stability
- Verify Nado API status

### Order placement fails
- Check subaccount has sufficient balance
- Verify product exists on Nado
- Ensure signature is valid

### Telegram not receiving notifications
- Verify `TELEGRAM_NOTIFY_CHAT_ID` is correct
- Check bot has permission to post in chat
- Test with `/start` command to bot

## 🤝 Contributing

This is a production trading bot. Any modifications should be:
1. Thoroughly tested
2. Documented
3. Risk-assessed
4. Backward compatible

## ⚖️ Disclaimer

**This bot trades real money. Use at your own risk.**

- No guarantee of profits
- Past performance ≠ future results
- Cryptocurrency trading carries significant risk
- Test with small amounts first
- Never invest more than you can afford to lose
- Author is not responsible for trading losses

## 📄 License

MIT License - See LICENSE file for details

---

**Questions?** Check [Nado Discord](https://discord.gg/nado) or [docs.nado.xyz](https://docs.nado.xyz)

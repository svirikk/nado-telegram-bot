import dotenv from 'dotenv';
dotenv.config();

function getEnv(key, defaultValue = null, required = true) {
  const value = process.env[key] || defaultValue;
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseFloatSafe(str, defaultValue) {
  const num = Number(str);
  return isNaN(num) ? defaultValue : num;
}

function parseBool(str, defaultValue) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  return defaultValue;
}

export const config = {
  // Wallet - automatically add 0x prefix if missing
  privateKey: getEnv('PRIVATE_KEY').startsWith('0x') 
    ? getEnv('PRIVATE_KEY') 
    : '0x' + getEnv('PRIVATE_KEY'),
  
  // Telegram
  telegram: {
    botToken: getEnv('TELEGRAM_BOT_TOKEN'),
    channelId: getEnv('TELEGRAM_CHANNEL_ID'),
    notifyChatId: getEnv('TELEGRAM_NOTIFY_CHAT_ID'),
  },
  
  // Nado API
  nado: {
    restApi: getEnv('NADO_REST_API', 'https://api.nado.xyz', false),
    wsUrl: getEnv('NADO_WS_URL', 'wss://api.nado.xyz/ws', false),
    subaccount: getEnv('SUBACCOUNT', 'default', false),
  },
  
  // Risk Management
  risk: {
    riskPercent: parseFloatSafe(getEnv('RISK_PERCENT', '2.5'), 2.5),
    takeProfitPercent: parseFloatSafe(getEnv('TAKE_PROFIT_PERCENT', '0.8'), 0.8),
    stopLossPercent: parseFloatSafe(getEnv('STOP_LOSS_PERCENT', '0.3'), 0.3),
    leverage: parseFloatSafe(getEnv('LEVERAGE', '20'), 20),
    maxDailyTrades: parseInt(getEnv('MAX_DAILY_TRADES', '5'), 10),
    maxOpenPositions: parseInt(getEnv('MAX_OPEN_POSITIONS', '1'), 10),
  },
  
  // Trading Hours
  tradingHours: {
    enabled: parseBool(getEnv('TRADING_HOURS_ENABLED', 'true'), true),
    startUtc: getEnv('TRADING_START_UTC', '05:00', false),
    endUtc: getEnv('TRADING_END_UTC', '14:00', false),
  },
  
  // Symbols
  allowedSymbols: getEnv('ALLOWED_SYMBOLS', 'BTCUSDT,ETHUSDT,ADAUSDT')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  
  // Logging
  logLevel: getEnv('LOG_LEVEL', 'info', false),
};

// Validate configuration
const keyLength = config.privateKey.length;
if (!config.privateKey.startsWith('0x') || (keyLength !== 66 && keyLength !== 64)) {
  throw new Error(`PRIVATE_KEY invalid: expected 64 hex chars (or 66 with 0x), got ${keyLength} chars`);
}

if (config.risk.riskPercent <= 0 || config.risk.riskPercent > 100) {
  throw new Error('RISK_PERCENT must be between 0 and 100');
}

if (config.risk.leverage < 1 || config.risk.leverage > 100) {
  throw new Error('LEVERAGE must be between 1 and 100');
}

console.log('✅ Configuration loaded successfully');

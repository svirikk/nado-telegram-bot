import { config } from './config.js';

const LOG_LEVELS = {
  error: 0,
  info: 1,
  debug: 2,
};

const currentLevel = LOG_LEVELS[config.logLevel] || LOG_LEVELS.info;

function formatTimestamp() {
  return new Date().toISOString();
}

export const logger = {
  error: (message, data = null) => {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(`[${formatTimestamp()}] ❌ ${message}`, data || '');
    }
  },
  
  info: (message, data = null) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(`[${formatTimestamp()}] ℹ️  ${message}`, data || '');
    }
  },
  
  debug: (message, data = null) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(`[${formatTimestamp()}] 🔍 ${message}`, data || '');
    }
  },
  
  trade: (message, data = null) => {
    // Always log trade executions
    console.log(`[${formatTimestamp()}] 📊 ${message}`, data || '');
  },
};

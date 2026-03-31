/**
 * Simple log level utility.
 *
 * Set level via VITE_LOG_LEVEL env var or by calling logger.setLevel().
 * Levels: debug < info < warn < error < none
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };

let currentLevel = LEVELS.info;

// Try to read from env at module load
try {
    const envLevel = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_LOG_LEVEL) || 'info';
    if (LEVELS[envLevel] !== undefined) currentLevel = LEVELS[envLevel];
} catch { /* ignore */ }

export const logger = {
    setLevel(level) {
        if (LEVELS[level] !== undefined) currentLevel = LEVELS[level];
    },

    debug(...args) {
        if (currentLevel <= LEVELS.debug) console.debug('[DEBUG]', ...args);
    },

    info(...args) {
        if (currentLevel <= LEVELS.info) console.log('[INFO]', ...args);
    },

    warn(...args) {
        if (currentLevel <= LEVELS.warn) console.warn('[WARN]', ...args);
    },

    error(...args) {
        if (currentLevel <= LEVELS.error) console.error('[ERROR]', ...args);
    }
};

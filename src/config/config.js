/**
 * Configuration File
 * API keys and application settings
 *
 * IMPORTANT: For production, use environment variables or a secure backend
 * DO NOT commit real API keys to version control
 */

const getEnvVar = (key) => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            return import.meta.env[key] || null;
        }
        return null;
    } catch {
        return null;
    }
};

export const CONFIG = {
    ai: {
        apiKey: getEnvVar('VITE_GEMINI_API_KEY'),
        model: getEnvVar('VITE_AI_MODEL') || 'gemini-flash-latest'
    },

    features: {
        enableAI: true,
        cacheResponses: true
    }
};

export function isAIConfigured() {
    const hasKey = CONFIG.ai.apiKey && CONFIG.ai.apiKey !== 'YOUR_API_KEY_HERE';
    const enabled = CONFIG.features.enableAI && hasKey;

    if (!hasKey) {
        console.warn('Gemini API key is missing or invalid in config');
    }

    return enabled;
}

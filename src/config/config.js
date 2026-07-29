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

const isPlaceholderApiKey = (value) => {
    if (!value || typeof value !== 'string') return true;
    const normalized = value.trim().toLowerCase();
    return (
        normalized.length === 0 ||
        normalized === 'your_api_key_here' ||
        normalized === 'your-gemini-api-key-here' ||
        normalized.includes('your-api-key')
    );
};

export const CONFIG = {
    ai: {
        apiKey: getEnvVar('VITE_GEMINI_API_KEY'),
        model: getEnvVar('VITE_AI_MODEL') || 'gemini-flash-latest',
        baseUrl: getEnvVar('VITE_AI_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta'
    },

    features: {
        enableAI: true,
        cacheResponses: true
    },

    controls: {
        mouseSensitivity: Number(getEnvVar('VITE_MOUSE_SENSITIVITY')) || 0.002,
        pointerLockEnabled: getEnvVar('VITE_POINTER_LOCK_ENABLED') !== 'false'
    }
};

export function isAIConfigured() {
    const hasKey = !isPlaceholderApiKey(CONFIG.ai.apiKey);
    const enabled = CONFIG.features.enableAI && hasKey;

    if (!hasKey) {
        console.warn('Gemini API key is missing or invalid in config');
    }

    return enabled;
}

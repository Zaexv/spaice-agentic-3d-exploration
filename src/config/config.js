/**
 * Configuration File
 * API keys and application settings
 *
 * IMPORTANT: For production, use environment variables or a secure backend
 * DO NOT commit real API keys to version control
 */

// Safe access to environment variables (handles cases where import.meta.env may be undefined)
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
    // LLM Configuration (Gemini via OpenAI-compatible endpoint)
    openai: {
        apiKey: getEnvVar('VITE_GEMINI_API_KEY'),
        model: getEnvVar('VITE_AI_MODEL') || 'gemini-flash-latest'
    },

    // Feature flags
    features: {
        enableAI: true,
        cacheResponses: true
    },

    // AI Prompt Templates
    prompts: {
        planetDescription: `You are an expert astronomer providing fascinating information about planets.
Given the following planet data, provide an engaging 2-3 sentence description that would interest space enthusiasts:

Planet: {name}
Type: {composition}
Atmosphere: {atmosphere}
Temperature: {surfaceTemp}

Make it educational but captivating.`
    }
};

// Simple flag to check if AI is configured
export function isAIConfigured() {
    const hasKey = CONFIG.openai.apiKey && CONFIG.openai.apiKey !== 'YOUR_API_KEY_HERE';
    const enabled = CONFIG.features.enableAI && hasKey;

    if (!hasKey) {
        console.warn('⚠️ Gemini API key is missing or invalid in config');
    } else if (!CONFIG.features.enableAI) {
        console.log('ℹ️ AI features are disabled in config');
    }

    return enabled;
}

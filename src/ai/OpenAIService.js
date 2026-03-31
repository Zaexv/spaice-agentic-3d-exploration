/**
 * GeminiService - Google Gemini Integration for Planet Descriptions
 * Generates descriptive text about planets using Google Gemini API
 */

import { CONFIG } from '../config/config.js';

class OpenAIService {
  constructor(apiKey) {
    if (!apiKey) {
      console.warn('API key not provided. AI descriptions will be disabled.');
      this.enabled = false;
      return;
    }

    this.apiKey = apiKey;
    this.enabled = true;
    this.model = CONFIG.openai.model;

    this.config = {
      temperature: 0.7,
      maxOutputTokens: 1024
    };

    this.cache = new Map();
    this.initPromise = Promise.resolve();

    console.log(`✅ LLM service initialized (${this.model})`);
  }

  configure(options) {
    this.config = { ...this.config, ...options };
  }

  async _generate(systemInstruction, userText, { temperature, maxOutputTokens } = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    const body = {
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: {
        temperature: temperature ?? this.config.temperature,
        maxOutputTokens: maxOutputTokens ?? this.config.maxOutputTokens
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.error?.message || response.statusText;
      if (response.status === 401 || response.status === 403) throw new Error('Invalid API key. Please check your credentials.');
      if (response.status === 429) return 'I am out of power, give me more AINergy so I can continue talking! ⚡🔋';
      throw new Error(`API error (${response.status}): ${msg}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!content) throw new Error('No content in API response');
    return content;
  }

  async _chat(systemInstruction, messages, { temperature, maxOutputTokens } = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

    // Convert chat history to Gemini format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const body = {
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      contents,
      generationConfig: {
        temperature: temperature ?? this.config.temperature,
        maxOutputTokens: maxOutputTokens ?? this.config.maxOutputTokens
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 429) return 'I am out of power, give me more AINergy so I can continue talking! ⚡🔋';
      throw new Error(`API error (${response.status}): ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!content) throw new Error('No content in API response');
    return content;
  }

  buildPrompt(planetData) {
    const planetInfo = JSON.stringify(planetData, null, 2);

    return `Based on the following planet data, create an engaging and informative description (2-3 paragraphs) that would captivate someone exploring this celestial body in a 3D space visualization.

Planet Data:
${planetInfo}

Write a vivid, scientifically-inspired description that highlights the unique characteristics, atmosphere, and interesting facts about this planet. Make it immersive and educational.`;
  }

  async generatePlanetDescription(planetData, useCache = true) {
    await this.initPromise;

    if (!this.enabled) {
      return this.getFallbackDescription(planetData);
    }

    try {
      const cacheKey = JSON.stringify(planetData);

      if (useCache && this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      const prompt = this.buildPrompt(planetData);

      const description = await this._generate(
        'You are an expert astronomer and science communicator who creates vivid, educational descriptions of celestial bodies.',
        prompt
      );

      this.cache.set(cacheKey, description);
      return description;

    } catch (error) {
      console.error('Error generating planet description:', error);
      return this.getFallbackDescription(planetData);
    }
  }

  async generateCompletion(prompt, useCache = false) {
    const cacheKey = `completion_${prompt}`;

    if (useCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const completion = await this._generate(null, prompt);

    if (useCache) {
      this.cache.set(cacheKey, completion);
    }

    return completion;
  }

  async generateCharacteristicsInsights(planetData, useCache = true) {
    try {
      const cacheKey = `insights_${planetData.pl_name || planetData.name}`;

      if (useCache && this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      const char = planetData.characteristics || {};
      const prompt = `Based on the following planet characteristics, generate 4-5 thought-provoking questions that a scientist or space enthusiast might ask about this planet. Make them specific to this planet's unique features.

Planet: ${planetData.pl_name || planetData.name}
Distance: ${planetData.sy_dist ? (planetData.sy_dist * 3.262).toFixed(2) : 'Unknown'} light-years from Earth

PHYSICAL PROPERTIES:
- Type: ${char.radius_position || 'Unknown'}
- Radius: ${planetData.pl_rade ? planetData.pl_rade.toFixed(2) : 'Unknown'} Earth radii
- Mass: ${planetData.pl_masse ? planetData.pl_masse.toFixed(2) : 'Unknown'} Earth masses
- Temperature: ${planetData.pl_eqt || 'Unknown'} K
- Material Composition: ${char.principal_material || 'Unknown'}

ORBITAL CHARACTERISTICS:
- Orbital Period: ${planetData.pl_orbper ? planetData.pl_orbper.toFixed(2) : 'Unknown'} days
- Semi-major Axis: ${planetData.pl_orbsmax ? planetData.pl_orbsmax.toFixed(3) : 'Unknown'} AU
- Orbit Type: ${char.orbit_type || 'Unknown'}

HABITABILITY:
- Habitability Score: ${char.habitability_percent !== undefined ? char.habitability_percent + '%' : 'Unknown'}
- Toxicity Level: ${char.toxicity_percent !== undefined ? char.toxicity_percent + '%' : 'Unknown'}
- Atmosphere: ${char.atmosphere_type || 'Unknown'}

Generate 4-5 specific questions. Format each on a new line starting with "•". Focus on what makes this planet unique, what we could learn, how it compares to Earth, and what mysteries it presents.`;

      const insights = await this._generate(
        'You are an expert astronomer who generates thoughtful, scientifically relevant questions about exoplanets.',
        prompt,
        { temperature: 0.8, maxOutputTokens: 1024 }
      );

      this.cache.set(cacheKey, insights);
      return insights;

    } catch (error) {
      console.error('Error generating characteristics insights:', error);
      throw error;
    }
  }

  async chatAboutPlanet(userMessage, planetData, chatHistory = []) {
    try {
      const char = planetData.characteristics || {};

      const systemMessage = `You are an astronomer assistant for "${planetData.pl_name || planetData.name}". Answer briefly (1-2 sentences). Data: ${(planetData.sy_dist * 3.262).toFixed(1)}ly away, ${char.radius_position || 'Unknown type'}, ${planetData.pl_rade?.toFixed(1) || '?'}R⊕, ${planetData.pl_eqt || '?'}K, ${char.habitability_percent || 0}% habitable.`;

      // Build messages for multi-turn chat
      const messages = [
        ...chatHistory.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6),
        { role: 'user', content: userMessage }
      ];

      return await this._chat(systemMessage, messages, { maxOutputTokens: 512 });

    } catch (error) {
      console.error('Error in chat:', error);
      throw error;
    }
  }

  getFallbackDescription(planetData) {
    const { name, type, size, temperature, moons, atmosphere } = planetData;

    return `${name} is a ${type || 'mysterious'} planet${size ? ` with a relative size of ${size}` : ''}. ${
      temperature ? `Surface temperatures average around ${temperature}°C. ` : ''
    }${moons ? `It has ${moons} moon${moons > 1 ? 's' : ''}. ` : ''}${
      atmosphere ? `The atmosphere is composed of ${atmosphere}.` : ''
    }`;
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()).map(key => {
        try {
          const data = JSON.parse(key);
          return data.name || 'Unknown';
        } catch {
          return key.substring(0, 30);
        }
      })
    };
  }
}

export { OpenAIService };
export default OpenAIService;

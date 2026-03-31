# AI Services - Gemini Integration

## Overview
The AI Services module provides text generation capabilities using Google Gemini.

## Files
```
src/ai/
└── AIService.js              # Gemini text generation
```

## Usage

```javascript
import AIService from './src/ai/AIService.js';

const ai = new AIService(apiKey);
const description = await ai.generatePlanetDescription(planetData);
```

## Configuration

All AI configuration is centralized in `/src/config/config.js`. Uses `VITE_GEMINI_API_KEY` env var.

## API Key Setup

Add keys to `.env`:
```env
VITE_OPENAI_API_KEY=sk-proj-...
```

## Security Notes

- Never commit API keys to version control
- `.env` is in `.gitignore`
- For production, use a backend proxy instead of `dangerouslyAllowBrowser: true`

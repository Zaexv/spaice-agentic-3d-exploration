# AI Services - OpenAI & ElevenLabs Integration

## Overview
The AI Services module provides two main capabilities:
1. **OpenAI Integration** - Generate descriptive text about planets using GPT models
2. **ElevenLabs Integration** - Convert text descriptions into natural-sounding voice

## Files
```
src/ai/
├── OpenAIService.js          # OpenAI text generation
└── ElevenLabsService.js      # ElevenLabs text-to-speech
```

## Usage

### OpenAIService
```javascript
import OpenAIService from './src/ai/OpenAIService.js';

const openAI = new OpenAIService(apiKey);
const description = await openAI.generatePlanetDescription(planetData);
```

### ElevenLabsService
```javascript
import ElevenLabsService from './src/ai/ElevenLabsService.js';

const elevenLabs = new ElevenLabsService(apiKey);
const audio = await elevenLabs.textToSpeechAndPlay(text);
```

## Configuration

All AI configuration is centralized in `/src/config/config.js`. Services read their defaults (model, voice ID, etc.) from there.

## API Key Setup

Add keys to `.env`:
```env
VITE_OPENAI_API_KEY=sk-proj-...
VITE_ELEVENLABS_API_KEY=sk_...
```

## Security Notes

- Never commit API keys to version control
- `.env` is in `.gitignore`
- For production, use a backend proxy instead of `dangerouslyAllowBrowser: true`

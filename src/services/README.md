# Services

## Overview
Business logic services for the 3D Space Exploration application.

## Files
```
src/services/
├── PlanetDataService.js   # Loads and enriches NASA exoplanet data
└── NarrationService.js    # AI narration (wraps OpenAI + ElevenLabs)
```

## PlanetDataService
Primary data service that loads NASA cluster data, classifies planets, and generates visual properties (colors, atmospheres, rings).

```javascript
import { PlanetDataService } from './src/services/PlanetDataService.js';

const service = new PlanetDataService();
await service.initialize();
const planets = service.getPlanets();
```

## NarrationService
Wraps OpenAIService and ElevenLabsService to provide unified text generation and TTS.

```javascript
import { NarrationService } from './src/services/NarrationService.js';

const narration = new NarrationService(openAIService, elevenLabsService);
const result = await narration.narratePlanet(planetData);
```

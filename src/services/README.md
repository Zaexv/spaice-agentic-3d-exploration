# Services

## Overview
Business logic services for the 3D Space Exploration application.

## Files
```
src/services/
├── PlanetDataService.js      # Data loading orchestrator (clusters, enrichment)
├── PlanetClassifier.js       # Pure functions: type classification by radius/temp
├── PlanetVisualGenerator.js  # Pure functions: colors, atmosphere, rings, solar system overrides
├── CoordinateComputer.js     # Pure function: 3D coords from RA/Dec/Distance
└── NarrationService.js       # AI narration wrapper (OpenAI)
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
Wraps OpenAIService to provide unified text generation.

```javascript
import { NarrationService } from './src/services/NarrationService.js';

const narration = new NarrationService(openAIService, null);
const result = await narration.narratePlanet(planetData);
```

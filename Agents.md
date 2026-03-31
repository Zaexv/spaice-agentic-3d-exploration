# Agents.md - AI Agent Instructions

## Project Overview

SpAIce is an interactive 3D space exploration app built with Three.js, featuring 6,000+ NASA exoplanets and AI-powered narration (OpenAI).

## Quick Reference

```bash
npm run dev              # Start Vite dev server (http://localhost:5173)
npm run build            # Production build (output: dist/)
```

## Architecture

```
main.js                    # App orchestrator (~500 lines) - creates subsystems, animation loop
src/
├── ai/                    # AI services
│   └── OpenAIService.js   #   Text generation (uses CONFIG for model)
├── config/
│   ├── config.js          #   Central config - ALL env vars, API keys, feature flags
│   └── planets.js         #   Static planet definitions
├── controls/
│   ├── InputManager.js    #   Keyboard + mouse + raycasting (extracted from main.js)
│   ├── FlightControls.js  #   Spacecraft flight physics
│   ├── PlanetNavigator.js #   Planet search/teleport UI panel
│   ├── PlanetSelector.js  #   Planet selection logic
│   ├── CameraController.js #  Camera modes
│   └── OrbitControls.js   #   Three.js orbit controls
├── core/
│   ├── Scene.js           #   SceneManager (THREE.Scene wrapper)
│   ├── Camera.js          #   CameraManager (perspective camera)
│   ├── Renderer.js        #   RendererManager (WebGL renderer)
│   └── PostProcessing.js  #   Post-processing effects
├── objects/               # 3D scene objects
│   ├── Planet.js          #   Individual planet mesh + textures
│   ├── Spacecraft.js      #   Player ship with flight model
│   ├── ExoplanetField.js  #   Point cloud for 6000+ exoplanets with LOD
│   ├── StarField.js       #   Background stars
│   ├── GalaxyField.js     #   Galaxy background
│   ├── WarpTunnel.js      #   Warp speed visual effect
│   ├── SpaceDust.js       #   Particle effects near ship
│   ├── SpaceDebris.js     #   Floating asteroid debris
│   ├── Star.js            #   Sun/star object
│   └── Universe.js        #   Universe container
├── services/
│   ├── PlanetDataService.js    # Data loading orchestrator (clusters, enrichment)
│   ├── PlanetClassifier.js     # Pure logic: type classification by radius/temp
│   ├── PlanetVisualGenerator.js # Pure logic: colors, atmosphere, rings
│   ├── CoordinateComputer.js   # Pure logic: 3D coords from RA/Dec/Distance
│   └── NarrationService.js     # AI narration wrapper (OpenAI)
├── ui/
│   ├── HUDManager.js           # HUD updates, UI toggle (extracted from main.js)
│   ├── PlanetExplorationDialog.js # Planet info dialog (1128 lines - needs decomposition)
│   ├── NarratorDialog.js       # AI chat/narration dialog
│   ├── PlanetTargetingSquare.js # Planet targeting overlay
│   └── PartyLoadingScene.js    # Loading screen
├── utils/
│   ├── TeleportController.js   # Teleport + flash + warp sound (extracted from main.js)
│   ├── textureGenerator.js     # Procedural texture generation (worker-based)
│   ├── PlanetTextureGenerator.js # Solar system specific textures
│   ├── LoadingManager.js       # Loading screen progress
│   ├── ProximityDetector.js    # Nearest planet detection
│   ├── PlanetHoverInfo.js      # Hover tooltips
│   ├── WebGLDetector.js        # WebGL capability check
│   ├── logger.js               # Leveled logging (debug/info/warn/error)
│   └── helpers.js              # Misc utilities
├── shaders/
│   └── AtmosphereShader.js     # GLSL atmosphere effect
└── workers/
    └── textureWorker.js        # Web Worker for async texture gen
```

## Key Conventions

### Configuration
- **All configurable values** live in `src/config/config.js` (reads from `VITE_*` env vars)
- Services import from CONFIG, never hardcode API keys, models, URLs, or voice IDs
- `.env.example` documents all available env vars

### Code Patterns
- **ES modules** throughout (`import`/`export`, `"type": "module"` in package.json)
- **Default exports** for AI services (`OpenAIService`)
- **Named exports** for everything else (`{ PlanetDataService }`, `{ InputManager }`)
- **Pure functions** for classification, visuals, coordinates (no class, stateless)
- **Class instances** for stateful managers (InputManager, HUDManager, TeleportController)
- main.js `App` class is a thin orchestrator - don't add business logic there

### Data Flow
```
NASA JSON clusters -> PlanetDataService.loadCluster()
  -> CoordinateComputer.computeCoordinates()
  -> PlanetClassifier.classifyPlanet()
  -> PlanetVisualGenerator.generatePlanetColors/Atmosphere/Rings()
  -> enriched planet objects -> ExoplanetField (rendering)
```

### Scale System
- Scene scale: `1 light-year = 10 scene units`
- Global scale multiplier: `10000x` (all planets rendered in a meshGroup scaled 10000x)
- Solar system planets use `planet.position` field (AU-based, then scaled)
- Exoplanets use `planet.characteristics.coordinates_3d` (light-year-based)

### Build Notes
- Vite bundles for browser; `openai` and `dotenv` are **external** (not bundled)
- OpenAI uses `dangerouslyAllowBrowser: true` (dev only - use backend proxy in prod)
- Large NASA cluster files (>25MB) excluded from build via vite.config.js
- Cloudflare Pages deployment (25MB per-file limit)

## Do NOT

- Add hardcoded API keys, URLs, model names, or voice IDs - use `CONFIG`
- Add methods to main.js App class - extract into appropriate module
- Create test/example files without wiring them into a test framework
- Create docs in `docs/archive/` (deleted - use git history for context)
- Import `PlanetService.js`, `FrontendPlanetService.js`, or `AIService.js` (deleted - use `PlanetDataService` and `OpenAIService`)
- Use raw `console.log` for new code - use `src/utils/logger.js`

## Known Technical Debt

- `PlanetExplorationDialog.js` (1,128 lines) - still a God Object mixing DOM, AI, and audio
- `textureGenerator.js` (869 lines) and `PlanetTextureGenerator.js` (573 lines) share duplicate noise functions - should be consolidated
- 426+ raw `console.log` calls in existing code (not yet migrated to logger)
- No automated tests (`npm test` is a placeholder)
- `window.app` global used for debugging access

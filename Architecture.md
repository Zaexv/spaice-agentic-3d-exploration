# Architecture Documentation

## Overview

A browser-based 3D space exploration application that renders 6000+ real exoplanets using Three.js, with AI-powered planet descriptions (Google Gemini). Pure client-side -- no backend server.

## Technology Stack

| Layer              | Technology                    |
|--------------------|-------------------------------|
| 3D Engine          | Three.js v0.182.0 (WebGL)     |
| Build / Dev        | Vite                          |
| AI Text Generation | Google Gemini API              |
| Module System      | ES6 modules                   |
| Async Processing   | Web Workers                   |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        index.html                               │
│                    main.js (App Orchestrator)                    │
└──────┬──────────────┬──────────────┬──────────────┬─────────────┘
       │              │              │              │
       ▼              ▼              ▼              ▼
┌─────────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────────┐
│  Core Layer │ │ Controls │ │  Objects  │ │    UI Layer     │
├─────────────┤ ├──────────┤ ├───────────┤ ├─────────────────┤
│ Scene       │ │ Input    │ │ Spacecraft│ │ HUDManager      │
│ Camera      │ │ Manager  │ │ Planet    │ │ Exploration     │
│ Renderer    │ │ Flight   │ │ Exoplanet │ │   Dialog        │
│ PostProcess │ │ Controls │ │   Field   │ │ NarratorDialog  │
│             │ │ Planet   │ │ StarField │ │ TargetingSquare │
│             │ │ Navigator│ │ Galaxy    │ │ LoadingScene    │
│             │ │ Camera   │ │ WarpTunnel│ │                 │
│             │ │ Controller│ │ SpaceDust│ │                 │
│             │ │          │ │ Debris   │ │                 │
└─────────────┘ └──────────┘ └───────────┘ └─────────────────┘
       │                          │                │
       │              ┌───────────┘                │
       ▼              ▼                            ▼
┌─────────────────────────────┐    ┌──────────────────────────┐
│       Services Layer        │    │       AI Layer           │
├─────────────────────────────┤    ├──────────────────────────┤
│ PlanetDataService           │    │ OpenAIService (Gemini)   │
│   ├── PlanetClassifier      │    │   └── config.js          │
│   ├── PlanetVisualGenerator │    │                          │
│   └── CoordinateComputer    │    │ NarrationService         │
└─────────────────────────────┘    └──────────────────────────┘
```

---

## Module Structure

```
main.js                           App orchestrator: init, animation loop, wiring
src/
├── ai/
│   └── OpenAIService.js          Gemini text generation (uses CONFIG)
├── config/
│   ├── config.js                 Central config (env vars, API keys, feature flags)
│   └── planets.js                Static planet definitions
├── controls/
│   ├── InputManager.js           Keyboard + mouse + raycasting
│   ├── FlightControls.js         Spacecraft flight physics
│   ├── PlanetNavigator.js        Planet search/teleport UI panel
│   ├── PlanetSelector.js         Planet selection logic
│   ├── CameraController.js       Camera modes
│   └── OrbitControls.js          Three.js orbit controls
├── core/
│   ├── Scene.js                  SceneManager
│   ├── Camera.js                 CameraManager
│   ├── Renderer.js               RendererManager
│   └── PostProcessing.js         Post-processing effects
├── objects/
│   ├── Planet.js                 Individual planet mesh + textures
│   ├── Spacecraft.js             Player ship with flight model
│   ├── ExoplanetField.js         Point cloud for 6000+ exoplanets with LOD
│   ├── StarField.js              Background stars
│   ├── GalaxyField.js            Galaxy background
│   ├── WarpTunnel.js             Warp speed visual effect
│   ├── SpaceDust.js              Particle effects
│   ├── SpaceDebris.js            Asteroid debris
│   ├── Star.js                   Sun/star object
│   └── Universe.js               Universe container
├── services/
│   ├── PlanetDataService.js      Data loading orchestrator
│   ├── PlanetClassifier.js       Pure: type classification by radius/temp
│   ├── PlanetVisualGenerator.js  Pure: colors, atmosphere, rings
│   ├── CoordinateComputer.js     Pure: 3D coords from RA/Dec/Distance
│   └── NarrationService.js       AI narration wrapper
├── ui/
│   ├── HUDManager.js             HUD updates, UI toggle
│   ├── PlanetExplorationDialog.js Planet info dialog with AI chat
│   ├── NarratorDialog.js         AI narration dialog
│   ├── PlanetTargetingSquare.js  Planet targeting overlay
│   └── PartyLoadingScene.js      Loading screen
├── utils/
│   ├── TeleportController.js     Teleport + flash + warp sound
│   ├── textureGenerator.js       Procedural texture generation
│   ├── PlanetTextureGenerator.js Solar system specific textures
│   ├── LoadingManager.js         Loading progress
│   ├── ProximityDetector.js      Nearest planet detection
│   ├── logger.js                 Leveled logging
│   └── helpers.js                Misc utilities
├── shaders/
│   └── AtmosphereShader.js       GLSL atmosphere
└── workers/
    └── textureWorker.js          Web Worker for async textures
```

---

## Data Flow: Exoplanet Pipeline

```
NASA JSON clusters
       │
       ▼
PlanetDataService.loadCluster()
       │
       ▼
CoordinateComputer.computeCoordinates()    ← RA/Dec/Distance → 3D xyz
       │
       ▼
PlanetClassifier.classifyPlanet()          ← radius + temp → type/subtype
       │
       ▼
PlanetVisualGenerator
  ├── generatePlanetColors()               ← type → base/detail colors
  ├── generateAtmosphere()                 ← type → atmosphere config
  └── generateRings()                      ← type → ring config
       │
       ▼
Enriched planet objects
       │
       ▼
ExoplanetField (3D point cloud with LOD)
```

---

## App Initialization Sequence

```
1. Browser loads index.html
       │
2. main.js App constructor
       │
3. Create Core Managers ──────── Scene, Camera, Renderer
       │
4. Create Controls ──────────── InputManager, HUDManager
       │
5. Build Universe
       ├── PlanetDataService.initialize()
       ├── Load solar system + exoplanet clusters
       ├── ExoplanetField.load()
       └── Create Spacecraft
       │
6. Wire subsystems
       ├── PlanetNavigator → TeleportController
       ├── ExplorationDialog → OpenAIService
       ├── InputManager.setDependencies(...)
       └── HUDManager.setupUIControls(...)
       │
7. Start animation loop
       │
   ┌───┴───────────────────────────────┐
   │  Every frame:                     │
   │  1. Spacecraft.steer(keys, mouse) │
   │  2. Spacecraft.update(dt)         │
   │  3. ExoplanetField.update(dt)     │
   │  4. HUDManager.updateHUD()        │
   │  5. Effects (warp, dust, debris)  │
   │  6. Renderer.render(scene, cam)   │
   └───────────────────────────────────┘
```

---

## Scale System

| Domain           | Unit                  | Scale Factor  |
|------------------|-----------------------|---------------|
| Scene units      | 1 light-year          | 10 scene units|
| Global multiplier| All planet positions  | 10,000x       |
| Solar system     | Planetary positions   | AU-based      |
| Exoplanets       | Field coordinates     | Light-year based|

---

## AI Integration

```
User clicks planet ──► PlanetExplorationDialog
                              │
                              ├──► OpenAIService.generatePlanetDescription()
                              ├──► OpenAIService.generateCharacteristicsInsights()
                              └──► OpenAIService.chatAboutPlanet()
                                       │
                                       ▼
                                  Gemini API
                                  (gemini-flash-latest)
                                       │
                                       ▼
                                  config.js
                                  VITE_GEMINI_API_KEY
```

User presses N key ──► NarrationService.generateNarration()
                              │
                              └──► OpenAIService → NarratorDialog (text only)

---

## Design Patterns

| Pattern                     | Where                                              | Purpose                                              |
|-----------------------------|-----------------------------------------------------|------------------------------------------------------|
| **Manager**                 | SceneManager, CameraManager, RendererManager        | Encapsulate Three.js subsystem setup and lifecycle    |
| **Orchestrator**            | App class in main.js                                | Thin top-level wiring; delegates to subsystems        |
| **Pure function extraction**| PlanetClassifier, PlanetVisualGenerator, CoordinateComputer | Stateless transforms, easy to test               |
| **Callback-based DI**       | InputManager callbacks                              | Decouple input detection from action handling         |
| **Configuration**           | config.js, planets.js                               | Centralize all tunables and data definitions          |

---

## Performance Strategies

- **ExoplanetField LOD** -- level-of-detail rendering for 6000+ point cloud
- **Web Worker** (textureWorker.js) -- offloads procedural texture generation off the main thread
- **PostProcessing pipeline** -- selective effects application
- **BufferGeometry** -- efficient GPU memory for star fields and particle systems
- **ProximityDetector** -- spatial queries to avoid per-frame full scans

---

## Security

- API keys stored in `.env` (git-ignored)
- All API calls are client-side fetch -- no secrets on a backend
- Input validation on user chat prompts

---

**Last Updated**: March 2026
**Project**: Hamburg AI Hackathon -- 3D Space Exploration
**Version**: 2.0

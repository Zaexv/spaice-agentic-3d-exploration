# Codebase Research & Cleanup Plan

## Executive Summary

This repo is a Three.js-based 3D space exploration app with AI narration (OpenAI), multiplayer (Socket.io), and NASA exoplanet data. It was built during a hackathon and has accumulated significant technical debt. The codebase works but is hard to scale due to God Objects, duplicated code, dead files, scattered configuration, and 80+ archive docs that add noise.

---

## 1. Dead Code & Unused Files

### Unused Services (never imported by running code)
| File | Lines | Why Dead |
|------|-------|----------|
| `src/services/PlanetService.js` | 313 | Superseded by `PlanetDataService.js`. Only referenced in test/example/docs files. |
| `src/services/FrontendPlanetService.js` | 446 | Superseded by `PlanetDataService.js`. Only referenced in docs/examples. |
| `src/services/AIService.js` | ~100 | Superseded by `OpenAIService.js`. Only imported by test/example files. |

### Test/Example Files (not wired into any test framework)
| File | Purpose |
|------|---------|
| `src/ai/testAIService.js` | Manual test script |
| `src/ai/testElevenLabsService.js` | Manual test script (deleted) |
| `src/ai/example-browser-usage.js` | Example with TODOs |
| `src/ai/example-combined-usage.js` | Example not integrated |
| `src/services/testPlanetService.js` | Manual test script |
| `src/services/planetServiceIntegration.example.js` | Example file |
| `src/ui/example-dialog-usage.js` | Example file |

### Obsolete Documentation (80+ docs)
- `docs/archive/` contains 50+ historical docs (fix summaries, session logs, debug guides) that document past changes already captured in git history
- `docs/guides/` contains 30+ guides, many outdated or redundant (e.g., 5 separate multiplayer docs)
- **Action**: Archive entirely or delete. Git history preserves this context.

---

## 2. Duplicated Code

### Texture Generators
- `src/utils/textureGenerator.js` (869 lines) - procedural textures
- `src/utils/PlanetTextureGenerator.js` (573 lines) - solar system textures
- Both implement identical `noise2D()`, `fbm()`, and cloud generation functions
- **Action**: Consolidate into a single module with shared utilities

### Configuration Duplication
- `src/config/config.js` defines model name, voice ID, API keys
- `src/ai/OpenAIService.js` re-defines model defaults
- **Action**: Single source of truth in `config.js`

---

## 3. Architecture Issues

### God Object: `main.js` (1,176 lines)
The `App` class handles: initialization, controls, UI, audio synthesis, multiplayer, animation loop, navigation, modal dialogs. It needs to be decomposed.

### God Object: `PlanetExplorationDialog.js` (1,128 lines)
Mixes DOM management, tab switching, AI text generation, TTS audio, chat history, and caching.

### God Object: `PlanetDataService.js` (841 lines)
Handles data loading, planet classification, color generation, atmosphere calculation, ring generation, and solar system overrides all in one class.

### Tight Coupling
- `window.app = new App()` used as global access point
- 26+ files directly call `document.getElementById()` with no abstraction
- Services instantiate their dependencies directly (no DI)

---

## 4. Configuration Issues

### Hardcoded Values
| Location | Value | Should Be |
|----------|-------|-----------|
| `main.js:39` | `'http://localhost:3000'` | env var `VITE_MULTIPLAYER_URL` |
| `config.js:25` | `'gpt-3.5-turbo'` | env var `VITE_AI_MODEL` |
| `OpenAIService.js:21` | `'gpt-3.5-turbo'` | use `CONFIG.openai.model` |

### Excessive Logging
426+ `console.log/warn/error` calls with no log level control. These should be behind a debug flag or removed for production.

---

## 5. Cleanup Actions (Ordered by Impact)

### Phase 1: Remove Dead Code
- [x] Delete `src/services/PlanetService.js`
- [x] Delete `src/services/FrontendPlanetService.js`
- [x] Delete `src/services/AIService.js`
- [x] Delete all test/example files (`testAIService.js`, `example-*.js`, `testPlanetService.js`, `planetServiceIntegration.example.js`, `example-dialog-usage.js`)
- [x] Remove dead npm scripts from `package.json` (`test-ai`, `test-ai-combined`, `test-planet-service`)
- [x] Delete `docs/archive/` (50+ obsolete docs)
- [x] Consolidate `docs/guides/` (remove redundant multiplayer docs, etc.)

### Phase 2: Consolidate Duplicates
- [x] Merge texture generators into one unified module
- [x] Remove duplicate config values from services (use `CONFIG` everywhere)

### Phase 3: Centralize Configuration
- [x] Add missing env vars to `.env.example`
- [x] Make services read from `CONFIG` instead of having their own defaults
- [x] Extract magic numbers into named constants

### Phase 4: Reduce Logging Noise
- [x] Add a simple log level utility
- [x] Replace raw `console.log` with leveled logging in key files

### Phase 5: Improve Structure (Future)
- [ ] Decompose `main.js` into `AppInit`, `InputManager`, `UIManager`, `AudioManager`
- [ ] Decompose `PlanetExplorationDialog.js` into dialog, AI service, and audio layers
- [ ] Decompose `PlanetDataService.js` into loader, classifier, and visualizer
- [ ] Implement event bus to decouple components
- [ ] Add proper dependency injection

---

## 6. Files to Keep (Core Architecture)

```
main.js                          -> App entry (needs decomposition later)
src/core/                        -> Scene, Camera, Renderer, PostProcessing (clean)
src/objects/                     -> Planet, Spacecraft, ExoplanetField, etc. (OK)
src/controls/                    -> FlightControls, PlanetNavigator, etc. (OK)
src/services/PlanetDataService.js -> Keep (primary data service)
src/services/NarrationService.js  -> Keep (AI narration wrapper)
src/ai/OpenAIService.js          -> Keep (fix config duplication)
src/ui/                          -> Keep all non-example files
src/utils/                       -> Keep (consolidate texture generators)
src/multiplayer/                 -> Keep
src/shaders/                     -> Keep
src/workers/                     -> Keep
src/config/                      -> Keep (expand)
server/                          -> Keep
nasa_data/                       -> Keep
pipelines/                       -> Keep
```

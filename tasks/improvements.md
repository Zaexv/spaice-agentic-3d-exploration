# SpAIce Improvement Tasks

> Based on code analysis of the current implementation.  
> Files referenced follow the architecture defined in `Agents.md`.

---

## 1. Camera Improvements

**Relevant files:** `src/controls/CameraController.js`, `src/controls/FlightControls.js`, `src/controls/OrbitControls.js`, `src/controls/PlanetNavigator.js`

### 1.1 Fix `slowMode` key-up event never triggering
- **File:** `src/controls/FlightControls.js` (line 154)
- The `Shift` key-up case falls through with unreachable code — `this.keys.slowMode = false` is placed after a `break` in the `Space` block. Fix the missing `case 'ShiftLeft': case 'ShiftRight':` in `onKeyUp`.

### 1.2 Remove duplicate `boost` property in `getControlInputs()` return object
- **File:** `src/controls/FlightControls.js` (line 260–261)
- `boost` is returned twice in the same object literal, causing the second to silently override the first. Remove the duplicate.

### 1.3 Add missing camera modes
- **File:** `src/controls/CameraController.js`
- Only `travelToPlanet()` and `returnToOverview()` exist. Add:
  - **Chase / follow mode** — camera trails behind the spacecraft at a configurable offset, using smooth damping (`THREE.Vector3.lerp`).
  - **Orbit mode** — camera orbits a selected planet at a fixed distance (separate from orbit controls).
  - **Cockpit / first-person mode** — camera is parented to the spacecraft mesh with no offset.

### 1.4 Improve `travelToPlanet()` camera offset logic
- **File:** `src/controls/CameraController.js` (lines 35–39)
- The offset uses a fixed `(0.8, 0.4, 0.8)` multiplier regardless of planet size or viewing angle. Compute a smarter offset that:
  - Preserves the current camera bearing relative to the planet.
  - Scales the approach distance inversely with planet radius to avoid clipping.

### 1.5 Add `isAnimating` guard to `returnToOverview()`
- **File:** `src/controls/CameraController.js` (line 77)
- Guard already exists but no `onComplete` callback resets `isAnimating` in the `controls.target` tween — only the position tween resets it. Ensure both tweens share a single completion callback.

### 1.6 Remove raw `console.log` calls and migrate to logger
- **Files:** `src/controls/FlightControls.js` (lines 56, 75, 205, 207)
- Replace all `console.log` / `console.error` in controls with `src/utils/logger.js` (`logger.info`, `logger.debug`).

### 1.7 Expose mouse sensitivity and pointer-lock toggle as configurable options
- **File:** `src/controls/FlightControls.js`
- `mouseSensitivity = 0.002` is hardcoded. Pull this value from `src/config/config.js` so it can be set via environment variable or UI slider.

### 1.8 Add `pitch` axis support through keyboard input
- **File:** `src/controls/FlightControls.js`
- Pitch is currently mouse-only. Add `I` / `K` (or `ArrowUp` / `ArrowDown` in free-look) as keyboard pitch keys for accessibility.

---

## 2. Texture Improvements

**Relevant files:** `src/utils/textureGenerator.js`, `src/utils/PlanetTextureGenerator.js`, `src/workers/textureWorker.js`, `src/objects/Planet.js`, `src/objects/ExoplanetField.js`, `src/shaders/AtmosphereShader.js`

### 2.1 Consolidate duplicate `noise2D` / `fbm` functions
- **Files:** `src/utils/textureGenerator.js` (lines 287–309), `src/utils/PlanetTextureGenerator.js` (lines 9–51)
- Both files implement identical `noise2D` and `fbm` functions. Extract them into a shared `src/utils/noiseUtils.js` module and import from there. This eliminates the known technical debt mentioned in `Agents.md`.

### 2.2 Move synchronous texture generators to Web Worker
- **File:** `src/utils/textureGenerator.js` (lines 314–498)
- `generateRockyTexture`, `generateGasGiantTexture`, `generateIceGiantTexture`, `generateNormalMap` block the main thread when called synchronously. Route them through `runWorkerTask()` the same way the `Async` variants do, or replace all remaining sync call-sites with the `Async` equivalents in `Planet.js`.

### 2.3 Add texture resolution control to `Planet.js` for exoplanets
- **File:** `src/objects/Planet.js` (lines 159–178)
- Exoplanets always generate at `512px`. Add a `textureResolution` config field (default `512`) so that nearby or highlighted exoplanets can request `1024px`.

### 2.4 Add specular / roughness maps for all rocky exoplanets
- **Files:** `src/objects/Planet.js`, `src/objects/ExoplanetField.js`
- Only Earth receives a `specularMap` / `metalnessMap`. Extend the procedural pipeline to generate a basic roughness map (high for land/rock, low for ice/water) for rocky exoplanets using the same fbm noise used for the base texture.

### 2.5 Fix `Earth` texture loading fallback in `ExoplanetField`
- **File:** `src/objects/ExoplanetField.js` (line 228)
- The Mars `normalMap` line assigns the result of `generateNormalMapAsync(...).then(...)` (a `Promise`) directly to `normalMap`. This is never applied to the material. Refactor the solar system texture loading block to use `async/await` or handle the promise correctly.

### 2.6 Use `PlanetTextureGenerator` procedural textures as fallback when image files are missing
- **Files:** `src/objects/Planet.js` (lines 95–156), `src/objects/ExoplanetField.js` (lines 214–266)
- Current code calls `TextureLoader.load()` without an `onError` callback. If a texture file is missing (e.g. build without assets), the planet renders black/grey. Add `onError` fallbacks that call the corresponding `PlanetTextureGenerator` function.

### 2.7 Add emission map for lava-world / hot-Jupiter exoplanets
- **File:** `src/objects/ExoplanetField.js` (lines 198–202)
- The `emissive` colour is set but no `emissiveMap` is generated for lava worlds. Generate a procedural lava flow textures (based on existing FBM noise) and assign it as `emissiveMap` to make these planets glow convincingly.

### 2.8 Add `roughnessMap` generation to `generateNormalMapAsync` worker path
- **File:** `src/workers/textureWorker.js`
- The worker only implements `rocky`, `gas`, `ice`, and `normal` task types. Add a `roughness` task type that takes a base noise seed and outputs a grayscale map usable as `roughnessMap`.

### 2.9 Optimize texture cache key for async generators
- **File:** `src/utils/textureGenerator.js` (line 61)
- `getCacheKey` uses `JSON.stringify(params)` which is slow for large param objects. Replace with a deterministic hash or template-literal key that only includes the significant fields (color hex ints + size).

### 2.10 Add `MipMap` generation for procedural `DataTexture` instances
- **File:** `src/utils/textureGenerator.js` (lines 27–36)
- `DataTexture` returned from the worker does not set `generateMipmaps = true` and `minFilter`. Set `texture.generateMipmaps = true` and `texture.minFilter = THREE.LinearMipmapLinearFilter` for smoother appearance at distance.

### 2.11 Upgrade cloud texture for non-Earth habitable exoplanets
- **File:** `src/objects/Planet.js` (lines 296–315)  
- Non-Earth planets with clouds fall back to `generateCloudTexture()` but do not customise cloud colour based on atmosphere composition. Pass the `atmosphereConfig.color` into `generateCloudTexture` so cloud colour matches atmospheric chemistry.

---

## 3. Planet Position

**Relevant files:** `src/services/CoordinateComputer.js`, `src/services/PlanetDataService.js`, `src/objects/ExoplanetField.js`, `src/config/planets.js`

### 3.1 Document and validate the two-coordinate-system ambiguity in `CoordinateComputer`
- **File:** `src/services/CoordinateComputer.js` (lines 19–52)
- The function silently switches between direct `position.*` values and RA/Dec computed values based on a heuristic `maxPos < 50 && distLightYears > 1`. This logic is fragile and undocumented. Add JSDoc explaining the decision tree and add a `logger.warn` when the heuristic overrides the stored position field.

### 3.2 Centralise coordinate computation — avoid re-computing in `ExoplanetField`
- **File:** `src/objects/ExoplanetField.js` (lines 148–152)
- Distance is re-computed from raw coordinates inside `create3DMeshes` rather than using the `distance_to_earth_ly` already stored by `CoordinateComputer`. Use the enriched field and remove the inline Pythagoras.

### 3.3 Fix solar system planets that fall back to `position.x * 200`
- **File:** `src/config/planets.js` (lines 44–46)
- The `* 200` magic multiplier for solar planets without `coordinates_3d` is arbitrary and undocumented. Replace with the same `sceneScale * AU_to_lightYears` conversion used everywhere else, or ensure `CoordinateComputer` populates `coordinates_3d` for all solar planets before this runs.

### 3.4 Add runtime validation for exoplanets with missing or zero coordinates
- **File:** `src/objects/ExoplanetField.js` (lines 143–146)
- Only a `console.warn` is emitted when `coordinates_3d` is missing. Add a counter that surfaces into the HUD or logs a summary at the end of cluster loading (e.g. "42 planets skipped due to missing coordinates").

### 3.5 Prevent z-fighting between overlapping exoplanets at identical coordinates
- **File:** `src/objects/ExoplanetField.js`
- Multi-planet star systems (same RA/Dec/Dist host star) render all planets at the exact same 3D position. Apply a small deterministic radial jitter (seeded from planet name hash) so planets in the same system are spread around their star rather than stacked.

### 3.6 Add a coordinate system sanity check during data loading
- **File:** `src/services/PlanetDataService.js`
- After all clusters load, verify that the distribution of `x_light_years`, `y_light_years`, `z_light_years` values is reasonable (e.g. no planet has a coordinate with `|value| > 10000 ly` or `= NaN`). Log a warning for outliers.

### 3.7 Expose scale constants in `config.js` rather than hardcoding them
- **Files:** `src/objects/ExoplanetField.js` (lines 27–28), `src/config/planets.js` (lines 20–21)
- `sceneScale = 10` and `earthRadiusScale = 0.5` are duplicated in at least two files. Move them to `src/config/config.js` as `CONFIG.SCENE_SCALE` and `CONFIG.EARTH_RADIUS_SCALE` and import from there in all places.

### 3.8 Support proper multi-planet system layout (orbit radius from semi-major axis)
- **File:** `src/services/CoordinateComputer.js`, `src/objects/ExoplanetField.js`
- For planets sharing the same host star, use the planet's orbital period (`pl_orbper`) or semi-major axis (`pl_orbsmax`) to place them at authentic distances from the star rather than stacking them.  Requires adding a second pass in `PlanetDataService` to group planets by `hostname` and compute relative offsets.

---

## 4. Ads

> **⚠️ Important compatibility note:** Unity Ads (Unity LevelPlay) has **no official web/browser SDK**. It is native-mobile only (iOS & Android). SpAIce is a browser-based Vite/Three.js app, so a direct Unity Ads integration is not possible. The strategy below is to use **Unity Ads on a future native wrapper** (e.g. Capacitor/Cordova) and a **web-compatible ad SDK** (e.g. AdinPlay or AppLixir) for the browser build. Both paths must coexist, gated by a feature flag in `src/config/config.js`.

**Relevant files (new and existing):** `src/config/config.js`, `src/ui/HUDManager.js`, `src/ui/PlanetExplorationDialog.js`, `main.js`  
**New files to create:** `src/services/AdService.js`, `src/ui/AdOverlay.js`

---

### 4.1 Research & decide on the web ad provider
- **Prerequisite — no implementation yet.**
- Unity Ads does **not** support HTML5 / browser environments. Evaluate and select one of:
  - **AdinPlay** (`adinplay.com`) — browser-game focused, supports rewarded video + display banners via a lightweight JS SDK.
  - **AppLixir** — purpose-built for HTML5 rewarded video; easy drop-in script tag.
  - **Google AdSense for Games** — available as a JS snippet but with fewer rewarded-video options.
- Once selected, register the game, obtain a **Publisher ID / Game ID**, and store it in `.env` and `.env.example` as `VITE_AD_GAME_ID`.
- For the **native-wrapper path** (Capacitor): Unity Ads SDK for iOS/Android remains the intended integration. Document this as a future milestone in this task.

### 4.2 Add ad configuration to `src/config/config.js`
- **File:** `src/config/config.js`
- Add the following new config fields (all read from `VITE_*` env vars):
  ```js
  ADS_ENABLED: import.meta.env.VITE_ADS_ENABLED === 'true',
  AD_PROVIDER: import.meta.env.VITE_AD_PROVIDER || 'adinplay',  // 'adinplay' | 'applixir' | 'none'
  AD_GAME_ID: import.meta.env.VITE_AD_GAME_ID || '',
  AD_REWARDED_AFTER_TELEPORTS: Number(import.meta.env.VITE_AD_REWARDED_AFTER_TELEPORTS) || 5,
  ```
- Add all new keys to `.env.example` with comments explaining each.

### 4.3 Create `src/services/AdService.js`
- **New file:** `src/services/AdService.js`
- Responsible for the full ad lifecycle: SDK initialisation, ad loading, showing, and reward callbacks.
- Shape (ES module, named export):
  ```js
  export class AdService {
      constructor(config) { ... }        // reads CONFIG.AD_PROVIDER, AD_GAME_ID etc.
      async init() { ... }              // injects provider SDK <script> tag dynamically
      async loadRewardedAd() { ... }    // preloads next rewarded ad in background
      async showRewardedAd(onRewarded) { ... }  // shows ad, calls onRewarded() on completion
      showInterstitial() { ... }        // fire-and-forget interstitial (banner/mid-game break)
      isAdReady() { ... }               // returns bool - used by HUD to show/hide "watch ad" button
  }
  ```
- If `CONFIG.ADS_ENABLED` is `false`, all methods are no-ops (no SDK injected, no network calls).
- Use `src/utils/logger.js` for all logging — no raw `console.log`.
- Export a singleton instance: `export const adService = new AdService(CONFIG);`

### 4.4 Integrate AdinPlay (or AppLixir) SDK loading
- **File:** `src/services/AdService.js` — `init()` method
- Dynamically inject the provider SDK `<script>` tag into `<head>` only when `CONFIG.ADS_ENABLED` is `true` and `CONFIG.AD_PROVIDER` matches.
- AdinPlay example:
  ```js
  // AdinPlay SDK snippet
  window.adinplay_config = { gameId: CONFIG.AD_GAME_ID };
  const script = document.createElement('script');
  script.src = 'https://api.adinplay.com/libs/aiptag/pub/<PUBLISHER_ID>/www.spaice.app/tag.min.js';
  script.async = true;
  document.head.appendChild(script);
  ```
- Abstract behind the provider switch so AppLixir or another network can be swapped in by changing `VITE_AD_PROVIDER` with zero code changes.

### 4.5 Create `src/ui/AdOverlay.js` — rewarded ad overlay UI
- **New file:** `src/ui/AdOverlay.js`
- A minimal, non-intrusive overlay that:
  - Shows a "Watch a short ad to unlock this feature" modal with a **Watch Ad** button and a **No thanks** close button.
  - Calls `adService.showRewardedAd(onRewarded)` on click.
  - Displays a loading spinner while the ad is buffering (use `adService.isAdReady()` to poll).
  - Disappears automatically once the ad completes or is dismissed.
- Style consistently with the existing dark-glass UI in `ui-style.css` — do not introduce new CSS frameworks.
- Named export: `export class AdOverlay { show(onRewarded) {...} hide() {...} }`

### 4.6 Define rewarded ad trigger points
- Decide where ads are shown to the player. Proposed trigger points, each implemented in the relevant file:

  | Trigger | File | Reward |
  |---|---|---|
  | Every N teleports (configurable) | `src/utils/TeleportController.js` | No mechanic change — UX gate |
  | Unlocking full AI narration for a planet | `src/ui/PlanetExplorationDialog.js` | One AI narration playback |
  | Accessing the "detailed science data" panel | `src/ui/PlanetExplorationDialog.js` | Expanded data tab |
  | Resuming from a long idle session | `main.js` (visibility change event) | None — standard interstitial |

- Add a `teleportCount` counter to `TeleportController.js` and call `adOverlay.show()` when `teleportCount % CONFIG.AD_REWARDED_AFTER_TELEPORTS === 0`.

### 4.7 Add "Watch Ad" button to HUD
- **File:** `src/ui/HUDManager.js`
- Add an optional pill-shaped **"Watch Ad 🎬"** button to the HUD bottom bar, visible only when `CONFIG.ADS_ENABLED && adService.isAdReady()`.
- Clicking it shows the `AdOverlay` with a generic reward (e.g. a temporary speed boost or planet highlight toggle).
- The button should pulse subtly with a CSS animation to draw attention without being disruptive.

### 4.8 Implement interstitial ads between scene loads
- **File:** `main.js` or `src/utils/LoadingManager.js`
- Show a brief interstitial ad during the initial data loading screen (`PartyLoadingScene`) — after the loading bar reaches 100% but before the scene becomes interactive.
- Gate this behind `CONFIG.ADS_ENABLED` and only fire if the session is longer than a minimum threshold (e.g., first load only, tracked in `sessionStorage`).

### 4.9 Add ad-free / premium mode support
- **File:** `src/config/config.js`, `src/services/AdService.js`
- Add `VITE_AD_FREE_MODE` env var. When `true`, `AdService` skips all ad logic entirely.
- This allows the app to be deployed in two configurations:
  - **Public / free tier** — ads enabled.
  - **Premium / self-hosted** — no ads, set `VITE_AD_FREE_MODE=true`.

### 4.10 Privacy & consent — GDPR / CCPA compliance
- **New file:** `src/ui/ConsentBanner.js`
- Before initialising `AdService.init()`, check `localStorage` for a stored consent decision.
- If no decision exists, show a minimal cookie/consent banner:
  - "SpAIce uses ads to stay free. [Accept] [Decline]"
  - On **Accept**: store `spaice_ad_consent=granted` in `localStorage` and call `adService.init()`.
  - On **Decline**: set `CONFIG.ADS_ENABLED = false` for the session, show no ads, no SDK loaded.
- Required by GDPR for EU users and CCPA for California users. Many ad networks (AdinPlay, Google) will withhold personalised ads anyway without consent signals.

### 4.11 Future: Unity Ads native wrapper path (mobile)
- **Advisory — no code in the web build.**
- If SpAIce is later wrapped with **Capacitor** or **Cordova** for an iOS/Android app:
  - Integrate the **Unity Ads SDK for iOS / Android** via the respective Capacitor plugin.
  - The `AdService.js` interface (`.showRewardedAd()`, `.isAdReady()`) should be extended with a native bridge adapter so the trigger logic (`TeleportController`, `PlanetExplorationDialog`) remains unchanged.
  - Store the Unity Ads **Game ID** as `VITE_AD_UNITY_GAME_ID` and the **Placement ID** (rewarded / interstitial) as separate env vars.

---

*Last updated: 2026-03-31*

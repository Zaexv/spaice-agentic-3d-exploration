---
date: 2026-07-29T21:11:48+00:00
git_commit: c8f5ad646e3c3306e7a17c2f8304779cbe927747
branch: fix-planets
topic: "SpAIce visual improvement plan (post-processing, lighting, planet fidelity, instancing/LOD, perf, pipeline)"
tags: [plan, rendering, shaders, performance, lighting, planets, universe]
status: draft
---

# SpAIce Visual Improvement Plan

## Overview

SpAIce currently renders planets with no dominant light source (ambient, a fixed directional light, an infinite-range camera headlamp, and the Sun's own infinite-range point light are all comparable magnitude), no working post-processing (composer is built but never called from the render loop; bloom is hardcoded to strength `0.0`), no per-planet atmosphere variation (fixed shader constants for every atmospheric planet), no mesh instancing for its 6,000+ exoplanets, no adaptive quality/shader-warmup, and several confirmed-dead visual files left in the tree. This plan implements the fixes identified in `docs/agents/research/2026-07-29-visual-improvement-plan.md`, ordered so that foundational renderer/lighting work lands first (later phases depend on it) and confirmed-dead code is removed once instead of dragged through every phase.

## Current State Analysis

Full detail is in the research doc; the load-bearing constraint repeated here because every phase must respect it: SpAIce uses `logarithmicDepthBuffer: true` (`src/core/Renderer.js:35`) so one camera can resolve a 3-scene-unit Sun and an 8.48-million-scene-unit exoplanet in the same frustum. Shadows, bloom, and the post-processing composer were all disabled specifically because they conflicted with this setting (per in-code comments) — every phase below that touches rendering must be verified against this scale range, not just at "normal" distances.

Key facts this plan builds on (see research doc for full file:line detail):
- `src/core/Renderer.js:71-76` — `render()` calls `renderer.render(scene, camera)` directly; `PostProcessingManager` (`src/core/PostProcessing.js`) is built via `initPostProcessing()` but that method is never called anywhere, and even if it were, `render()` still bypasses `this.composer`.
- `src/core/Scene.js:22-28`, `src/core/Camera.js:28-31`, `src/objects/SolarSystemField.js:230-233` — three/four comparable-magnitude, non-decaying light sources with no key/fill hierarchy.
- `src/shaders/AtmosphereShader.js:8-16` — `sunDirection` uniform defaults to `(1,0,0)` and is never set elsewhere in `Planet.js` or `SolarSystemField.js` (confirmed by grep in the research doc).
- `src/objects/ExoplanetField.js:195-345` — three shared geometries `.clone()`d per planet (no `THREE.InstancedMesh` anywhere in the repo).
- `src/config/SceneConstants.js:52-57` — only 2 LOD distance breakpoints for the whole exoplanet field.
- `src/services/PlanetClassifier.js:47-50` (`getScaledRadius`) vs. `src/config/SceneConstants.js:39-45` (`EARTH_RADIUS_SCALE`/`MAX_PLANET_RADIUS`) — two divergent, un-reconciled radius scales; `PlanetDataService.enrichPlanetData()` (`src/services/PlanetDataService.js:47-92`) calls `getScaledRadius()` and stores it as `planet.radius`, but `ExoplanetField.create3DMeshes()` (`ExoplanetField.js:230-232`) ignores `planet.radius` entirely and recomputes render radius directly from `pl_rade * EARTH_RADIUS_SCALE`. So `planet.radius` is currently dead data on exoplanets — only `SceneConstants`' scale is live.
- Confirmed dead files (never imported): `src/objects/WarpTunnel.js`, `SpaceDust.js`, `SpaceDebris.js`, `GalaxyField.js`, `StarField.js`, `DynamicStarField.js`, `Star.js`.
- **Deviation found during implementation**: `src/objects/Planet.js` is ALSO confirmed dead code (never imported anywhere — verified by grep during Phase 2), which the original research doc missed. All "Planet.js" changes in Phase 2/3 below were redirected to `src/objects/ExoplanetField.js` (the real Tier-1 exoplanet mesh-building code path) instead, since that's what actually renders on screen. `Planet.js` was left alone (not added to the Phase 4 deletion list, since that phase's scope was fixed by an explicit user decision before implementation started — worth revisiting in a future cleanup pass).
- No test suite or linter configured (`package.json` — `"test": "echo ... && exit 1"`); `npm run build` (Vite) is the only automated verification available across every phase.

## Desired End State

- Planets are lit by one dominant, distance-attenuated key light per system (Sun, or a pooled proxy light for exoplanet host stars) with subdued ambient/hemisphere-style fill and a separate subtle rim light — producing a visible day/night terminator on rotating planets instead of flat, uniform lighting.
- `AtmosphereShader`'s `sunDirection` uniform is updated every frame from the real vector to each planet's star, and atmosphere/cloud parameters vary per-planet based on `characteristics` instead of fixed constants.
- The post-processing composer actually renders every frame, with selective bloom (via `THREE.Layers`) on emissive/star objects only, plus SMAA, without reintroducing the original "stars bleed through planets" bug.
- The Sun (and, later, bright host stars) reads as a proper glowing body via a cheap additive flare-sprite system instead of a soft fresnel blob.
- The 6,000+ exoplanet field uses `THREE.InstancedMesh` for its medium/far tiers and a 3-tier distance LOD, cutting draw calls substantially while preserving the existing progressive-loading behavior.
- Confirmed-dead visual files are removed from the repo.
- Pixel ratio adapts to measured frame time instead of a fixed cap; a shader-warmup pass runs during the existing loading screen; the texture-generator cache key no longer uses `JSON.stringify`.
- The two divergent radius-scaling schemes are reconciled to one authoritative function; client-side-generated visual attributes are baked into cluster JSON at pipeline-build time instead of recomputed every session; the dead `_solarMode` flag is removed.

Verification for the whole plan is manual/visual (run `npm run dev`, fly to several planets of different types, at both solar-system and interstellar scale) since there is no automated visual regression tooling in this repo — each phase below calls out exactly what to look at.

### Key Discoveries:
- `src/objects/SolarSystemField.js:230-233` — Sun's `PointLight(0xffffee, 5, 0, 0)` has `decay:0` explicitly, meaning it never falls off no matter how the `distance` argument is read; this is the single biggest contributor to "flat" planet lighting in the solar system.
- `src/objects/Camera.js:28-31` (actually `src/core/Camera.js`) — the camera-parented `PointLight(white, 1.0, distance:0)` illuminates whatever the player is looking at regardless of true sun direction, effectively double-lighting every scene.
- `src/objects/ExoplanetField.js:670-731` (`upgradeToHighResTexture`) already has an async, non-blocking texture-swap pattern — the instancing work in Phase 5 must preserve this async upgrade path for at least the near (Tier 1) individual-mesh planets, since instancing only targets Tier 2/3.
- `src/objects/ExoplanetField.js:250-341` already caches one `MeshStandardMaterial` per unique color for Tier 3 (`distantMaterials` Map) — this cache is the natural seam to convert into per-(tier × color-bucket) `InstancedMesh` groups in Phase 5.

## What We're NOT Doing

- Not implementing real shadow mapping — ruled out by the log-depth buffer / astronomical scale, per existing code comments; this plan does not revisit that decision.
- Not attempting GPU occlusion-query-based lens flares — Phase 2's flare system is CPU dot-product/unproject only, matching World of Promptcraft's approach, specifically to avoid `gl.readPixels()` stalls.
- Not rehabilitating `GalaxyField.js` or any of the other confirmed-dead visual files — per decision, delete only, no reintroduction in this plan.
- Not migrating the Python data pipeline (`pipelines/build_universe.py`) to a different framework or data source — Phase 7 only adds a bake-time visual-attribute step to its existing output, it does not change the NASA data ingestion itself.
- Not adding a day/night cycle, moving sun, or time-of-day system — the Sun's position is fixed at the origin (already correct for a heliocentric frame); "live sun direction" in Phase 2 means computing the vector from a *given* planet to the (already fixed) star each frame, not animating the star's position.
- Not writing automated visual-regression tests — no such tooling exists in this repo (no Playwright/screenshot harness); all visual verification is manual per phase.
- Not touching `src/controls/FlightControls.js`/`CameraController.js` bugs from `tasks/camera-fixes.md` — out of scope, tracked separately.

## Implementation Approach

Phases are ordered so foundational, high-leverage changes land first and later phases can build on them without rework:

1. **Renderer & post-processing foundation** first, because Phase 2's flare sprites and Phase 3's atmosphere glow both render additively and need the composer/layer setup to be correct before they're tuned.
2. **Illumination model overhaul** second (not last, despite being "Workstream 7" in the research doc) — it's flagged as highest leverage-per-effort, and Phase 3 (atmosphere/terminator per-planet) directly depends on a live `sunDirection` existing first.
3. **Planet surface & atmosphere fidelity** third, consuming the live sun direction from Phase 2.
4. **Dead code removal** as its own short phase — mechanical, no dependencies, done once rather than repeatedly checking "is this file still imported" during other phases.
5. **Exoplanet instancing & LOD expansion** fifth — independent of lighting/atmosphere work, but benefits from Phase 4's cleanup (one less set of files to worry about disturbing).
6. **Adaptive quality & frame-budget perf** sixth — shader warmup in this phase should warm up the *final* material shapes from Phases 2/3/5, so it must come after them.
7. **Universe/data pipeline cleanup** last — the radius-scale reconciliation and pipeline-bake changes are independent of rendering, but reconciling radius scales before Phase 5's instancing bucketing would have caused rework; doing it after means Phase 5's tier/bucket logic doesn't need a second pass.

## Architecture and Code Reuse

- Reuse `src/shaders/AtmosphereShader.js`'s existing `createAtmosphere`/`createCloudLayer`/`updateAtmosphere` functions — Phase 3 extends their uniforms and call sites, it does not replace the module.
- Reuse `ExoplanetField.js`'s existing `distantMaterials` Map pattern (material-per-color-bucket) as the basis for Phase 5's instanced-mesh-per-bucket approach — same bucketing key, different container (`InstancedMesh` instead of per-mesh material sharing).
- Reuse the existing incremental/idle-callback batching pattern already used in `ExoplanetField.create3DMeshes()` (`requestIdleCallback`/`setTimeout` batches of 30) and `loadClustersProgressively()` (500ms between clusters) for any new per-frame or per-load work introduced (e.g. Phase 2's host-star light pool reassignment, Phase 6's shader warmup) — don't introduce a second competing batching mechanism.
- New files to add:
  - `src/utils/StarLightPool.js` (Phase 2) — fixed-size pool of `THREE.PointLight`s reassigned to the nearest visible host stars each frame, modeled on World of Promptcraft's `PointLightPool` pattern (referenced in research doc, not copied verbatim — WoP's version is TypeScript/ground-game-specific).
  - `src/utils/SunFlare.js` (Phase 2) — canvas-gradient additive sprite(s) for the Sun glow/flare, replacing the fresnel-shader glow sphere in `SolarSystemField.js`.
  - `src/utils/ShaderWarmup.js` (Phase 6) — precompiles one instance of each material "shape" during the existing `LoadingManager` sequence.
  - `src/utils/instanceBuckets.js` (Phase 5) — builds/updates `THREE.InstancedMesh` batches keyed by (tier × color-bucket) for `ExoplanetField`.

File tree of affected areas (new files marked `NEW`):
```
src/
├── core/
│   ├── Renderer.js          # Phase 1: composer wired into render loop, selective bloom
│   ├── PostProcessing.js    # Phase 1: SMAA + selective (layer-based) bloom
│   ├── Scene.js             # Phase 2: light hierarchy (dominant key, subdued fill)
│   └── Camera.js            # Phase 2: camera headlamp gets real falloff or removed
├── objects/
│   ├── SolarSystemField.js  # Phase 2: Sun light decay/intensity, flare sprite instead of glow shader
│   ├── Planet.js            # Phase 2+3: live sunDirection feed, onBeforeCompile terminator patch
│   ├── ExoplanetField.js    # Phase 2 (host-star light stub) + Phase 5 (instancing/LOD)
│   ├── WarpTunnel.js        # Phase 4: DELETE
│   ├── SpaceDust.js         # Phase 4: DELETE
│   ├── SpaceDebris.js       # Phase 4: DELETE
│   ├── GalaxyField.js       # Phase 4: DELETE
│   ├── StarField.js         # Phase 4: DELETE
│   ├── DynamicStarField.js  # Phase 4: DELETE
│   └── Star.js              # Phase 4: DELETE
├── shaders/
│   └── AtmosphereShader.js  # Phase 3: per-planet-tunable uniforms, wavelength-ish scatter
├── services/
│   ├── PlanetClassifier.js  # Phase 7: getScaledRadius reconciled with SceneConstants
│   ├── PlanetVisualGenerator.js # Phase 3: atmosphere/cloud generation driven by characteristics
│   └── PlanetDataService.js # Phase 7: consumes pipeline-baked visual attributes when present
├── utils/
│   ├── StarLightPool.js     # NEW (Phase 2)
│   ├── SunFlare.js          # NEW (Phase 2)
│   ├── ShaderWarmup.js      # NEW (Phase 6)
│   ├── instanceBuckets.js   # NEW (Phase 5)
│   └── textureGenerator.js  # Phase 6: getCacheKey() fix
└── config/
    └── SceneConstants.js    # Phase 7: single authoritative radius scale, expanded LOD tiers (Phase 5)
main.js                      # Phase 2 (_solarMode removal, Phase 7), Phase 4 (dead import comments cleanup)
pipelines/
└── build_universe.py        # Phase 7: bake client-side visual attributes at build time
```

---

## Phase 1: Renderer & Post-Processing Foundation

### Overview
Make the post-processing composer actually drive rendering, add SMAA (since `antialias:false` currently has no replacement), and implement selective bloom via `THREE.Layers` so emissive/star objects glow without the "stars bleed through planets" bug that caused bloom to be disabled at strength `0.0`.

### Changes Required:

#### [x] 1. Wire the composer into the render loop
**File**: `src/core/Renderer.js`
**Changes**: Call `initPostProcessing(scene, camera)` once a scene/camera exist (from `main.js` after both managers are constructed), and change `render()` to call `this.composer.render()` when a composer exists, falling back to `renderer.render()` only if it doesn't (defensive, shouldn't normally trigger).

```js
render(scene, camera) {
    if (this.composer) {
        this.composer.render();
    } else {
        this.renderer.render(scene, camera);
    }
}
```

#### [x] 2. Add a bloom layer constant and tag emissive/star objects
**File**: `src/config/SceneConstants.js`
**Changes**: Add `export const BLOOM_LAYER = 1;` (layer 0 stays the default "everything" layer).

**File**: `src/objects/RealStarField.js`
**Changes**: In the constructor/load, call `this.mesh.layers.enable(BLOOM_LAYER)` on the star points mesh.

**File**: `src/objects/SolarSystemField.js`
**Changes**: Enable `BLOOM_LAYER` on the Sun's flare sprite object (built in Phase 2) — do not enable it on the Sun's base surface mesh, so the corona/flare blooms but the visible disc doesn't blow out.

#### [x] 3. Implement selective bloom in the composer
**File**: `src/core/PostProcessing.js`
**Changes**: Rebuild `initComposer()` to run two render passes: a bloom-target pass that renders only `BLOOM_LAYER` objects (by temporarily setting `camera.layers.set(BLOOM_LAYER)`, rendering to an offscreen `WebGLRenderTarget`, then restoring `camera.layers.set(0)`), an `UnrealBloomPass` applied to that offscreen buffer, and a final composite shader pass that adds the bloom buffer on top of the normally-rendered base scene. This is the standard three.js "selective bloom" pattern (base scene RenderPass + separate darken-non-bloomed-materials pass + bloom + additive composite `ShaderPass`).
**Changes**: Add an `SMAAPass` after the base `RenderPass` to replace the disabled `antialias:false` renderer flag.
**Changes**: Keep `FilmPass(0.35, 0, 0, false)` as the last pass before `OutputPass`.

```js
// initComposer() restructured:
// 1. RenderPass(scene, camera)              — base scene, all layers
// 2. SMAAPass(width*pixelRatio, height*pixelRatio)
// 3. [separate bloomComposer]: RenderPass (camera.layers=BLOOM_LAYER only) -> UnrealBloomPass
// 4. ShaderPass(additive-composite) — mixes bloomComposer's output into the main composer
// 5. FilmPass(0.35, 0, 0, false)
// 6. OutputPass
```

#### [x] 4. Verify log-depth-buffer compatibility
**File**: `src/core/Renderer.js`
**Changes**: None expected beyond the above — `logarithmicDepthBuffer:true` is a renderer-level flag; the composer's render targets inherit it. Confirmed no known three.js incompatibility between `logarithmicDepthBuffer` and `EffectComposer`/`UnrealBloomPass` beyond what caused the original full-scene-bloom "stars bleed through planets" symptom — which selective bloom (only bloom-layer objects reach the bloom pass) directly avoids by construction, since planet meshes are never on `BLOOM_LAYER`.

### Success Criteria:

#### Automated Verification:
- [x] `npm run build` completes with no errors
- [ ] No new console errors/warnings on load (check via `npm run dev` + browser devtools console)

#### Manual Verification:
- [ ] Stars in `RealStarField` show a soft bloom glow; planet surfaces do not bloom/blow out
- [ ] Screen edges show smoothed (anti-aliased) geometry edges on planet spheres and rings (SMAA working)
- [ ] Flying from the solar system out to a distant exoplanet field shows no bloom flicker, no stars visibly bleeding through the front face of a planet
- [ ] Frame rate stays interactive (no visible stutter) with the composer active, tested both near the Sun (many nearby objects) and near a dense exoplanet cluster

---

## Phase 2: Illumination Model Overhaul

### Overview
Establish one dominant key light per lit system (Sun for the solar system; a pooled proxy light for exoplanet host stars), reduce ambient/directional fill well below it, add real distance falloff to previously-infinite-range lights, feed a live sun direction into `AtmosphereShader`, add a separate rim light, and replace the Sun's fresnel-blob glow with a flare-sprite system.

### Changes Required:

#### [x] 1. Reduce and re-hierarchize the base scene lights
**File**: `src/core/Scene.js`
**Changes**: Lower `AmbientLight` intensity from `0.6` to `~0.15-0.2` and `DirectionalLight` from `0.4` to `~0.1` (both now pure "fill", well below any key light) — the fixed directional light continues to exist for objects with no nearby star reference (e.g. free-floating field visuals) but no longer competes with per-body key lighting.

#### [x] 2. Add falloff to the camera headlamp; reduce or remove it
**File**: `src/core/Camera.js`
**Changes**: Change `cameraLight` from `PointLight(white, 1.0, distance:0)` to either a much lower intensity with real `distance`/`decay` (e.g. `PointLight(white, 0.3, 5000, 2)` — falls off within a few thousand scene units so it only fills the immediate foreground, e.g. spacecraft cockpit visibility) or remove it entirely if Phase 2's per-body key lights make it unnecessary for gameplay visibility. Decide based on manual testing in this phase (test both; keep whichever avoids "planet lit from behind" while still letting the player see nearby objects in deep space where no star light reaches).

#### [x] 3. Give the Sun's light real falloff and make it the dominant key light
**File**: `src/objects/SolarSystemField.js`
**Changes**: Change the Sun's `PointLight(0xffffee, 5, 0, 0)` (`_createSun()`, ~L231) to use real decay, e.g. `PointLight(0xffffee, 8, 0, 2)` (physically-plausible inverse-square-ish falloff over the solar system's actual AU-to-scene-unit range; tune intensity so Neptune at ~949 scene units is dim but visible, Mercury near the Sun is bright) — since `physicallyCorrectLights` is `false`, `decay:2` still applies the classic inverse-square attenuation formula three.js uses regardless of that flag.

#### [x] 4. Add a rim light, independent of atmosphere fresnel
**File**: `src/core/Scene.js`
**Changes**: Add a second, low-intensity `DirectionalLight` (e.g. `0xffeebb, 0.25`) positioned to catch planet edges from a different angle than the fill directional light — this is a lighting-only rim, distinct from the atmosphere shader's own fresnel term, so airless rocky planets (no atmosphere shader at all) still get a defined edge highlight.

#### [x] 5. Feed a live sun direction into AtmosphereShader every frame
**File**: `src/objects/Planet.js`
**Changes**: In `update(deltaTime)`, after existing atmosphere/cloud animation update, compute the direction from `this.mesh.position` (world position) to the light source it should react to — the Sun at the origin for solar-system bodies, or (once available) the nearest `StarLightPool`-tracked position for exoplanets — and set `layer.material.uniforms.sunDirection.value.copy(direction)` for each atmosphere layer and `this.cloudMesh` if present (`CloudShader` doesn't currently use `sunDirection`, so this only applies to `AtmosphereShader` layers).

**File**: `src/objects/SolarSystemField.js`
**Changes**: In `update(deltaTime, cameraPosition)`, likewise update each body's atmosphere layer `sunDirection` uniform toward the Sun (origin) each frame.

```js
// Planet.js update() addition:
const sunPos = this._getLightSourcePosition(); // Sun origin, or host-star pool position
const dir = new THREE.Vector3().subVectors(sunPos, this.mesh.getWorldPosition(new THREE.Vector3())).normalize();
this.atmosphereLayers.forEach(layer => {
    if (layer.material.uniforms.sunDirection) {
        layer.material.uniforms.sunDirection.value.copy(dir);
    }
});
```

#### [x] 6. Add a fixed-size star light pool for exoplanet host stars
**File**: `src/utils/StarLightPool.js` (NEW)
**Changes**: Implement a pool of N (e.g. 12) real `THREE.PointLight`s created once at boot. Expose `registerEmitter(position)` / `unregisterEmitter(position)` and an `update(viewerPosition)` method that reassigns the pool's real lights to the N nearest registered emitter positions relative to the viewer each frame — modeled on the structure described for World of Promptcraft's `PointLightPool` in the research doc (not copied file-for-file, since that implementation is TypeScript and couples to WoP's own light-emitter registration API).

**File**: `src/objects/ExoplanetField.js`
**Changes**: For each planet in Tier 1 (near, <25 LY — the only tier with individual meshes with unique material state), compute an approximate host-star position (planet position offset outward along its known orbital direction if available, or a small fixed offset if not — host star exact position isn't tracked per-planet in current data, so this is a visually-plausible proxy, not a real second body) and register it with the `StarLightPool`. Only Tier 1 planets register (bounding registration count to a manageable number, well under any Tier 2/3 pool concerns) — Tier 2/3 planets continue using ambient/rim/fill lighting only, matching their existing lower visual-fidelity tier.

#### [x] 7. Replace the Sun's fresnel glow sphere with a flare-sprite system
**File**: `src/utils/SunFlare.js` (NEW)
**Changes**: Build 1-2 canvas-gradient `THREE.Sprite`s (additive blending, radial gradient texture generated once via `CanvasTexture`, matching the existing `_createSun()` canvas-texture-generation style already used for the Sun's surface) plus 2-4 smaller streak sprites along the camera-to-sun screen-space axis, computed via CPU vector math (`camera.worldToLocal`/`project`) each frame rather than any GPU readback. Enable `BLOOM_LAYER` (Phase 1) on these sprites.

**File**: `src/objects/SolarSystemField.js`
**Changes**: Remove the `glowGeom`/`glowMat`/`glowMesh` fresnel-shader glow sphere (~L204-228) from `_createSun()`; replace with a call into the new `SunFlare` module, storing a reference for per-frame update.

#### [x] 8. Remove the dead `_solarMode` flag
**File**: `main.js`
**Changes**: Delete `this._solarMode = true;` (L31) — confirmed unused elsewhere (grep in research doc).

### Success Criteria:

#### Automated Verification:
- [x] `npm run build` completes with no errors

#### Manual Verification:
- [ ] Rotating a solar-system planet (e.g. Earth) in `npm run dev` shows a visible day/night terminator line, not uniform flat lighting
- [ ] Flying to the far side of a planet relative to the Sun shows it noticeably darker than the sun-facing side
- [ ] The Sun reads visually as a bright glowing/flaring body (not a soft blob) from a normal viewing distance
- [ ] At least one Tier-1 exoplanet with an enabled atmosphere shows a directional terminator consistent with its (proxy) host-star light direction, not the old fixed `(1,0,0)` default
- [ ] No planet is unreadably dark on its terminator/night side (fill + rim lights should keep it legible, just visibly dimmer than the day side)
- [ ] Performance remains interactive with the star light pool active while flying through a dense nearby-planet cluster (12-light pool reassignment shouldn't visibly stutter)

---

## Phase 3: Planet Surface & Atmosphere Fidelity

### Overview
Make atmosphere/cloud shaders and planet surface materials vary per-planet based on `characteristics` data instead of fixed constants, add a day/night terminator to planet *surfaces* (not just atmosphere), and close out the already-scoped texture gaps from `tasks/texture-improvements.md`.

### Changes Required:

#### [x] 1. Drive atmosphere/cloud uniforms from planet characteristics
**File**: `src/services/PlanetVisualGenerator.js`
**Changes**: Extend `generateAtmosphere(classification, colors)` to also derive `intensity`/`rimPower`/`scatterStrength`-equivalent hints from `classification`/planet density where available (e.g. denser/thicker atmospheres get higher `density` already present, but also feed a proportional `scatterStrength`), returning these alongside the existing `enabled/color/density/hasClouds` fields.

**File**: `src/shaders/AtmosphereShader.js`
**Changes**: In `createAtmosphere(planetRadius, atmosphereConfig)`, read `atmosphereConfig.intensity`/`atmosphereConfig.rimPower`/`atmosphereConfig.scatterStrength` when present (falling back to today's hardcoded `0.8/0.4`, `2.5/4.0`, `0.7` values when absent) instead of always using the fixed constants.

**File**: `src/objects/Planet.js`, `src/objects/ExoplanetField.js`
**Changes**: Pass through `planet.atmosphere` (already carrying `color`/`density`/`hasClouds`) with the new fields when calling `createAtmosphere`.

#### [x] 2. Add wavelength-ish scattering term to AtmosphereShader
**File**: `src/shaders/AtmosphereShader.js`
**Changes**: In the fragment shader, split the existing single-scalar `scatter` term into per-channel weighting (e.g. stronger blue-channel falloff at grazing angles, warmer red/orange bias near the terminator) so atmosphere color visibly shifts with sun angle rather than a flat tint — extend the existing `mix(finalColor, vec3(1.0,0.9,0.8), scatter*0.5)` line into a small per-channel scatter response instead of one blended constant.

#### [~] 3. Add day/night terminator to planet surfaces via onBeforeCompile — SKIPPED, see note
**File**: `src/objects/Planet.js`
**Changes**: After constructing `material` (the `MeshStandardMaterial` in `createPlanet()`), if an `emissiveMap` (night-lights) is present, add `material.onBeforeCompile = (shader) => { ... }` that injects a `uniform vec3 sunDirection;` and patches `#include <emissivemap_fragment>` to scale the emissive contribution by `smoothstep(...)` based on `dot(vNormal, sunDirection)` — so night lights only show on the actual night side regardless of ambient/fill light levels, following the same shader-patching technique documented for World of Promptcraft's terrain emissive injection (`onBeforeCompile` + `#include` token replacement) in the research doc.
**Changes**: Store the shader's `uniforms.sunDirection` reference on `this.material.userData.sunDirectionUniform` so `update(deltaTime)` (already updating atmosphere `sunDirection` per Phase 2 item 5) can also update this surface-shader uniform each frame.

**File**: `src/objects/ExoplanetField.js`
**Changes**: Apply the same `onBeforeCompile` patch to Tier-1 planet materials that have a night-lights emissive map (`generateNightLightsTexture`, gated on `habitability > 50` — same condition already used in `Planet.js:168-170`, mirrored in `upgradeToHighResTexture`/high-res material path).

#### [x] 4. Close out existing texture backlog items relevant to visual fidelity (lava emissive map + mipmaps done; cloud tint SKIPPED, see note)
**File**: `src/utils/textureGenerator.js`
**Changes**: Add an emissive/glow map generator for lava-world exoplanets (closes `tasks/texture-improvements.md` item 2F) — a simple procedural texture with bright veins/pools matching the existing rocky-texture noise style, applied as `emissiveMap` with a nonzero `emissiveIntensity` on lava/hot-jupiter subtypes in `ExoplanetField.js` (currently these only get a flat `emissive: 0xff0000` color, no map — see `ExoplanetField.js:269-272`).
**Changes**: Set `generateTexture.minFilter = THREE.LinearMipmapLinearFilter` and call `.generateMipmaps` appropriately (or construct textures via `THREE.DataTexture` with `generateMipmaps: true` and `needsUpdate` after setting filters) on the worker-generated procedural textures (closes item 2G — currently no mipmaps, causing aliasing at distance).
**Changes**: In `createCloudLayer()` callers (`Planet.js:296-315`, `SolarSystemField.js`), pass the planet's `atmosphere.color` through to `CloudShader.uniforms.cloudColor` instead of the current hardcoded default (closes item 2J — non-Earth clouds currently don't tint by atmosphere color).

**Note on skipped sub-items (found during implementation)**: The terminator `onBeforeCompile` patch (item 3) and cloud-atmosphere-color tinting (item 4's `tasks/texture-improvements.md` 2J) were both scoped against `Planet.js`'s `createClouds()`/night-lights emissive path — but `Planet.js` is dead code (see Phase 2 note) and `ExoplanetField.js` never creates cloud layers or night-lights emissive maps for exoplanets at all (confirmed via grep: `createCloudLayer` is only ever called from `SolarSystemField.js`, gated to Earth only). There is no live surface-emissive or cloud code path for exoplanets to patch. Standard `MeshStandardMaterial` lighting already produces a correct N·L falloff from the Phase 2 key lights, so the "flat lighting" problem these items targeted is already addressed for plain surfaces; a real terminator/cloud-tint feature for exoplanets would require first building the (currently nonexistent) cloud-layer and night-lights-emissive code paths in `ExoplanetField.js`, which is new feature work beyond this plan's original scope and was not implemented here.

### Success Criteria:

#### Automated Verification:
- [x] `npm run build` completes with no errors

#### Manual Verification:
- [ ] Two different habitable-classified exoplanets with different `characteristics.principal_material`/density show visibly different atmosphere color/thickness (not identical blue haze)
- [ ] A lava-world exoplanet shows glowing surface veins/pools (emissive map), not a uniform flat red tint
- [ ] Earth's night-lights only appear on the night side of the terminator as the planet rotates, not uniformly lit at all times
- [ ] A non-Earth cloud-bearing exoplanet's clouds are tinted toward that planet's atmosphere color, not plain white/gray
- [ ] Distant Tier-1 planet textures show no obvious shimmering/aliasing moiré when the camera slowly moves away (mipmaps working)

---

## Phase 4: Dead Code Removal

### Overview
Delete confirmed-unused visual files per the "delete all, no rehab" decision — mechanical cleanup, no behavior change since nothing imports these files.

### Changes Required:

#### [x] 1. Delete confirmed-dead object files
**Files**: `src/objects/WarpTunnel.js`, `src/objects/SpaceDust.js`, `src/objects/SpaceDebris.js`, `src/objects/GalaxyField.js`, `src/objects/StarField.js`, `src/objects/DynamicStarField.js`, `src/objects/Star.js`
**Changes**: Delete each file. Confirmed via grep (research doc) that none are imported by `main.js` or any other active module.

#### [x] 2. Clean up the now-stale comment referencing removed WarpTunnel
**File**: `main.js`
**Changes**: Remove the `// WarpTunnel removed — clean space view` comment (L21) since the file itself is now gone rather than just unimported.

### Success Criteria:

#### Automated Verification:
- [x] `npm run build` completes with no errors (confirms nothing was actually importing the deleted files)
- [x] `grep -rE "WarpTunnel|SpaceDust|SpaceDebris|GalaxyField|StarField|DynamicStarField|Star\.js" src/ main.js` (excluding `RealStarField`) returns no matches outside the deleted files themselves

---

## Phase 5: Exoplanet Instancing & LOD Expansion

### Overview
Convert Tier 2/3 (medium/far) exoplanet rendering from per-planet cloned meshes to `THREE.InstancedMesh` batches keyed by (tier × color-bucket), and expand the LOD distance scheme from 2 breakpoints to 3, matching the existing tier split more explicitly.

### Changes Required:

#### [ ] 1. Add a 3rd LOD breakpoint constant
**File**: `src/config/SceneConstants.js`
**Changes**: Expand the `LOD` object to include a `MID_DETAIL` breakpoint between the existing `HIGH_DETAIL`/`MEDIUM_DETAIL`, aligning with the Tier1 (<25LY) / Tier2 (25-100LY) / Tier3 (>100LY) split already used in `ExoplanetField.create3DMeshes()` (`distLY < 25` → tier 1, `< 100` → tier 2, else tier 3) so the constant and the tier-assignment logic agree explicitly instead of the tier thresholds being hardcoded separately in `ExoplanetField.js:235-236`.

```js
export const LOD = {
    HIGH_DETAIL: 50_000_000,    // < 25 LY (Tier 1, individual meshes)
    MID_DETAIL: 200_000_000,    // < 100 LY (Tier 2, instanced)
    // MEDIUM_DETAIL kept as alias for backward compat during migration, remove once ExoplanetField fully migrated
    UPDATE_INTERVAL_MS: 1000,
    MAX_UPDATES_PER_FRAME: 2,
};
```

#### [ ] 2. Build instanced-mesh batching for Tier 2/3 planets
**File**: `src/utils/instanceBuckets.js` (NEW)
**Changes**: Implement `buildInstancedBuckets(planets, tier, geometry)` — groups planets by (tier, rounded base color, matching the existing `colorKey = \`mat_${baseColor}\`` bucketing already used for Tier 3's `distantMaterials` Map), creates one `THREE.InstancedMesh(geometry, material, count)` per bucket, and sets each instance's transform via `setMatrixAt(i, matrix)` from the planet's computed position/scale/flattening (reusing the same position/scale math currently inline in `ExoplanetField.create3DMeshes()`). Exposes an update function to refresh individual instance matrices (needed for the existing per-frame adaptive-scale logic in `updateLOD()`, since scale changes per-instance rather than per-mesh now).

**File**: `src/objects/ExoplanetField.js`
**Changes**: Restructure `create3DMeshes()` so Tier 1 planets continue as individual meshes (unchanged — they need unique atmosphere/ring/high-res-texture state), while Tier 2/3 planets are routed into `instanceBuckets.js` instead of `.clone()`d individual meshes. `updateLOD()`'s adaptive-scale (`exoAdaptiveScale`) and texture-tier-crossing logic must be adapted: since Tier 2/3 no longer have individually addressable materials, texture LOD upgrade/downgrade (`upgradeToHighResTexture`/`downgradeToLowResTexture`) only applies to Tier 1 as before; adaptive *scale* for instanced planets updates that planet's specific instance matrix within its bucket's `InstancedMesh` (via `setMatrixAt` + `instanceMatrix.needsUpdate = true`) rather than `mesh.scale.copy(...)`.

**File**: `src/objects/ExoplanetField.js`
**Changes**: Update `getPlanetAtPosition()` and raycasting-dependent click handling (`main.js` `handlePlanetClick`) to account for `InstancedMesh` raycasts returning an `instanceId` — Three.js's raycaster already supports this for `InstancedMesh`; the planet-lookup logic needs to map `intersection.instanceId` back to the specific planet via a per-bucket `instanceId -> planet` array maintained alongside each bucket.

#### [ ] 3. Preserve multi-planet system layout and progressive loading
**File**: `src/objects/ExoplanetField.js`
**Changes**: `buildMultiPlanetOffsets()`, `applyMultiPlanetLayout()`, and `updateSystemScaleCaps()` continue operating on the full planet list as today; their outputs (offsets, per-planet max-adaptive-scale caps) now feed into per-instance matrix updates for Tier 2/3 instead of per-mesh `position.copy`/`scale` calls. The existing `loadClustersProgressively()` 500ms-between-clusters behavior is unchanged — instanced buckets are rebuilt/appended-to incrementally as new cluster batches arrive, following the same `requestIdleCallback` batching already in `create3DMeshes()`.

### Success Criteria:

#### Automated Verification:
- [ ] `npm run build` completes with no errors
- [ ] Total draw calls for a fully-loaded exoplanet field (check via browser devtools / `renderer.info.render.calls` logged to console) drops substantially compared to the pre-instancing baseline (informal check — no fixed numeric target since exact planet distribution varies by cluster, but should visibly go from thousands to dozens/hundreds)

#### Manual Verification:
- [ ] All 6,000+ exoplanets still render and are visually indistinguishable in position/color/size from before instancing (no obvious visual regression)
- [ ] Clicking a Tier 2/3 (instanced) exoplanet still correctly opens its exploration dialog with the right planet's data (instanceId → planet mapping works)
- [ ] Frame rate is smoother (fewer stutters) when panning across a dense distant cluster compared to before this phase
- [ ] Progressive cluster loading still shows planets appearing gradually rather than all-at-once or with a long freeze
- [ ] Multi-planet systems (planets sharing a hostname) still show correctly spread-out, non-overlapping positions

---

## Phase 6: Adaptive Quality & Frame-Budget Performance

### Overview
Add adaptive pixel-ratio scaling based on measured frame time, a shader-warmup pass during the existing loading screen, and fix the texture-generator cache key's `JSON.stringify` hot-path cost.

### Changes Required:

#### [ ] 1. Adaptive pixel ratio
**File**: `src/core/Renderer.js`
**Changes**: Add an `updateAdaptiveQuality(frameTimeMs)` method: maintain a rolling average frame time (updated once per call from `main.js`'s `animate()` loop, passing `deltaTime`), and lerp `this.renderer.getPixelRatio()` toward a lower floor (e.g. `0.75`) when average frame time exceeds a threshold (e.g. 20ms, i.e. <50fps) or back toward the existing cap (`min(devicePixelRatio, 2)`) when frame time drops below a lower threshold (e.g. 14ms) — check at most every ~0.5s to avoid oscillation, following the interval-based approach described for World of Promptcraft's `updateAdaptiveQuality()` in the research doc.

**File**: `main.js`
**Changes**: In `animate()`, call `this.rendererManager.updateAdaptiveQuality(deltaTime)` once per frame.

#### [ ] 2. Shader warmup pass
**File**: `src/utils/ShaderWarmup.js` (NEW)
**Changes**: During the existing `LoadingManager` sequence (before `this.loadingManager.finish()` in `main.js`'s `init()`), construct one throwaway instance of each material "shape" now in use — Tier 1 rocky/gasGiant/iceGiant/lava `MeshStandardMaterial` variants (with and without the Phase 3 `onBeforeCompile` patch), the atmosphere inner/outer `ShaderMaterial`, the cloud `ShaderMaterial`, and the Phase 2 `SunFlare` sprite material — render each once off-screen (tiny `1x1` render target) to force shader compilation, then dispose the throwaway meshes/geometries (but not shared materials/textures that are still referenced elsewhere).

**File**: `main.js`
**Changes**: Call the warmup during `init()`, gated behind its own `loadingManager` step so progress UI still reflects it.

#### [ ] 3. Fix texture-generator cache key
**File**: `src/utils/textureGenerator.js`
**Changes**: Replace `getCacheKey()`'s `JSON.stringify(...)`-based key construction with a manual string-concatenation key built from the specific primitive arguments already passed to each generator function (color hex values, size, seed) — same information, no serialization overhead.

### Success Criteria:

#### Automated Verification:
- [ ] `npm run build` completes with no errors

#### Manual Verification:
- [ ] On a lower-end machine/throttled CPU (Chrome devtools CPU throttling ×4-6), frame rate stays more stable during initial load and heavy scenes than before (pixel ratio visibly drops under load, via a temporary console log or devtools inspection of `renderer.getPixelRatio()`)
- [ ] No visible mid-play stutter the first time a new material "shape" appears on screen (e.g. first lava-world exoplanet, first ringed planet) — shader warmup absorbed that cost during loading instead
- [ ] Loading screen still completes and transitions to the running app normally with the new warmup step included

---

## Phase 7: Universe/Data Pipeline Cleanup

### Overview
Reconcile the two divergent exoplanet radius-scaling schemes into one authoritative function, bake client-side-generated visual attributes into cluster JSON at pipeline-build time, and remove now-fully-dead state.

### Changes Required:

#### [ ] 1. Reconcile radius-scaling schemes
**File**: `src/services/PlanetClassifier.js`
**Changes**: Remove `getScaledRadius()` (currently dead on exoplanets — its output `planet.radius` is set by `PlanetDataService.enrichPlanetData()` but never read by `ExoplanetField.create3DMeshes()`, which recomputes render radius directly from `pl_rade * EARTH_RADIUS_SCALE`). Replace remaining call sites with a shared helper that reads `SceneConstants.EARTH_RADIUS_SCALE`/`MAX_PLANET_RADIUS`/`MIN_PLANET_RADIUS` directly (the values `ExoplanetField.js:230-232` already uses), so there is exactly one radius-scale function for exoplanets.

**File**: `src/services/PlanetDataService.js`
**Changes**: Update `enrichPlanetData()` (L76, `planet.radius = getScaledRadius(radius)`) to use the new shared helper instead — keeps `planet.radius` populated for any UI/navigator code that reads it (e.g. `PlanetNavigator`), now consistent with what `ExoplanetField` actually renders.

#### [ ] 2. Bake visual attributes at pipeline build time
**File**: `pipelines/build_universe.py`
**Changes**: Add a build step (after `classify_planet()`, before `write_cluster()`) that computes the same deterministic, name-hash-seeded color/atmosphere/rings/flattening values currently computed client-side by `PlanetVisualGenerator.js`/`PlanetClassifier.calculateFlattening` — implemented as an equivalent Python port of those same hash/tweak functions (same algorithm, same seed-from-name approach, so output values are identical to what the client already deterministically produces) — and writes them directly into each planet's JSON entry (`color`, `detailColor`, `gasColors`, `atmosphere`, `rings`, `flattening`, `mass`).

**File**: `src/services/PlanetDataService.js`
**Changes**: In `enrichPlanetData()`, check if `planet.color`/`planet.atmosphere`/etc. are already present (from the pipeline bake) before falling back to the existing client-side `classifyPlanet`/`generatePlanetColors`/etc. calls — preserves backward compatibility for any cluster JSON not yet regenerated with the new pipeline, while avoiding redundant computation once it is.

#### [ ] 3. Regenerate cluster data with baked attributes
**Changes**: Run the updated `pipelines/build_universe.py` to regenerate `nasa_data/clusters/*.json` with baked visual attributes, verifying `cluster_index.json` still reports the same `total_planets`/`total_clusters` counts as before (`6126`/`17`) — a content change, not a data-shape or count change.

#### [ ] 4. Remove dead classifier code path
**Changes**: Confirm (via grep) `getScaledRadius` has no remaining call sites after item 1's replacement, and remove it entirely rather than leaving it as unused dead code (consistent with Phase 4's cleanup philosophy).

### Success Criteria:

#### Automated Verification:
- [ ] `npm run build` completes with no errors
- [ ] `python3 pipelines/build_universe.py` runs to completion and regenerates `nasa_data/clusters/cluster_index.json` with `total_planets`/`total_clusters` unchanged from current values
- [ ] `grep -r "getScaledRadius" src/` returns no matches after cleanup

#### Manual Verification:
- [ ] Exoplanets render at visually the same sizes as before this phase (radius-scale reconciliation didn't change on-screen size, only removed the dead duplicate function)
- [ ] Same planet (by name) shows the same color/atmosphere/rings across a full page reload before and after the pipeline regeneration (baked values match previously-computed client-side values, confirming the Python port is faithful to the JS algorithm)
- [ ] Initial page load with regenerated cluster data feels at least as fast as before (client no longer recomputing visual attributes for already-baked planets)

---

## Testing Strategy

### Unit Tests:
No test framework exists in this repo (`package.json` test script is a stub). This plan does not introduce one — verification throughout is `npm run build` (catches syntax/import errors) plus manual visual inspection, consistent with the existing project convention.

### Integration Tests:
N/A — no integration test harness exists.

### Manual Testing Steps:
1. Run `npm run dev`, load the app, confirm no console errors during startup (all phases).
2. Fly to Earth in the solar system; rotate the view around it to check for a visible day/night terminator (Phase 2/3).
3. Fly to Mercury (closest to Sun, brightest) and Neptune (farthest, dimmest) to confirm the Sun's key light shows a visible brightness falloff with distance (Phase 2).
4. Open the Planet Navigator, teleport to a habitable-classified exoplanet and a lava-world exoplanet; compare their atmosphere/surface appearance to confirm per-planet variation (Phase 3).
5. Pan the camera across a dense nearby exoplanet cluster and check frame smoothness before/after Phase 5's instancing (informal, via visible stutter or devtools FPS meter).
6. Click several Tier 2/3 (medium/far) exoplanets after Phase 5 to confirm the exploration dialog still shows correct per-planet data (instanceId mapping correctness).
7. Reload the app several times to confirm the loading screen completes normally with the Phase 6 shader-warmup step added.

## Performance Considerations

- Phase 1's selective bloom requires an extra offscreen render pass (bloom-layer-only) each frame — monitor for frame-time regression versus the current (bloom-disabled) baseline; if it's significant, consider only rendering the bloom pass at half resolution (already planned) or every other frame.
- Phase 2's star light pool (Phase 2 item 6) bounds exoplanet host-star lighting to a fixed N real lights regardless of how many Tier-1 planets are on screen, specifically to avoid the shader-permutation-cache and per-light-loop cost blowup that an unbounded per-planet light count would cause.
- Phase 5's instancing is the largest expected performance win in this plan (thousands of draw calls → dozens/hundreds for Tier 2/3) — should be validated against the existing informal `renderer.info.render.calls` check before/after.
- Phase 6's adaptive pixel ratio and shader warmup are both explicitly modeled on patterns already proven in World of Promptcraft's engine for exactly this kind of "many dynamically-appearing objects" workload.

## Migration Notes

- Phase 7's pipeline bake is additive/backward-compatible: `PlanetDataService.enrichPlanetData()` checks for already-baked fields before falling back to client-side generation, so partially-regenerated cluster data (some files baked, some not) continues to work correctly during the transition.
- Phase 4's file deletions are non-reversible via this plan (no re-import path is being preserved) — confirmed safe only because Phase 4's automated verification step greps for zero remaining references before/after.

## References

- `docs/agents/research/2026-07-29-visual-improvement-plan.md` — source research document for this plan, containing full file:line detail for every finding referenced above
- World of Promptcraft `scene/SceneManager.ts`, `scene/Lighting.ts`, `scene/PointLightPool.ts`, `systems/worldbuilder/instanceBatch.ts`, `core/ShaderWarmup.ts` — pattern references (not copied verbatim; SpAIce's implementations are new, JS, and adapted to its own architecture)

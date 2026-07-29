---
date: 2026-07-29T21:00:57+00:00
git_commit: c8f5ad646e3c3306e7a17c2f8304779cbe927747
branch: fix-planets
topic: "Visual improvement plan for SpAIce — informed by World of Promptcraft's rendering engine"
tags: [research, codebase, rendering, shaders, performance, planets, universe, lighting]
status: complete
---

# Research: Visual improvement plan for SpAIce, informed by World of Promptcraft's engine

## Research Question

Check the shaders and 3D engine from World of Promptcraft. Identify what changes could be made to improve SpAIce's planet generation, universe rendering, and performance. Produce a large visual improvement plan (to be turned into an implementation plan later).

## Summary

SpAIce (this repo) renders 6,000+ real NASA exoplanets plus a live-ephemeris solar system in one unified, dual-scale coordinate space (AU for the solar system, light-years for exoplanets, both converted into "scene units" via `LY_TO_SCENE = 2,000,000`). It uses a **logarithmic depth buffer** to survive the ~10-order-of-magnitude scale range, and as a side effect several standard visual features are currently disabled or degraded because they conflict with that log-depth setup: shadows are off entirely, bloom is set to strength `0.0`, and post-processing is bypassed altogether (`Renderer.js:71-76` calls `renderer.render()` directly, never the composer). No `THREE.InstancedMesh` is used anywhere — all 6,000+ exoplanets are individual cloned-geometry meshes. Several fully-built visual systems (`WarpTunnel`, `SpaceDust`, `SpaceDebris`, `GalaxyField`, `StarField`, `DynamicStarField`, `Star.js`) exist in the tree but are unused dead code, removed per commit `c8f5ad6` ("Removed visual noise") because they apparently caused visual bugs at this scale rather than being redesigned to work with it.

World of Promptcraft (a separate, human-scale open-world game in the same account, at `/Users/eduardo.pertierrapuche/Development My Project/world-of-prompcraft`) runs a mature real-time engine with patterns directly transferable in *spirit* (not literally, since its scale/precision problem doesn't exist): a composer pipeline that actually renders (SMAA + UnrealBloom), adaptive resolution scaling keyed off measured frame time, `InstancedMesh`-based batching for repeated props, `THREE.LOD`-based mesh swapping, a shader-warmup pass to avoid mid-play compile stalls, a point-light pool to keep the shader permutation count fixed, and object pooling for particles. Several of these patterns solve exactly the problems SpAIce is currently solving with cruder tools (screen-space "adaptive scale" instead of real LOD geometry swapping, no instancing for 6,000 near-identical planet meshes, no shader warmup, no adaptive quality).

The plan below is organized as six workstreams, each with concrete file references and the WoP pattern (if any) it draws from.

## Detailed Findings

### A. Renderer / post-processing pipeline (SpAIce)

- `src/core/Renderer.js:30-36` — `WebGLRenderer` created with `antialias:false`, `logarithmicDepthBuffer:true`. The log-depth buffer is what lets the same camera see a planet at 3 scene units and a star system at 8,480,000 scene units without z-fighting.
- `src/core/Renderer.js:54-58` — `physicallyCorrectLights = false`, `shadowMap.enabled = false` ("Shadows don't work at this scale"), `toneMapping = LinearToneMapping`.
- `src/core/Renderer.js:71-76` — `render()` calls `renderer.render(scene, camera)` directly; the composer built in `initPostProcessing()` is never invoked from the render loop, so `src/core/PostProcessing.js` is dead weight in practice.
- `src/core/PostProcessing.js:38-44` — `UnrealBloomPass` strength hardcoded to `0.0` ("DISABLED — was causing stars to bleed through planets").
- `src/core/PostProcessing.js:48` — `FilmPass(0.35, 0, 0, false)` (grain only, no scanlines).

**World of Promptcraft comparison** (`scene/SceneManager.ts`): composer actually drives rendering every frame; pass order is `RenderPass → SMAAPass → UnrealBloomPass(strength 0.22, radius 0.35, threshold 0.9)`; pixel ratio is *adaptive* — lerped between a floor (0.9) and cap (1.5, further scaled by a user slider) based on a rolling frame-time average (`updateAdaptiveQuality()`), not a single fixed `min(dpr, 2)` clamp. SpAIce has no equivalent adaptive-quality loop — pixel ratio is set once and on resize only (`Renderer.js:39,80`).

### B. Planet surface rendering (SpAIce)

- `src/objects/Planet.js:72-279` — builds a `SphereGeometry(radius, 32, 32)`; solar-system bodies get real photographic textures (`createPlanet` L94-156: Earth day/specular/normal/night-lights maps, other planets diffuse + procedural normal map); exoplanets get fully procedural textures (`generateCratersTexture`/`generateRockyTexture`/`generateGasGiantTexture`/`generateIceGiantTexture`, L157-179).
- `src/services/PlanetVisualGenerator.js:21-137` — deterministic name-hash-seeded color/atmosphere/ring generation per classification; `applySolarSystemOverrides()` (L139-209) hardcodes overrides for the 9 major bodies.
- `src/shaders/AtmosphereShader.js` — `AtmosphereShader` (rim/fresnel + single-term Rayleigh-ish scatter, no wavelength-dependent scattering) and `CloudShader` (5-octave value-noise FBM, animated UV scroll) are the only two atmosphere/cloud shaders, shared by both `Planet.js` and `SolarSystemField.js`. Atmosphere/cloud color, opacity, and coverage are fixed constants inside the shader-building functions (`createAtmosphere` L177-228: `intensity 0.8/0.4`, `rimPower 2.5/4.0`; `createCloudLayer` L233-259: `cloudOpacity 0.5`, `cloudCoverage 0.6`, `cloudSpeed 0.005`) rather than per-planet-tunable, so all habitable/atmospheric planets currently look visually similar regardless of their actual `characteristics` data (density, composition).
- `tasks/texture-improvements.md` (existing backlog, dated 2026-03-31) already documents several of the same gaps independently: no emissive map on lava-world exoplanets (item 2F, confirmed still true), non-Earth clouds don't tint by atmosphere color (item 2J, confirmed), no mipmaps on worker-generated `DataTexture`s causing distant aliasing (item 2G), hardcoded 512px texture resolution (item 2C).

**World of Promptcraft comparison**: no equivalent of "one procedural planet shader" exists (WoP is a ground-level game, not a planet renderer), but its **material-application architecture** in `utils/PBRMaps.ts` is relevant: a single dispatch layer (`applyStonePBR`, `applyWoodPBR`, etc.) applies a *matched set* of diffuse+normal+roughness maps per material kind, and two of those maps (`makeSkinNor`, `makeCanopyNor`) are runtime-procedural `DataTexture`s generated once and reused — the same pattern SpAIce's texture worker already does for planets, just without the roughness-map or emissive-map half of the set (per `tasks/texture-improvements.md` 2F/2H).

### C. Exoplanet field rendering / instancing / LOD (SpAIce)

- `src/objects/ExoplanetField.js:195-202,343-345` — three shared "tier" base geometries (32/24, 16/12, 12/8 segment spheres) are `.clone()`d and scaled per planet. **No `THREE.InstancedMesh` is used anywhere in the file or the repo** (confirmed by grep in both sub-agent passes).
- `src/objects/ExoplanetField.js:250-341` — Tier-3 (distant) planets share a cached `MeshStandardMaterial` per unique color (`distantMaterials` Map) — the only material-instance reuse in the codebase.
- `src/objects/ExoplanetField.js:12-23,467-501` — "adaptive scale" is screen-space minimum-pixel-size clamping (`EXO_MIN_PIXELS = 3`), not distance-based geometry/material LOD swapping in the classic sense (the *tier* assignment at load time by distance is the real LOD; adaptive-scale is a separate on-top-of-that visibility hack so far planets don't shrink to sub-pixel).
- `src/objects/ExoplanetField.js:618-731` — texture LOD (`upgradeToHighResTexture`/`downgradeToLowResTexture`) throttled to 1 update/sec, max 2 swaps/frame (`SceneConstants.js:52-57`).
- `src/config/SceneConstants.js:52-57` — `LOD.HIGH_DETAIL = 50,000,000` scene units (~25 LY), `MEDIUM_DETAIL = 200,000,000` (~100 LY) — only two distance breakpoints total for the entire 6,000+-planet field.

**World of Promptcraft comparison**: `systems/worldbuilder/instanceBatch.ts` builds one `THREE.InstancedMesh` per (mesh-type × material) for every repeated prop in a chunk — N trees become ~1-2 draw calls instead of N. `meshes/buildings/malaka/MalakaKit.ts:148-160` wraps buildings in real `THREE.LOD` with 3 levels (full → flat-colored full-geometry → flat-colored simplified-geometry), swapping actual geometry/material, not just visual scale. Applied to SpAIce: the 6,000+ individual exoplanet meshes are a strong candidate for `InstancedMesh` per (tier × rough-color-bucket), and the 2-tier distance system is coarser than WoP's 3-level LOD.

### D. Star field / galaxy background (SpAIce)

- `src/objects/RealStarField.js` — the star field actually wired into `main.js`; loads ~109K real HYG-catalog stars from a binary blob (`hyg_stars.bin`), custom `ShaderMaterial` (Airy-disk core + glow + 4-point diffraction spike, `frustumCulled = false`).
- `src/objects/StarField.js`, `DynamicStarField.js`, `GalaxyField.js` — all fully implemented, all confirmed **unused** (not imported by `main.js`). `GalaxyField.js` in particular has a 3-type procedurally-generated galaxy sprite system (spiral/elliptical/irregular) that is currently orphaned.
- `src/objects/WarpTunnel.js`, `SpaceDust.js`, `SpaceDebris.js`, `Star.js` — also confirmed unused/dead, removed per commit `c8f5ad6` message "Removed visual noise: SpaceDust, SpaceDebris, GalaxyField, PostProcessing".

### E. Universe / data pipeline (SpAIce)

- `pipelines/build_universe.py` — single consolidated pipeline (401 lines): NASA Exoplanet Archive query → `to_cartesian_ly()` (RA/Dec/distance → Cartesian LY, ICRS frame) → `classify_planet()` → `assign_bucket()` into `{tier}_quad{quadrant}` clusters → `write_cluster()` (auto-splits clusters over 20MB). Confirmed current output: `cluster_index.json` reports `total_planets: 6126`, `total_clusters: 17`.
- `src/services/PlanetDataService.js:47-92` — visual attributes (color, atmosphere, rings, flattening) are generated **client-side at load time** from `PlanetClassifier.js`/`PlanetVisualGenerator.js`, not baked into the JSON cluster files. This means every client re-derives the same deterministic-but-CPU-costly generation on every load.
- Two independent radius-scaling schemes exist: `PlanetClassifier.getScaledRadius()` (`min(earthRadii*0.5, 15)`) vs. `SceneConstants.EARTH_RADIUS_SCALE = 5000`/`MAX_PLANET_RADIUS = 50000` used by `ExoplanetField`. `PlanetClassifier`'s scale function does not appear to be the one actually driving on-screen exoplanet size.
- `main.js:31` — a `this._solarMode = true` flag is declared but never read elsewhere (grep confirmed); vestige of a pre-"unified/adaptive dual-scale" design.

### G. Illumination / lighting model (SpAIce vs. World of Promptcraft)

**SpAIce's actual light rig, read directly:**
- `src/core/Scene.js:22-28` — one `AmbientLight(white, 0.6)` + one `DirectionalLight(white, 0.4)` at fixed world position `(1, 0.5, 0)` looking at the origin. This directional light **never moves** — it does not track the Sun's position, does not track which host star a given exoplanet orbits, and is not updated per frame anywhere (no `directionalLight` reference is stored for later mutation; grep confirms it is local to `setupScene()`).
- `src/core/Camera.js:28-31` — a `PointLight(white, 1.0, distance:0)` (zero = infinite range, no falloff) is parented to the camera itself. This is effectively a permanent, undecaying headlamp that follows the viewer everywhere.
- `src/objects/SolarSystemField.js:230-233` — the Sun itself emits a second infinite-range, non-decaying `PointLight(0xffffee, intensity:5, distance:0, decay:0)`.
- `src/objects/SolarSystemField.js:204-228` — the only "sun glow" visual is a small fresnel-shader glow sphere (`pow(0.7 - dot(vNormal, viewDir), 2.0)`) at `sunRadius*1.15` — not a lens-flare/streak system, and not reused for exoplanet host stars (exoplanets have no visible host star mesh at all — the star field points stand in for them).
- `renderer.physicallyCorrectLights = false` (`Renderer.js:55`) means none of these lights fall off with the inverse-square law even where `decay` isn't explicitly zeroed.
- Net effect: **three simultaneous, non-decaying/flat light sources** (ambient, fixed-direction directional, camera headlamp, plus the Sun's own infinite point light near the solar system) wash out any true day/night terminator on planet surfaces. Earth's night-lights emissive map (`Planet.js` L94-156) and the atmosphere shader's `sunDirection`-based scatter term (`AtmosphereShader.js:53-58`) are the *only* things in the codebase that reference an actual light direction — and the atmosphere shader's `sunDirection` uniform is initialized once to `(1,0,0)` (`AtmosphereShader.js:11`) and is not visibly updated per-frame from the real Sun/host-star position anywhere in `Planet.js` or `SolarSystemField.js` (no `.sunDirection.value.set(...)` call found in either file). So even the one shader that models directional light doesn't currently receive a correct, live direction.
- Practical symptom: planets read as uniformly, flatly lit spheres from any angle — there is no terminator line, no dramatic day/night contrast, and the "camera headlamp" specifically means a planet directly behind the camera relative to its star still looks lit.

**World of Promptcraft's lighting model, for contrast** (`scene/Lighting.ts`, from prior scout pass):
- A single real shadow-casting `DirectionalLight` (`sun`, intensity 2.5) is the dominant light and is explicitly re-centered on the player every frame (`trackPlayer(x,z)`) — the direction itself is fixed (no day/night cycle — `moon` intensity is 0), but its *shadow frustum* tracks the player so shadow quality stays high without a giant frustum.
- A `HemisphereLight` (sky/ground colors) and a low-intensity `AmbientLight` provide fill, but at low enough intensity (0.65-1.2 combined against a 2.5-intensity key light) that the directional light still dominates the shading — unlike SpAIce where ambient (0.6) + directional (0.4) + two infinite point lights are all comparable magnitude, so no single light dominates and nothing reads as "the" light source.
- A secondary low-intensity `rim` directional light (0.45, warm tint, no shadow) adds a subtle edge highlight independent of the main key light and the atmosphere/fresnel effects — this is a *lighting-only* rim, layered underneath whatever fresnel a surface shader also does.
- Sun/moon are rendered as canvas-gradient additive sprites with a 4-point flare-streak set, explicitly replacing three.js's built-in `Lensflare` because that component forces a `gl.readPixels()` sync stall every frame — flare position/visibility is computed by pure CPU dot-product/unproject math instead.
- A fixed-size `PointLightPool` (12 real `THREE.PointLight`s) is allocated once at boot, before shader warmup, specifically so the shader-permutation cache key (`numPointLights`) never changes as lanterns/torches stream in and out during play — new light-emitting objects register with the pool instead of instantiating new lights, and the pool reassigns its 12 real lights to the 12 nearest emitters to the player each frame.

**The gap, stated plainly**: SpAIce has no dominant key light and no live sun-direction feed into its one directional-aware shader; World of Promptcraft has exactly one dominant key light, a subdued fill (hemisphere+ambient), a separate subtle rim light, and a cheap non-stalling flare system. The fixes below (Workstream 7) port that *structure* — not the literal shadow-mapping (which SpAIce's log-depth buffer already ruled out) — to SpAIce's light rig and to the atmosphere/planet shaders that should be consuming a live sun direction.

### F. Performance-relevant code (SpAIce, cross-cutting)

- No adaptive-quality loop (contrast with WoP's `updateAdaptiveQuality()` in `SceneManager.ts:162-183`, which throttles pixel ratio by measured frame time every 0.5s).
- No shader-warmup pass (contrast with WoP's `core/ShaderWarmup.ts`, which precompiles every mesh type behind the loading screen to avoid mid-play compile stalls up to ~600ms).
- `src/utils/textureGenerator.js` offloads procedural texture generation to a worker (`src/workers/textureWorker.js`) with a `getCacheKey()` cache — but the cache key uses `JSON.stringify` (flagged as slow in `tasks/texture-improvements.md` item 2I), and synchronous, main-thread-blocking counterparts of the same generator functions are still used by `Planet.js`/dead-code `SpaceDebris.js`.
- Batched/incremental mesh construction already exists (`ExoplanetField.create3DMeshes()` batches 30 planets per `requestIdleCallback` tick; `loadClustersProgressively()` adds 500ms between cluster loads) — this pattern is sound and matches WoP's own frame-budget-based chunk building (`Terrain.ts` `CHUNK_BUDGET_MS = 5`).

## Visual Improvement Plan (draft — for later phased implementation planning)

This section intentionally goes beyond pure documentation because the user explicitly asked for improvement ideas. It is a *candidate list*, not an approved plan — a `/rpi-plan` pass should turn whichever of these are selected into a phased, checkbox-tracked implementation plan.

### Workstream 1 — Make post-processing work at astronomical scale (visual polish, currently the biggest suppressed feature)
- Re-enable a composer path, but diagnose the actual cause of "blinking artifacts with log depth buffer" before re-adding bloom — likely candidates: bloom operating in screen-space picks up the *entire* far-scale skybox/stars as bright pixels, or precision loss in the log-depth pass interacts with the bloom threshold pass. WoP's SMAA+Bloom order (`RenderPass → SMAA → Bloom(strength 0.22, threshold 0.9)`) is a good reference point for *pass order and threshold tuning*, not a drop-in fix, since WoP has no log-depth buffer to fight.
- If full-scene bloom remains unstable, consider selective bloom (render emissive/star objects to a separate layer via `THREE.Layers` and bloom only that layer) — sidesteps the "stars bleed through planets" failure mode described in the current disabled comment.
- Add SMAA or FXAA back now that `antialias:false` on the renderer relies entirely on this being handled elsewhere (currently it's handled nowhere).

### Workstream 2 — Planet surface & atmosphere fidelity
- Extend `AtmosphereShader`/`CloudShader` uniforms to be driven per-planet from `characteristics` (density, composition, habitability) instead of the fixed constants in `createAtmosphere()`/`createCloudLayer()` — directly closes the "all habitable planets look the same" gap noted above.
- Add wavelength-dependent (multi-channel) scattering terms to `AtmosphereShader` fragment shader so atmosphere color shifts more convincingly with sun angle, closer to real Rayleigh scattering than the current single scalar `scatter` term.
- Close out `tasks/texture-improvements.md` items 2F (lava emissive map), 2G (mipmaps on worker textures), 2J (cloud tint by atmosphere color) — these are already-scoped, concrete texture fixes.
- Give distant-tier exoplanets (currently a flat cached-color material, `ExoplanetField.js` distant tier) a cheap fake-emissive "twinkle" via vertex-color or a tiny shared point-sprite shader instead of a fully flat `MeshStandardMaterial`, closer to how WoP treats far-LOD props as flat-colored but still lit.

### Workstream 3 — Replace per-mesh exoplanet rendering with instancing
- Convert the Tier-2/Tier-3 (medium/far) exoplanet spheres to `THREE.InstancedMesh` batches keyed by (tier × rounded base color), following WoP's `instanceBatch.ts` pattern — collapses thousands of draw calls into dozens. Tier-1 (near, with atmosphere/rings/high-res textures) likely stays as individual meshes since each needs unique material state.
- Expand the 2-breakpoint distance LOD (`SceneConstants.LOD`) to a 3-tier scheme matching the existing Tier1/Tier2/Tier3 geometry split more explicitly, with the middle tier getting a WoP-style "flat-colored full geometry" mid-step instead of jumping straight to the cheapest geometry.

### Workstream 4 — Star field & galaxy background
- Decide the fate of the four unused files (`StarField.js`, `DynamicStarField.js`, `GalaxyField.js`, plus dead `WarpTunnel`/`SpaceDust`/`SpaceDebris`/`Star.js`): either delete them (they're confirmed dead per grep, reducing confusion for future contributors) or rehabilitate `GalaxyField.js` specifically as a genuinely nice, currently-orphaned visual (background galaxy sprites at extreme distance) — its removal reason ("visual noise") likely applied to the *combination* with other now-also-removed effects, not necessarily to the galaxy sprites alone.
- If galaxy background is reintroduced, gate it behind the same frustum-culling/`renderOrder` discipline `RealStarField` already uses (`frustumCulled=false`, `renderOrder:-999`) to avoid the depth-sorting bugs that likely caused the original removal.

### Workstream 5 — Adaptive quality & frame-budget techniques (performance, directly ported from WoP)
- Add an adaptive-pixel-ratio loop analogous to WoP's `updateAdaptiveQuality()`: measure rolling frame time, lerp `renderer.setPixelRatio()` between a floor and the current `min(devicePixelRatio,2)` cap instead of a single fixed value.
- Add a shader-warmup pass analogous to WoP's `core/ShaderWarmup.ts`: since `ExoplanetField` builds materials incrementally as clusters stream in, a first-time shader compile stall could still occur when the first Tier-1 planet with atmosphere+rings appears — warming up one instance of each material "shape" (Tier1 lava/rocky/gas/ice, Tier2, Tier3, atmosphere inner/outer, cloud) at load time would front-load that cost into the existing loading screen.
- Fix `getCacheKey()` in `textureGenerator.js` (`tasks/texture-improvements.md` 2I) to avoid `JSON.stringify` on the hot path.
- Migrate remaining synchronous, main-thread-blocking texture generator calls (`Planet.js`) to the async/worker versions already built for `ExoplanetField`.

### Workstream 7 — Illumination model overhaul (highest leverage-per-effort item found)
- **Kill or drastically weaken the two "infinite range, no-decay" point lights** — the camera headlamp (`Camera.js:29-31`) and the Sun's own point light (`SolarSystemField.js:231`). Both currently guarantee every visible planet surface is flatly lit from every angle, which is the single biggest reason planets read as "flat" today. At minimum, add real `decay` (e.g. `decay:2` with a tuned `distance` cutoff, or a manually-coded inverse-square falloff since `physicallyCorrectLights` is off) so illumination actually drops off with distance from the star.
- **Establish one dominant key light per body instead of three co-equal sources.** For the solar system, the Sun's point light should be the dominant term; ambient (`Scene.js:23`) and the fixed directional (`Scene.js:26-28`) should both drop well below it (WoP's ratio is roughly key:fill = 2.5:1.2, i.e. fill at ~half the key's intensity or less — SpAIce's current 0.4 directional + 0.6 ambient + 1.0 camera light + 5.0 sun light has no such hierarchy).
- **Feed a live sun/host-star direction into `AtmosphereShader.sunDirection`.** Currently initialized once to `(1,0,0)` and never updated per-frame from either `Planet.js` or `SolarSystemField.js` — wire `sunDirection.value` to the real vector from each planet to its star (origin, for the Sun; the host star's field position for exoplanets, once/if host stars get a visible position — see below) every frame, alongside the existing `updateAtmosphere()` call.
- **Give planet *surfaces* (not just atmosphere) a day/night terminator.** Two options, in increasing cost order: (a) cheapest — patch `MeshStandardMaterial` via `onBeforeCompile` (the same technique WoP uses for terrain emissive injection, `Terrain.ts:435-465`) to blend the existing night-lights emissive map in in exact anti-phase with a `dot(normal, sunDirection)` term, rather than relying on ambient/directional light alone to suppress it on the day side; (b) more involved — replace `MeshStandardMaterial` on planets with a small custom `ShaderMaterial` that does explicit Lambert shading from the live sun direction plus the existing texture maps, giving full control over terminator softness and rim-lit crescents.
- **Add a subtle rim light, independent of the atmosphere shader's own fresnel term**, analogous to WoP's dedicated low-intensity `rim` directional light — this keeps "rim highlight" as a lighting concern separate from "atmosphere glow," so airless rocky planets (which currently get zero atmosphere shader and thus zero rim treatment) can still read with a defined edge.
- **Replace the small additive fresnel glow sphere around the Sun with a cheap flare-sprite system** (canvas-gradient additive sprites + a few streak sprites, à la WoP's `makeSunTex`/`makeFlareTex`), computed via CPU dot-product/unproject rather than any GPU readback — visually reads as a proper sun instead of a soft blob, and is a "free" perf win relative to attempting real lens-flare occlusion queries.
- **Give exoplanet host stars a lighting presence.** Right now exoplanets have no visible host-star mesh/light at all — the background star field stands in visually, but nothing illuminates the planet from that direction. Even a cheap proxy (a small non-shadow-casting point or directional light placed at the host star's known 3D offset from its planet, reusing `coordinates_3d` data already computed per system) would let Workstream 2's per-planet atmosphere/terminator work actually have a real direction to shade against for exoplanets, not just solar-system bodies.
- **Consider a `PointLightPool`-style fixed light budget** if per-planet/per-host-star point lights are added per the item above — with 6,000+ potential emitters, an unbounded per-object `PointLight` count would blow both the shader-permutation cache and the light-loop cost; a small pool (e.g. 8-16 real lights) reassigned to the nearest visible host stars each frame, exactly as WoP's `PointLightPool` does for lanterns, keeps this bounded.

### Workstream 6 — Universe/data pipeline cleanups that unblock visual work
- Reconcile the two divergent exoplanet radius-scaling schemes (`PlanetClassifier.getScaledRadius()` vs. `SceneConstants.EARTH_RADIUS_SCALE`) so there is one authoritative scale function — needed before any LOD/instancing work buckets planets by size.
- Consider pre-baking the client-side-generated visual attributes (color/atmosphere/rings/flattening from `PlanetDataService.enrichPlanetData()`) into the cluster JSON at pipeline build time instead of recomputing them in every browser session — removes repeated CPU work on every load without changing the deterministic result (same hash-seeded values either way).
- Remove or wire up the orphaned `this._solarMode` flag in `main.js:31` — currently dead state that could confuse future scale-related work.

## Code References

- `src/core/Scene.js:22-28` — ambient + fixed-direction directional light, never updated per frame
- `src/core/Camera.js:28-31` — infinite-range, no-decay camera-attached point light ("headlamp")
- `src/objects/SolarSystemField.js:152-237` — Sun mesh, fresnel glow sphere, infinite-range no-decay Sun point light
- `src/core/Renderer.js:30-36,53-76` — renderer config, log-depth buffer, disabled shadows, bypassed composer
- `src/core/PostProcessing.js:36-49` — bloom strength 0.0, film grain, composer never called from render loop
- `src/config/SceneConstants.js:20-57` — unified scale constants, dual radius schemes, 2-tier LOD thresholds
- `src/shaders/AtmosphereShader.js:8-172` — atmosphere + cloud shaders, fixed per-call uniform constants
- `src/objects/Planet.js:72-361` — planet mesh/material/atmosphere/ring construction
- `src/objects/ExoplanetField.js:195-345,467-767` — tiered geometry cloning (no instancing), adaptive scale, texture LOD
- `src/services/PlanetVisualGenerator.js:21-209` — deterministic color/atmosphere/ring generation, solar overrides
- `src/services/PlanetDataService.js:47-92` — client-side visual enrichment at load time
- `pipelines/build_universe.py:95-261` — coordinate transform, classification, cluster bucketing
- `tasks/texture-improvements.md`, `tasks/camera-fixes.md` — existing, still-open visual/perf backlog
- World of Promptcraft: `scene/SceneManager.ts:120-232` (composer, adaptive quality, LOD/shadow-caster updates), `scene/Terrain.ts:887-1169` (frame-budgeted chunk building), `systems/worldbuilder/instanceBatch.ts` (InstancedMesh batching), `meshes/buildings/malaka/MalakaKit.ts:148-160` (3-level LOD), `core/ShaderWarmup.ts` (shader precompile), `scene/PointLightPool.ts` (fixed light-count shader key)

## Architecture Documentation

SpAIce's rendering architecture is fundamentally shaped by one constraint WoP does not have: a single camera must resolve both a 3-scene-unit Sun and an 8.48-million-scene-unit exoplanet in the same frustum. The `logarithmicDepthBuffer:true` setting (`Renderer.js:35`) is the load-bearing decision that makes this possible, and every other currently-disabled feature (shadows, bloom, composer) was disabled specifically because it conflicted with that setting, per the in-code comments. Any visual-improvement work here must treat "does this survive the log-depth buffer at 10-order-of-magnitude scale differences" as a first-class constraint — this is why WoP's patterns are useful as *technique* references (instancing, LOD, adaptive quality, shader warmup, frame budgeting) but not as literal ports for the parts of its pipeline that assume conventional depth precision (shadows, standard bloom).

## Open Questions

- Confirm whether `sunDirection` is truly never updated per-frame anywhere (grep across `Planet.js`/`SolarSystemField.js`/`main.js` found no `.sunDirection.value.set(...)` call) or whether it's set once at construction time from a real vector rather than the shader-module default `(1,0,0)` — worth a targeted re-check before Workstream 7 work starts, since if it's already fed a static-but-correct value the fix is smaller (just make it live) rather than starting from scratch.
- Root cause of the original bloom/log-depth "blinking artifacts" was not diagnosed here (out of scope for a documentation pass) — Workstream 1 above proposes it as the first concrete investigation before any post-processing re-enablement.
- Whether `GalaxyField.js` was removed for a fixable bug or a genuine design decision ("too much visual noise") is not resolved by the code alone — worth a direct question to whoever wrote commit `c8f5ad6`'s message, or trial-and-error re-enablement.

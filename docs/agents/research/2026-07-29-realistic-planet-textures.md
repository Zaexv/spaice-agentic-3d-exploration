---
date: 2026-07-29T21:02:21+00:00
git_commit: c8f5ad646e3c3306e7a17c2f8304779cbe927747
branch: fix-planets
topic: "How to give real/realistic textures to planets and exoplanets (real NASA maps, procedural, AI-generated)"
tags: [research, codebase, textures, rendering, ExoplanetField, SolarSystemField, ai-generation]
status: complete
---

# Research: Realistic Planet Textures (Real Maps, Procedural, AI)

## Research Question
How can we give real/realistic textures to the planets in this Three.js space exploration app? Options considered: real NASA/USGS texture maps, better procedural generation, AI-generated textures. Goal: really realistic space visuals.

## Summary

The app renders **two separate planet populations** with two separate texture pipelines:

1. **Solar system (9 bodies + Sun)** — `SolarSystemField.js` loads real 2k JPG maps from `public/textures/planets/` for the 8 classical planets. Earth additionally gets specular/normal/night-lights maps. Pluto and all moons fall back to flat colors. Textures were sourced at 2k (Solar System Scope naming convention: `2k_mercury.jpg` etc.).
2. **Exoplanets (6,126 across 17 lazy-loaded clusters)** — `ExoplanetField.js` renders them in 3 distance tiers. Only Tier 1 (<25 LY) ever gets textures, and only via **procedural 512px worker-generated noise textures** (rocky/gasGiant/iceGiant) applied asynchronously on LOD upgrade. Tiers 2–3 are flat/emissive colored spheres.

Real photographic textures for exoplanets do not exist (no telescope resolves an exoplanet surface), so "realism" there means either better procedural shaders or **pre-generated AI archetype textures** driven by real catalog data (radius/mass/temperature). This is exactly what NASA's own "Eyes on Exoplanets" does (procedural representation parametrized by catalog class).

Key external findings:
- **Solar System Scope** (CC BY 4.0) offers the full solar system in 2k **and 8k**, including maps this repo doesn't use yet: Earth 8k day/night/clouds/normal/specular, Venus surface, Moon, Sun, Saturn 8k ring alpha, Milky Way skybox. Straight upgrade path from current 2k files (same source/naming).
- **AI generation of equirectangular planet maps is practical and cheap offline**: FLUX.1-dev + equirectangular LoRA + 180°-shift seam inpainting; ~$0.03/image on Replicate → 100–200 archetype textures for ~$10–30 one-time. Runtime AI generation is a non-starter (cost per user, 5–30 s latency, needs key proxy).
- **Best procedural results by type**: gas giants (latitude gradient + domain-warped fBm) and lava worlds look excellent in shaders; earth-like planets are the hardest procedurally and benefit most from pre-generated textures.
- **GPU memory, not download size, is the real constraint**: 8k RGBA ≈ 134 MB decoded. KTX2/Basis compression (~6× smaller in VRAM) via `KTX2Loader`; mobile `MAX_TEXTURE_SIZE` often 4096.

## Detailed Findings

### 1. Current state — solar system pipeline

- `src/objects/SolarSystemField.js:277` `_createMaterial()` — loads diffuse map per body via `THREE.TextureLoader` (`:44`), sets `SRGBColorSpace`, `MeshStandardMaterial` roughness 0.8 / metalness 0.1.
- `src/objects/SolarSystemField.js:330` `_getTexturePath()` — hardcoded map for the 8 planets only. Moon/Pluto/15 moons → flat colors (`_getFallbackColor` `:347`).
- Earth extras at `:297-310`: specular JPG used as `metalnessMap`, normal map, night-lights `emissiveMap` (0xffaa44 @ 0.8).
- No `onError` fallbacks on any `load()` call.
- Assets on disk (`public/textures/planets/`): 2k JPGs for all 8 planets (78 KB–885 KB each), Earth set at 2048px, plus **unused** files: `2k_moon.jpg` (1.05 MB), `2k_venus_surface.jpg`, `2k_saturn_ring_alpha.png` (Saturn ring currently untextured — `_addExtras` `:366` uses plain `RingGeometry` with `MeshStandardMaterial` `:383`).
- Sun: `MeshBasicMaterial` + `CanvasTexture` (`:186-189`) + glow `ShaderMaterial` (`:205`).
- `src/objects/Planet.js:86-181` — an older/parallel per-planet loader mixing the same JPGs with sync `generateNormalMap()` calls; `PlanetTextureGenerator.js` (573 lines of per-planet canvas generators: `generateEarthTexture:56` … `generateVenusTexture:538`) is currently **unreferenced** as fallback.

### 2. Current state — exoplanet pipeline

- `src/objects/ExoplanetField.js:188` `create3DMeshes()` — batches of 30; three shared sphere geometries (32×24 / 16×12 / 12×8, `:195-202`), cloned + scaled per planet.
- Tier assignment `:234-236`: <25 LY → Tier 1, <100 LY → Tier 2, else Tier 3.
- Tier 1 `:250-290`: `MeshStandardMaterial` with composition-derived base color (`getColorByComposition`), subtype-based roughness/emissive (lava/hot-Jupiter: red emissive 0.3). Texture arrives later via LOD.
- Tier 2 `:301`: flat color, no textures ever. Tier 3 `:327`: emissive color material **shared** via `distantMaterials` map keyed by color; Tiers 1–2 do not share materials.
- LOD upgrade `:653-657` → `upgradeToHighResTexture()` `:670`: picks generator by `planetType` — `generateGasGiantTextureAsync` / `generateIceGiantTextureAsync` / `generateRockyTextureAsync`, all **hardcoded 512px**, plus `generateNormalMapAsync`. Applied via `Promise.all` `:702`; resets color to white, roughness 0.8.
- Downgrade `:736` disposes maps, returns to emissive color ("shine like stars").
- Generators: `src/utils/textureGenerator.js` (869 lines) — worker-backed async (`:232-278`), sync fallbacks (`:314-498`), plus cloud/ring/night-lights/craters/star generators (`:548-763`). Worker `src/workers/textureWorker.js` handles only 4 task types (rocky/gas/ice/normal). DataTextures created **without mipmaps** (`textureGenerator.js:27-36`).
- Duplicate noise code across `textureGenerator.js:287-309`, `PlanetTextureGenerator.js:9-51`, and worker (known tech debt; see `tasks/texture-improvements.md`).

### 3. Current state — renderer/lighting (caps perceived realism)

- `src/core/Renderer.js:31-38`: antialias **off**, `logarithmicDepthBuffer: true`, pixelRatio ≤ 2.
- `:56-61`: `physicallyCorrectLights = false`, shadows off, **LinearToneMapping** (not ACES), exposure 1.2.
- `:73-77`: render loop bypasses `PostProcessing.js` entirely (comment cites log-depth blinking artifacts); `UnrealBloomPass` exists but strength hardcoded 0.0 (`src/core/PostProcessing.js:39-44`).
- Lighting: ambient 0.6 + directional 0.4 (`src/core/Scene.js:23-26`), camera-attached PointLight 1.0 (`src/core/Camera.js:29`), sun PointLight intensity 5 (`SolarSystemField.js:231`). High ambient + camera light flattens texture shading.

### 4. Existing improvement plan

`tasks/texture-improvements.md` (2026-03-31) — 10 sub-tasks: noise consolidation (2A), sync→async migration (2B), configurable exoplanet texture resolution (2C), stale Mars bug (2D — code no longer exists), `onError` fallbacks (2E), lava emissive maps (2F), mipmaps for worker DataTextures (2G), roughness worker task (2H), cache-key fix (2I), atmosphere-tinted clouds (2J). All still procedural-quality work; none introduces real or AI textures.

### 5. Real texture sources (solar system)

| Source | What | License |
|---|---|---|
| [Solar System Scope](https://www.solarsystemscope.com/textures/) | All 8 planets 2k/8k, Earth day/night/clouds/normal/specular, Moon, Sun, Saturn ring alpha PNG, Venus surface, Milky Way | **CC BY 4.0** — safe to commit |
| [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) | Moon color up to 16k + LOLA displacement maps (2025 refresh: EXR/16-bit) | Public domain |
| [NASA Blue Marble](https://science.nasa.gov/earth/earth-observatory/collections/blue-marble) | Earth up to 86400×43200, monthly variants, Black Marble night lights up to 54000px, cloud maps | Public domain |
| [USGS Astropedia](https://astrogeology.usgs.gov/search) | Scientific mosaics: Mercury, Venus (Magellan), Mars Viking 232m, MOLA DEM, Galilean moons, Pluto/Charon | Public domain |
| [Björn Jónsson](https://bjj.mmedia.is/planetary_maps.html) | Reference-grade Jupiter (Cassini+Juno), Saturn + rings, Io/Europa/etc. | Free w/ attribution; prefers linking over re-hosting |
| [Planet Pixel Emporium](https://planetpixelemporium.com/planets.html) | Full sets incl. bump/spec/night | Free to *use* but **no redistribution** — avoid in public repo |

Download pattern for SSS: `https://www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg`, `.../8k_saturn_ring_alpha.png`, etc. Current repo files already follow SSS 2k naming — 8k upgrade is a drop-in.

Practical web constraints: 8k JPG ≈ 5–20 MB file but ≈134 MB decoded on GPU (+33% mipmaps); mobile `MAX_TEXTURE_SIZE` often 4096. Recommended: 2k default, 4k/8k behind `renderer.capabilities.maxTextureSize` check, or KTX2/Basis (ETC1S for color, UASTC for normals) via `KTX2Loader` for ~6× VRAM savings.

### 6. AI-generated textures (exoplanets)

- **Seam problem**: planet maps must wrap horizontally at 0/360°; poles need low-frequency detail or they pinch at the UV singularity. Standard fix: generate → shift 180° → inpaint seam → upscale; blur/flatten top+bottom ~5–8% for poles. Gas giants sidestep both (bands are horizontally uniform).
- **Best current route (July 2026)**: FLUX.1-dev + [equirectangular 360 LoRA (Civitai 735980)](https://civitai.com/models/735980/flux-equirectangular-360-panorama) with the [seam-fix ComfyUI workflow (745010)](https://civitai.com/models/745010/flux-equirectangular-360-panorama-workflow); SDXL alternative with **circular padding in X** (asymmetric tiling) is cleanest technically. Midjourney `--tile` unsuitable (square tiles, no API). gpt-image has no tiling mode (manual seam fix possible).
- **Cost** (per image): FLUX schnell $0.003, FLUX dev $0.03, FLUX 1.1 pro $0.04 (Replicate); Stable Image Core $0.03; gpt-image-1-mini $0.005, gpt-image-1.5 high ~$0.13. **200 archetypes ≈ $6–26 one-time** (2–3× with seam-fix passes → still <$75). Runtime generation rejected: per-user cost, 5–30 s latency, needs server-side key proxy, unreviewed output.
- **Archetype scheme** (matches NASA's own categories): radius <1.25 R⊕ terrestrial, 1.25–2 super-Earth, 2–6 Neptunian, >6 gas giant; then T_eq buckets (>1000 K lava/hot-Jupiter, 250–350 K temperate, <150 K icy). ~4 size × ~4 temp × variants → 50–200 textures; per-planet deterministic seed (hue shift, rotation) for uniqueness. The repo's data already carries `planetType`, `planetSubType`, `pl_eqt`, `pl_rade`, `pl_masse`, `color`, `detailColor` — classification inputs all present.
- **Precedent**: [NASA Eyes on Exoplanets](https://eyes.nasa.gov/apps/exo/) renders every exoplanet as a procedurally-generated representation parametrized by catalog class (Unity WebGL). NASA's per-planet "photos" are artist concepts (Robert Hurt/Tim Pyle, IPAC), not real images.

### 7. Procedural state of the art (WebGL/Three.js)

- Reference repos: [dgreenheck/threejs-procedural-planets](https://github.com/dgreenheck/threejs-procedural-planets), [wwwtyro/planet-3d](https://github.com/wwwtyro/planet-3d) (also 2D sprites for far LOD), [jsulpis/realtime-planet-shader](https://github.com/jsulpis/realtime-planet-shader), [Deep-Fold/PixelPlanets](https://github.com/Deep-Fold/PixelPlanets) (shader recipes per planet type).
- **Gas giant recipe** ([Paléologue](https://medium.com/@barth_29567/procedural-gas-giants-f2a61bc6bd97)): 1D latitude color gradient + domain-warped 3D simplex fBm + optional vortex spot. Looks genuinely realistic; better than diffusion output for this class.
- Realism ranking shader-only: gas giants excellent, lava very good (fBm cracks + emissive), icy good, rocky good, **earth-like worst** (needs continents/oceans/biomes/clouds — this is where AI/artist textures win).
- **Seamless-by-construction trick**: sample 3D noise at sphere-surface positions, write to equirect UV → no seams, no pole pinch. Current worker generates 2D noise; this technique would remove wrap artifacts.
- Performance: per-planet unique materials = per-planet draw calls (current Tier 1/2 behavior). Better: one shared `ShaderMaterial` with per-instance attributes (seed/palette/type) on `InstancedMesh`, or `DataArrayTexture` atlas indexed per instance → one draw call for mid-distance planets. 200 archetype textures at 1024×512 KTX2 keeps VRAM sane; at 2048×1024 RGBA uncompressed it's ~8 MB each → 1.6 GB for 200 (must compress or reduce).

## Code References

- `src/objects/SolarSystemField.js:277-342` — real-texture material creation + hardcoded path map
- `src/objects/SolarSystemField.js:297-310` — Earth multi-map setup
- `src/objects/SolarSystemField.js:366-383` — Saturn ring (untextured despite `2k_saturn_ring_alpha.png` on disk)
- `src/objects/ExoplanetField.js:188-343` — tiered mesh/material creation for 6,126 exoplanets
- `src/objects/ExoplanetField.js:646-663` — LOD texture upgrade/downgrade trigger
- `src/objects/ExoplanetField.js:670-731` — procedural 512px upgrade path
- `src/utils/textureGenerator.js:27-36` — worker DataTexture wrap (no mipmaps)
- `src/utils/textureGenerator.js:232-278` — async generator API
- `src/utils/PlanetTextureGenerator.js:56-538` — unused per-planet canvas generators
- `src/workers/textureWorker.js:195-204` — 4 supported task types
- `src/core/Renderer.js:56-77` — tone mapping, no post-processing in loop
- `src/core/PostProcessing.js:39-44` — bloom built but strength 0.0
- `src/config/SceneConstants.js:52-57` — LOD distances (HIGH 50M ≈ 25 LY, MEDIUM 200M ≈ 100 LY)
- `tasks/texture-improvements.md` — existing 10-sub-task procedural improvement plan

## Architecture Documentation

Texture flow today: solar bodies → static JPG via TextureLoader; exoplanets → color-only material at creation, procedural DataTexture swapped in when camera <25 LY, swapped out >100 LY. Worker-based generation keeps main thread free; texture cache keyed by `JSON.stringify(params)`. Material sharing only at Tier 3. Rendering intentionally bypasses the EffectComposer due to log-depth-buffer artifacts.

## Recommended Path (user asked for options)

Layered plan, independent phases, each visible improvement:

1. **Solar system — real 8k/4k maps (biggest instant win, ~1 day)**: upgrade existing SSS 2k files to 4k (8k behind `maxTextureSize` check); add unused-on-disk Moon + Saturn ring alpha + Venus surface; add Earth 8k clouds layer + night map; Jupiter from Björn Jónsson (credit). All CC BY/public domain.
2. **Renderer realism (cheap multiplier)**: ACESFilmicToneMapping, drop ambient to ~0.1–0.2, remove camera PointLight in solar context, let the sun PointLight drive shading; enable bloom (strength >0) for sun/stars once log-depth issue addressed.
3. **Exoplanets — archetype system**: classify by `pl_rade`/`pl_eqt`/`pl_masse` into ~16–20 archetypes; pre-generate ~100–200 equirect maps offline with FLUX.1-dev + equirect LoRA (+seam fix) for terrestrial/super-Earth/ice classes (~$10–30 one-time, ship as KTX2 at 1024×512); keep/upgrade GLSL shaders for gas giants + lava (latitude-gradient + domain-warped fBm — better than AI for these). Per-planet seed for hue/rotation variety.
4. **Performance guardrails**: mipmaps on worker DataTextures (task 2G), KTX2 compression, texture-array + instancing for mid-tier if draw calls become the bottleneck.

## Open Questions

- KTX2 toolchain fit with current GitHub Pages/Cloudflare deploy (file-size splitting already needed for cluster JSONs).
- Whether log-depth-buffer vs post-processing conflict is fixable (needed for bloom); alternative: selective bloom via layers or CSS glow sprites.
- `Planet.js` vs `SolarSystemField.js` duplication — which is the live path for solar bodies going forward (both load same JPGs).
- Whether Tier 2 (25–100 LY) should get archetype textures too (currently flat color) — depends on draw-call budget after instancing work.

## Follow-up Research 2026-07-29T21:16 — No-AI Algorithmic Planet Generation

User direction: drop the AI-generation route entirely. Design a pure algorithm that shapes each planet from its real catalog data.

### Root cause of current "noise soup" look

`src/workers/textureWorker.js:9-13` — `noise2D` is a **hash function (white noise)**, not interpolated gradient noise. fBm over white noise has no spatial coherence → no continents, bands, or features possible at any octave count. Also: textures generated square 512×512 (equirect needs 2:1), in 2D UV space (guarantees seam at 0/360° + pole pinch), with no per-planet seed (all rocky planets identical pattern).

### Algorithm design: "Planet Forge" — deterministic planet from catalog row

Every planet's look derives from real NASA data + a deterministic seed. No stored textures, no AI, infinite variety, reproducible.

**Stage 0 — Seed & classify (JS, per planet)**
- `seed = fnv1a(pl_name)` — deterministic; same planet always looks the same.
- Size class from `pl_rade`: <1.25 R⊕ terrestrial · 1.25–2 super-Earth · 2–6 Neptunian · >6 gas giant (NASA's own bins).
- Thermal class from `pl_eqt`: >1000 K lava/hot-Jupiter · 320–1000 K desert/clear-giant · 240–320 K temperate · 150–240 K cold · <150 K ice/ammonia-giant.
- Cross product → ~14 archetypes (terrestrial-lava, terrestrial-temperate, ocean world, desert, ice world, barren-cratered, gas giant ammonia/water/clear/hot, ice giant, etc.). Existing fields `planetType`/`planetSubType`/`characteristics.principal_material` slot in as overrides.
- Physical color anchors (real astronomy): clear hot Jupiters near-black (TrES-2b albedo <1%, Na/K absorption); ~30% random subpopulation bright silicate clouds (Kepler-7b 0.35); HD 189733b-style Rayleigh blue for 900–1500 K; methane blue for cold giants; star-temperature illumination tint (M dwarf warm orange, lerp ≤50%).

**Stage 1 — Sample field on sphere (seam/pole-free by construction)**
For each texel of a 512×256 (2:1) target: `lat/lon → p = (cosLat·cosLon, sinLat, cosLat·sinLon)`; sample **3D simplex fBm** at `p·freq + seedOffset`. Continuous on sphere → zero seams, poles converge naturally. Texel centers at `(x+0.5)/W`. This replaces all 2D UV-space generation.

**Noise stack** (shared module, worker + GLSL versions):
- 3D simplex (replace value/hash noise); fBm with gain 0.5, lacunarity 1.99 (non-integer breaks octave alignment), 5–7 octaves capped at texture Nyquist.
- Ridged: `(1−|n|)²` for mountains/cracks/lava veins.
- Billow: `2|n|−1` for clouds.
- Domain warp (IQ): `f = fbm(p + W·q)`, `q = (fbm(p), fbm(p+o1), fbm(p+o2))`; W 0.5–2 geological, ~4 turbulent.
- 3D Voronoi/cellular for craters (per-feature-point radius/depth).

**Stage 2 — Height field → coherent maps** (one height field drives everything):
- Albedo: hypsometric ramp lookup (per-archetype 1D LUT), jittered `h += 0.04·fbm(p·20)` against banding.
- Normal map: central differences on height, **dhdx ÷ cos(lat)** pole correction, wrap X.
- Roughness: from height band + slope (water 0.15, rock 0.95, ice 0.35) — packed into spare channel.
- Emissive mask: lava veins / night lights / hot-Jupiter dayside in alpha or second texture.

**Stage 3 — Per-archetype recipes** (concrete, from libnoise complexplanet + Lague + Paléologue):
- *Terrestrial temperate*: continent mask = warped low-freq fBm threshold (seaLevel knob sets ocean %); mountains = ridged fBm gated by separate low-freq mask (10–25% of land); hypsometric ramp deep-ocean→shelf→beach→plains→rock→snow; polar caps by `|p.y|` + noise scaled by (1 − T_eq/288); ocean specular via water mask → roughness 0.15; optional cloud sphere at 1.01R (billow, coverage knob, `p.y×1.6` zonal stretch).
- *Barren/cratered*: dust-tone fBm mix + crater profile per Voronoi feature point: `cavity = x²−1`, rim `= rimSteepness·min(x−1−rimWidth,0)²`, blended with IQ smoothMin/Max; 2–3 size octaves (count ∝ D⁻²); darkened floors, brightened rims.
- *Lava world*: dark basalt base; veins = `smoothstep(0.55,0.75, ridged(fbm(p·3 + 4·warp)))`; emissive ramp #ff2d00→#ffe08a; intensity `clamp((T_eq−700)/1500,0,1)`; molten fraction widens with T_eq.
- *Ice world*: near-white base, low roughness; lineae = `pow(1−|warped simplex|, 12)` at two frequencies, rust-tinted (Europa salts).
- *Gas giant* (Paléologue): stretch `p.y×2.5`; `band = fbm(latitude ± 2·fbm3(p))` → mix 2–3 band colors via smoothstep; seed in 4th noise dim; great-spot = rotate domain around spot axis, angle `∝ (1−d/R)²`, ellipse metric; palette + band count from thermal class table.
- *Ice giant*: same, warp 0.5–0.8, band contrast 10–20%, methane blue base, faint storm streaks ±30–40° lat.
- *Ocean/desert variants*: seaLevel +0.8 island chains / dune striping `sin(dot(p,windDir)·80 + 3·fbm)`.

**Stage 4 — Execution pipeline (two backends, same recipes)**
- **GPU bake (preferred)**: one uber-`ShaderMaterial` (uniforms: seed, archetype, T_eq params, palette), fullscreen triangle → `WebGLRenderTarget` 512×256 (1024×512 hero); ~0.2–2 ms/planet → hundreds/sec; `renderTarget.texture` used directly, no readback; bake 4–8/frame idle. Second pass bakes normal map from height target.
- **CPU worker (fallback + current infra)**: same recipes in JS; 512×256 ≈ 30–120 ms/planet off-thread. Keep existing worker plumbing, replace generator bodies; add task types per archetype; enable mipmaps on DataTextures (task 2G).
- **Pooling**: don't give all 6,126 unique textures. Quantize (archetype, palette bucket, seed mod N) → pool ~150–300 shared textures for Tier 1 field; bake truly-unique texture lazily only for approached planet (ProximityDetector exists). 512×256 RGBA ≈ 0.7 MB GPU → pool ≈ 100–200 MB.
- **Optional close-up shape**: cube-sphere + vertex displacement `pos = dir·R·(1 + amp·H(dir))` sampling same 3D noise — only for nearest 1–3 planets.

**Integration points**
- `src/workers/textureWorker.js` — replace noise + generators (root fix).
- `src/utils/textureGenerator.js:232-278` — new async API per archetype; mipmaps at `:27-36`.
- `src/objects/ExoplanetField.js:670` `upgradeToHighResTexture()` — pass full catalog row (seed, T_eq, class) instead of 2 colors; apply roughness/emissive from recipe instead of hardcoded 0.8.
- New `src/utils/noiseUtils.js` (task 2A) hosts shared simplex/fBm/ridged/billow/warp for main thread + inlined worker copy.
- Solar system stays on real 2k/8k maps (separate pipeline, unchanged).

### Sources (follow-up)
- [IQ fBm](https://iquilezles.org/articles/fbm/) · [IQ domain warp](https://iquilezles.org/articles/warp/) · [IQ smooth voronoi](https://iquilezles.org/articles/smoothvoronoi/)
- [libnoise complex planet pipeline](https://libnoise.sourceforge.net/examples/complexplanet/index.html) · [complexplanet.cpp](https://github.com/qknight/libnoise/blob/master/examples/complexplanet.cpp)
- [Sebastian Lague Procedural Planets](https://github.com/SebLague/Procedural-Planets) · [Solar System repo](https://github.com/SebLague/Solar-System) (crater profile, ridged masks, cube-sphere LOD)
- [Paléologue procedural gas giants](https://medium.com/@barth_29567/procedural-gas-giants-f2a61bc6bd97) · [Whigham gas giants (1D LUT + cyclones)](http://johnwhigham.blogspot.com/2011/11/gas-giants.html)
- [Sagristà procedural planetary surfaces (GPU bake, elevation×humidity LUT)](https://tonisagrista.com/blog/2021/procedural-planetary-surfaces/)
- [Red Blob planet generation (plate tectonics upgrade path)](https://www.redblobgames.com/x/1843-planet-generation/)
- Exoplanet color astronomy: [HD 189733b blue (Evans 2013)](https://ui.adsabs.harvard.edu/abs/2013ApJ...772L..16E/abstract) · [TrES-2b darkest](https://en.wikipedia.org/wiki/TrES-2b) · [Kepler-7b cloud map (Demory 2013)](https://ui.adsabs.harvard.edu/abs/2013ApJ...776L..25D/abstract) · [hot Jupiter albedos (Schwartz & Cowan 2015)](https://arxiv.org/pdf/1502.06970)
- [Procedural planet generator survey (arXiv 2025)](https://arxiv.org/html/2510.24764v1)

## Sources

- [Solar System Scope Textures](https://www.solarsystemscope.com/textures/) · [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) · [NASA Blue Marble](https://science.nasa.gov/earth/earth-observatory/collections/blue-marble) · [USGS Astropedia](https://astrogeology.usgs.gov/search) · [Björn Jónsson maps](https://bjj.mmedia.is/planetary_maps.html) · [Planet Pixel Emporium](https://planetpixelemporium.com/planets.html)
- [Flux Equirect 360 LoRA](https://civitai.com/models/735980/flux-equirectangular-360-panorama) · [Seam-fix workflow](https://civitai.com/models/745010/flux-equirectangular-360-panorama-workflow) · [Replicate FLUX pricing](https://replicate.com/blog/flux-state-of-the-art-image-generation) · [Image API pricing comparison 2026](https://www.digitalapplied.com/blog/ai-image-generation-api-pricing-comparison-2026)
- [Eyes on Exoplanets](https://eyes.nasa.gov/apps/exo/) · [The Art of Exoplanets (JPL)](https://www.jpl.nasa.gov/news/the-art-of-exoplanets/)
- [Procedural Gas Giants](https://medium.com/@barth_29567/procedural-gas-giants-f2a61bc6bd97) · [dgreenheck/threejs-procedural-planets](https://github.com/dgreenheck/threejs-procedural-planets) · [wwwtyro/planet-3d](https://github.com/wwwtyro/planet-3d) · [Deep-Fold/PixelPlanets](https://github.com/Deep-Fold/PixelPlanets)
- [Codrops: Three.js instancing](https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/) · [Discover three.js tips](https://discoverthreejs.com/tips-and-tricks/)

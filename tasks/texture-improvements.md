# Task 2: Planet Textures — Fix, Consolidate & Enhance

> **Source:** `tasks/improvements.md` — Section 2 (Texture Improvements)
> **Goal:** Fix texture bugs, consolidate duplicate code, and add missing texture features (roughness maps, emission maps, mipmaps, cloud colours).
> **Priority:** Medium-High — visual quality and code health.

---

## Relevant Files

| Status | File | Purpose |
|---|---|---|
| **MODIFY** | `src/utils/textureGenerator.js` (870 lines) | Core procedural texture pipeline — sync + async generators |
| **MODIFY** | `src/utils/PlanetTextureGenerator.js` (574 lines) | Solar-system-specific procedural textures |
| **MODIFY** | `src/objects/Planet.js` (400 lines) | Planet mesh creation, material assignment, cloud/ring setup |
| **MODIFY** | `src/objects/ExoplanetField.js` (778 lines) | Exoplanet rendering, LOD system, texture upgrades |
| **MODIFY** | `src/workers/textureWorker.js` | Web Worker for async texture generation |
| **NEW** | `src/utils/noiseUtils.js` | Shared `noise2D`, `fbm`, `valueNoise`, `lerp`, `smoothStep` functions |

---

## Sub-tasks

Each sub-task is designed to be **independently executable** by a separate agent, with clear file boundaries and no merge conflicts when they touch different sections.

---

### 2A — Consolidate duplicate `noise2D` / `fbm` functions into `noiseUtils.js`

**Files:**
- **NEW:** `src/utils/noiseUtils.js`
- **MODIFY:** `src/utils/textureGenerator.js` (lines 287–309)
- **MODIFY:** `src/utils/PlanetTextureGenerator.js` (lines 9–51)

**Problem:** Both files implement identical `noise2D` and `fbm` functions. `PlanetTextureGenerator.js` also has `lerp`, `smoothStep`, and `valueNoise` (a higher-quality interpolated noise). This duplication is called out as known tech debt in `Agents.md`.

**Changes:**

1. **Create `src/utils/noiseUtils.js`** with all shared noise functions:
   ```js
   // Pure math functions — no THREE.js dependency, no state
   export function noise2D(x, y) { /* ... */ }
   export function lerp(a, b, t) { /* ... */ }
   export function smoothStep(t) { /* ... */ }
   export function valueNoise(x, y) { /* ... */ }
   export function fbm(x, y, octaves = 6) { /* ... */ }
   ```
   Use the **higher-quality** `valueNoise`-based `fbm` from `PlanetTextureGenerator.js` as the canonical implementation (it uses smoothstep interpolation, producing smoother textures).

2. **`textureGenerator.js`** — Remove lines 287–309, import from `noiseUtils.js`.
3. **`PlanetTextureGenerator.js`** — Remove lines 9–51, import from `noiseUtils.js`.

**Test:** `npm run build` — ensure no broken imports. Visual regression: compare a rocky planet texture before/after — should be identical (or marginally smoother from the upgraded noise function).

> ⚠️ **Agent note:** The worker (`textureWorker.js`) has its OWN copy of noise functions embedded. That file runs in a Web Worker context and cannot import ES modules from the main thread. Do NOT touch the worker in this sub-task — see **2H** instead.

---

### 2B — Move sync texture generators to Web Worker

**File:** `src/utils/textureGenerator.js` (lines 314–498)

**Problem:** `generateRockyTexture`, `generateGasGiantTexture`, `generateIceGiantTexture`, and `generateNormalMap` all run synchronously on the main thread. For 512px textures, each takes 20–50ms, causing visible jank during planet transitions.

**Changes:**

1. Replace all call-sites of the sync generators in `Planet.js` with their `Async` counterparts:
   - `generateRockyTexture(...)` → `await generateRockyTextureAsync(...)`
   - `generateGasGiantTexture(...)` → `await generateGasGiantTextureAsync(...)`
   - `generateIceGiantTexture(...)` → `await generateIceGiantTextureAsync(...)`
   - `generateNormalMap(...)` → `await generateNormalMapAsync(...)`

2. Make `createPlanet()` in `Planet.js` async — it already calls sync texture functions. Wrap the texture generation in `async/await` and apply materials once textures resolve.

3. **Keep** the sync functions in `textureGenerator.js` (don't delete them) but mark them as `@deprecated` in JSDoc — they serve as fallbacks.

**Test:** Load the app, navigate to a solar system planet. Verify textures still render correctly. Check browser DevTools Performance tab for reduced main-thread blocking.

**Dependencies:** Can run in parallel with all other sub-tasks except 2A (if 2A changes the function signatures, this must adapt).

---

### 2C — Add configurable texture resolution for exoplanets

**File:** `src/objects/ExoplanetField.js`, `src/config/config.js`

**Problem:** All exoplanet textures are generated at a fixed 512px resolution in `upgradeToHighResTexture()` (line 668). Nearby or highlighted exoplanets could benefit from 1024px textures, while distant ones waste GPU memory at 512px.

**Changes:**

1. **`src/config/config.js`** — Add texture config:
   ```js
   textures: {
       exoplanetHighRes: Number(getEnvVar('VITE_EXOPLANET_HIGH_RES')) || 512,
       exoplanetLowRes: Number(getEnvVar('VITE_EXOPLANET_LOW_RES')) || 256,
   },
   ```

2. **`ExoplanetField.js`** — In `upgradeToHighResTexture()`, replace hardcoded `512`:
   ```js
   const texSize = CONFIG.textures?.exoplanetHighRes ?? 512;
   texturePromise = generateRockyTextureAsync(colors.base, colors.detail, texSize);
   ```

3. **`.env.example`** — Document:
   ```env
   VITE_EXOPLANET_HIGH_RES=512   # Texture resolution for nearby exoplanets (default: 512)
   VITE_EXOPLANET_LOW_RES=256    # Texture resolution for medium-distance exoplanets
   ```

**Test:** Set `VITE_EXOPLANET_HIGH_RES=1024`, fly near a planet — texture should be noticeably sharper. Set to `128` — should be visibly pixelated (confirming the config works).

---

### 2D — Fix Mars `normalMap` promise bug in `ExoplanetField`

**File:** `src/objects/ExoplanetField.js`
**Lines:** 228–234

**Problem:** The Mars branch in `create3DMeshes()` calls `generateNormalMapAsync()` but assigns the **Promise** (not the texture) to a variable, and then uses a `.then()` that references `mesh` — but `mesh` doesn't exist yet at that point (it's created later on line 361):

```js
case 'Mars':
    texture = this.textureLoader.load('./textures/planets/mars/2k_mars.jpg');
    texture.colorSpace = THREE.SRGBColorSpace;
    normalMap = generateNormalMapAsync(512, 2.5).then(t => { if (mesh.material) mesh.material.normalMap = t; });
    // ↑ normalMap is a Promise, not a texture!
    // ↑ 'mesh' doesn't exist yet — ReferenceError
    useRealTextures = true;
    break;
```

**Fix:** Use a post-creation callback pattern:

```js
case 'Mars':
    texture = this.textureLoader.load('./textures/planets/mars/2k_mars.jpg');
    texture.colorSpace = THREE.SRGBColorSpace;
    useRealTextures = true;
    // normalMap will be applied asynchronously after mesh is created
    break;
```

Then, after the mesh is created (after line 361), apply the normal map:

```js
// Apply async normal maps for solar system planets
if (isSolarPlanet && planet.pl_name === 'Mars') {
    generateNormalMapAsync(512, 2.5).then(normalTex => {
        if (mesh.material) {
            normalTex.wrapS = THREE.RepeatWrapping;
            normalTex.wrapT = THREE.RepeatWrapping;
            mesh.material.normalMap = normalTex;
            mesh.material.needsUpdate = true;
        }
    });
}
```

**Test:** Fly to Mars — verify normal map is applied (surface should have visible bumps/relief). Check console for no `ReferenceError`.

---

### 2E — Add `onError` fallback for texture file loading

**Files:** `src/objects/Planet.js` (lines 95–156), `src/objects/ExoplanetField.js` (lines 214–266)

**Problem:** `TextureLoader.load()` is called without an `onError` callback. If texture files are missing (e.g., production build without assets), planets render as black/grey with no indication why.

**Changes:** Add `onError` fallback to every `textureLoader.load()` call that falls back to the corresponding `PlanetTextureGenerator` function:

```js
// Example for Earth in Planet.js:
texture = this.textureLoader.load(
    './textures/planets/earth/earth_day_2048.jpg',
    undefined,  // onLoad (use default)
    undefined,  // onProgress
    (err) => {
        logger.warn(`[Planet] Failed to load Earth texture, using procedural fallback: ${err.message}`);
        const fallback = generateEarthTexture(1024);
        this.mesh.material.map = fallback;
        this.mesh.material.needsUpdate = true;
    }
);
```

Apply the same pattern for Mars (`generateMarsTexture`), Jupiter (`generateJupiterTexture`), Saturn, Neptune, Uranus, Venus in **both** `Planet.js` and `ExoplanetField.js`.

**Test:** Temporarily rename a texture file (e.g., `earth_day_2048.jpg` → `earth_day_2048.jpg.bak`), load the app — Earth should render with the procedural fallback texture instead of appearing black.

---

### 2F — Add emission map for lava-world exoplanets

**File:** `src/objects/ExoplanetField.js` (lines 198–202)

**Problem:** Lava worlds have `emissive = 0xff0000` with `emissiveIntensity = 0.3`, but no `emissiveMap`. The glow is uniform — lava worlds should have bright lava flows on dark basalt.

**Changes:**

1. **`src/utils/textureGenerator.js`** — Add a new function:
   ```js
   export function generateLavaEmissiveTexture(size = 512) {
       // Use fbm noise to create bright vein-like lava flows
       // Dark areas (basalt) = low emission
       // Bright veins (lava) = high emission (oranges, reds, yellows)
       // Use domain warping for more organic flow patterns
   }
   ```

2. **`src/workers/textureWorker.js`** — Add `'lava'` task type.

3. **`src/utils/textureGenerator.js`** — Add async wrapper:
   ```js
   export async function generateLavaEmissiveTextureAsync(size = 512) {
       return runWorkerTask('lava', { size });
   }
   ```

4. **`ExoplanetField.js`** — In `upgradeToHighResTexture()`, detect lava worlds and generate + apply the emissive map:
   ```js
   if (planetData.planetSubType === 'lava_world') {
       generateLavaEmissiveTextureAsync(texSize).then(emissiveTex => {
           mesh.material.emissiveMap = emissiveTex;
           mesh.material.emissive.setHex(0xff4400);
           mesh.material.emissiveIntensity = 0.8;
           mesh.material.needsUpdate = true;
       });
   }
   ```

**Test:** Fly near a lava-world exoplanet (high temperature, > 1200K). It should glow with visible lava flow patterns, not a flat red tint.

---

### 2G — Add `MipMap` generation for procedural `DataTexture` instances

**File:** `src/utils/textureGenerator.js` (lines 27–36)

**Problem:** `DataTexture` instances returned from the worker don't have mipmaps enabled. At long distances, textures appear noisy/aliased instead of smoothly blended.

**Fix:** In the `worker.onmessage` handler, add mipmap settings:

```js
if (success) {
    const texture = new THREE.DataTexture(
        data, width, height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
    );
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    resolve(texture);
}
```

**Test:** Fly far from a textured exoplanet — distant planets should look smooth instead of having shimmering/moiré patterns.

---

### 2H — Add `roughness` task type to texture worker

**File:** `src/workers/textureWorker.js`

**Problem:** The worker only handles `rocky`, `gas`, `ice`, and `normal` task types. There's no way to generate a roughness map off the main thread.

**Changes:**

1. Add a `roughness` case to the worker's message handler:
   ```js
   case 'roughness': {
       // Generate grayscale roughness map from fbm noise
       // High roughness for rock/land (bright)
       // Low roughness for ice/water (dark)
       // Input: { size, seed } — seed used to vary patterns per planet
       const { size, seed = 0 } = params;
       // ... generate RGBA data where R=G=B=roughness, A=255
       break;
   }
   ```

2. Add async wrapper in `textureGenerator.js`:
   ```js
   export async function generateRoughnessMapAsync(size = 512, seed = 0) {
       return runWorkerTask('roughness', { size, seed });
   }
   ```

3. Wire into `ExoplanetField.upgradeToHighResTexture()` for rocky planets:
   ```js
   if (planetType === 'rocky') {
       generateRoughnessMapAsync(texSize, hashPlanetName(planetData.pl_name)).then(roughTex => {
           mesh.material.roughnessMap = roughTex;
           mesh.material.needsUpdate = true;
       });
   }
   ```

**Test:** Fly near a rocky exoplanet — surface should have varied shininess (glossy where ice/water would be, matte where rock is).

---

### 2I — Optimize texture cache key

**File:** `src/utils/textureGenerator.js` (line 61)

**Problem:** `getCacheKey()` uses `JSON.stringify(params)` which is slow for objects with many properties and produces inconsistent keys for objects with different property ordering.

**Fix:** Replace with a deterministic template-literal key:

```js
function getCacheKey(type, params) {
    // Only the fields that affect the texture output matter
    const { baseColor, detailColor, colors, size, cloudColor, color1, color2, density, strength } = params;
    const colorStr = colors ? colors.join('_') : `${baseColor || 0}_${detailColor || 0}`;
    return `${type}_${colorStr}_${size || 512}_${cloudColor || 0}_${color1 || 0}_${color2 || 0}_${density || 0}_${strength || 0}`;
}
```

**Test:** Profile the app with many planets. `getCacheKey` calls should be negligible in the flame chart.

---

### 2J — Pass atmosphere colour into cloud texture generation

**File:** `src/objects/Planet.js` (lines 296–315)

**Problem:** Non-Earth habitable exoplanets with clouds use `generateCloudTexture()` with the default white color, regardless of their atmosphere composition. A methane-atmosphere planet should have yellowish clouds, not white.

**Changes:**

In `createClouds()`:

```js
createClouds() {
    let texture;
    const isEarth = this.config.isSolar && (this.config.name === 'Earth' || this.config.pl_name === 'Earth');

    if (isEarth) {
        texture = this.textureLoader.load('./textures/planets/earth/earth_clouds_2048.png');
    } else {
        // Use atmosphere color to tint clouds
        const atmColor = this.config.atmosphere?.color || 0xffffff;
        texture = generateCloudTexture(512, atmColor);
    }

    this.cloudMesh = createCloudLayer(this.config.radius, texture);
    // ... rest unchanged
}
```

**Test:** Find an exoplanet with a non-white atmosphere colour — its clouds should be tinted to match.

---

## Dependency Map

```
2A (noise consolidation)  ──┐
2G (mipmap generation)     ──┤  Independent — can run in parallel
2I (cache key optimization)──┤
2D (Mars normalMap bug)    ──┤
2E (texture load fallback) ──┤
2J (cloud colour tinting)  ──┘
                              │
                              ▼
         2B (sync → async migration) ─── depends on 2A being merged
                              │
                              ▼
         2C (configurable resolution)──── depends on 2B (async textures in place)
         2F (lava emission maps)    ──┐
         2H (roughness worker task) ──┤── depend on 2A (shared noise in worker)
                                      │
                                      ▼
                        Integration testing
```

**Parallel group 1 (6 agents):** 2A, 2D, 2E, 2G, 2I, 2J
**Parallel group 2 (1 agent):** 2B (after 2A)
**Parallel group 3 (3 agents):** 2C, 2F, 2H (after 2B)

---

## Verification Plan

### Automated
```bash
npm run build   # Ensure no import/syntax errors
```

### Visual / Manual
1. `npm run dev` — load the app
2. Visit Earth — textures load, clouds are white, specular highlights on oceans (2E fallback test: rename texture file, reload)
3. Visit Mars — normal map loads asynchronously, surface has visible relief (2D)
4. Fly near a rocky exoplanet — 512px procedural texture with normal map and roughness map (2H)
5. Fly near a lava-world exoplanet — glowing lava flow patterns visible (2F)
6. Fly far away from a textured planet — smooth blending, no moiré (2G)
7. Check an exoplanet with atmosphere — clouds match atmosphere tint (2J)
8. Set `VITE_EXOPLANET_HIGH_RES=1024` — textures sharper on nearby planets (2C)

---

*Created: 2026-03-31*

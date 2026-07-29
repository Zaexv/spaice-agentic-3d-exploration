# Planets Information Report — Data Sources & Integration Plan

## Current Project State

| Aspect | Value |
|--------|-------|
| **Framework** | Pure Three.js v0.182.0 (no React) |
| **Scene Scale** | 1 Light-Year = 10 scene units (`sceneScale = 10`) |
| **Planet Size Scale** | 1 Earth radius = 0.5 scene units (`earthRadiusScale = 0.5`) |
| **Global Multiplier** | x10,000 applied to `meshGroup` |
| **Coordinate Origin** | Sun (heliocentric for solar system) |
| **Existing Data** | 6,087 exoplanets + 8 solar system planets in JSON clusters |
| **Existing Transform** | `CoordinateComputer.js` — RA/Dec/parsecs → Cartesian light-years |

---

## 1. Solar System — `astronomy-engine` (NPM)

### Purpose
Replace the **static** `solar_system.json` positions with **real-time ephemeris** so planets move to their correct orbital positions for any user-selected date.

### Library Details

| Field | Detail |
|-------|--------|
| **Package** | `astronomy-engine` (NPM) |
| **Install** | `npm install astronomy-engine` |
| **Language** | JavaScript / TypeScript — runs in the browser |
| **Key Function** | `Astronomy.HelioVector(body, date)` |

### Data Types Returned

```typescript
// Astronomy.HelioVector(Body.Mars, new Date('2026-04-06'))
interface AstroVector {
  x: number;  // AU — heliocentric, J2000 equatorial
  y: number;  // AU
  z: number;  // AU
  t: AstroTime; // internal time object
}

// Supported bodies:
// Body.Mercury, Body.Venus, Body.Earth, Body.Mars,
// Body.Jupiter, Body.Saturn, Body.Uranus, Body.Neptune,
// Body.Moon (geocentric — see note below), Body.Sun, Body.Pluto
```

### Native Coordinate System
- **Frame:** J2000 Equatorial (ICRS)
- **Origin:** Sun (heliocentric)
- **Axes:** +X → Vernal Equinox, +Z → North Celestial Pole, +Y completes right-hand system
- **Units:** Astronomical Units (AU)

### >> TRANSFORM REQUIRED

```
Scene position = AU × AU_TO_LY × sceneScale × globalScale
```

Where:
- `AU_TO_LY = 1.581e-5` (already defined in `CoordinateComputer.js`)
- `sceneScale = 10`
- `globalScale = 10000` (applied via `meshGroup.scale`)

**This matches your existing pipeline exactly.** The `CoordinateComputer.js` already handles AU → light-years for solar system planets (`hostname === 'Sun'`). You just need to feed it live AU values instead of static ones.

### >> SPECIAL CASE: The Moon

`Astronomy.GeoVector(Body.Moon, date)` returns **geocentric** coordinates (relative to Earth). To place it in the heliocentric scene:

```javascript
const earthPos = Astronomy.HelioVector(Body.Earth, date); // AU from Sun
const moonGeo  = Astronomy.GeoVector(Body.Moon, date);    // AU from Earth

const moonHelio = {
  x: earthPos.x + moonGeo.x,
  y: earthPos.y + moonGeo.y,
  z: earthPos.z + moonGeo.z,
};
```

### Fields to Extract

| Field | Type | Unit | Three.js Use |
|-------|------|------|-------------|
| `x` | `number` | AU | `mesh.position.x` (after scale) |
| `y` | `number` | AU | `mesh.position.y` (after scale) |
| `z` | `number` | AU | `mesh.position.z` (after scale) |

### Integration Point
- **File to modify:** `src/config/planets.js` and `src/services/CoordinateComputer.js`
- **Strategy:** Call `HelioVector()` on each frame (or throttled to 1/sec) with the simulation date, update planet `position` fields before the render loop reads them.

---

## 2. Exoplanets — `astroquery` (Python) + NASA Exoplanet Archive

### Purpose
Download the full catalog of **5,600+ confirmed exoplanets** with physical properties and sky positions. Run once as a build/data step, export to JSON for the frontend.

### Library Details

| Field | Detail |
|-------|--------|
| **Package** | `astroquery` (Python, via pip) |
| **Install** | `pip install astroquery` |
| **Data Source** | NASA Exoplanet Archive TAP API |
| **Table** | `pscomppars` (composite parameters) or `ps` (planetary systems) |

### Data Types Returned (TAP Query)

```python
# Example TAP query columns:
columns = [
    'pl_name',       # str  — Planet name (e.g. "7 CMa b")
    'hostname',      # str  — Host star name (e.g. "7 CMa")
    'ra',            # float — Right Ascension (degrees, ICRS J2000)
    'dec',           # float — Declination (degrees, ICRS J2000)
    'sy_dist',       # float — System distance (parsecs)
    'pl_rade',       # float — Planet radius (Earth radii)
    'pl_masse',      # float — Planet mass (Earth masses)
    'pl_orbper',     # float — Orbital period (days)
    'pl_eqt',        # float — Equilibrium temperature (Kelvin)
    'disc_year',     # int   — Discovery year
    'discoverymethod', # str — Discovery method
    'st_teff',       # float — Host star effective temperature (K)
    'st_rad',        # float — Host star radius (Solar radii)
    'st_mass',       # float — Host star mass (Solar masses)
    'pl_orbsmax',    # float — Semi-major axis (AU)
]
```

### Native Coordinate System
- **Frame:** ICRS (International Celestial Reference System) ≈ J2000 Equatorial
- **Format:** Spherical — RA (degrees), Dec (degrees), Distance (parsecs)
- **Origin:** Earth/Solar System Barycenter

### >> TRANSFORM REQUIRED

**Spherical → Cartesian (already implemented in `CoordinateComputer.js:42-58`):**

```javascript
const distanceLY = sy_dist * 3.26156;  // parsecs → light-years
const raRad  = ra  * (Math.PI / 180);  // degrees → radians
const decRad = dec * (Math.PI / 180);

const x = distanceLY * Math.cos(decRad) * Math.cos(raRad);
const y = distanceLY * Math.cos(decRad) * Math.sin(raRad);
const z = distanceLY * Math.sin(decRad);

// Then: scene_pos = coord_ly * sceneScale (×10,000 via meshGroup)
```

**Your existing pipeline handles this perfectly.** No changes needed to `CoordinateComputer.js`.

### Exported JSON Schema (for frontend consumption)

```json
{
  "pl_name": "7 CMa b",
  "hostname": "7 CMa",
  "ra": 101.4847,
  "dec": -19.2551,
  "sy_dist": 19.82,
  "pl_rade": 12.5,
  "pl_masse": 793.0,
  "pl_orbper": 763.0,
  "pl_eqt": null,
  "disc_year": 2011,
  "discoverymethod": "Radial Velocity",
  "st_teff": 4813,
  "st_rad": 2.4,
  "position": null,
  "characteristics": {
    "radius_position": "Super-Jupiter",
    "coordinates_3d": {
      "x_light_years": null,
      "y_light_years": null,
      "z_light_years": null
    },
    "distance_to_earth_ly": 64.61
  }
}
```

> The `coordinates_3d` fields are computed at runtime by `CoordinateComputer.js` from `ra`, `dec`, and `sy_dist`.

### Fields Used by Three.js Rendering

| JSON Field | Type | Unit | Three.js Use |
|------------|------|------|-------------|
| `ra` | `float` | degrees | Input to coordinate transform |
| `dec` | `float` | degrees | Input to coordinate transform |
| `sy_dist` | `float` | parsecs | Distance → light-years → scene units |
| `pl_rade` | `float` | Earth radii | `mesh` sphere radius × `earthRadiusScale` |
| `pl_masse` | `float` | Earth masses | Classification (rocky/gas/ice) |
| `pl_eqt` | `float` | Kelvin | Surface color generation |
| `st_teff` | `float` | Kelvin | Host star color (blackbody) |
| `hostname` | `string` | — | Grouping, labeling |

### Null Handling
Many exoplanets have `null` for `sy_dist`, `pl_rade`, or `pl_eqt`. Your existing code already handles this:
- Missing distance → placed in `no_position` cluster (not rendered in 3D)
- Missing radius → defaults to 1.0 Earth radii in `PlanetClassifier.js`
- Missing temperature → procedural color based on classification

### Integration Point
- **Already integrated.** Your `nasa_data/clusters/*.json` files contain this data.
- **To refresh:** Run a Python script with `astroquery`, re-export to the same JSON schema, re-split into clusters.

---

## 3. Stars — HYG Database (CSV)

### Purpose
Render **~120,000 real stars** as a background star field, replacing or augmenting the current procedural `StarField.js`. This gives a scientifically accurate galactic backdrop.

### Database Details

| Field | Detail |
|-------|--------|
| **Source** | [astronexus.com/hyg](https://www.astronexus.com/hyg) / [GitHub](https://github.com/astronexus/HYG-Database) |
| **Format** | CSV (~30 MB raw, ~5-8 MB gzipped) |
| **Records** | ~120,000 stars |
| **Version** | HYG 3.0+ |

### Data Types (CSV Columns)

```
id       — int     — Database ID
hip      — int     — Hipparcos catalog ID (null if not in Hipparcos)
hd       — int     — Henry Draper catalog ID
hr       — int     — Harvard Revised / Yale Bright Star ID
proper   — string  — Common name (e.g. "Sirius", "Betelgeuse") — most are null
ra       — float   — Right Ascension (hours, epoch J2000)  ⚠️ HOURS not degrees
dec      — float   — Declination (degrees, epoch J2000)
dist     — float   — Distance (parsecs) — 100000 = unknown
mag      — float   — Apparent visual magnitude
absmag   — float   — Absolute visual magnitude
spect    — string  — Spectral type (e.g. "G2V", "M3III", "B1Ia")
ci       — float   — Color index (B-V) — maps to star color temperature
x        — float   — Cartesian X (parsecs) ✅ PRE-COMPUTED
y        — float   — Cartesian Y (parsecs) ✅ PRE-COMPUTED
z        — float   — Cartesian Z (parsecs) ✅ PRE-COMPUTED
vx       — float   — Velocity X (parsecs/year)
vy       — float   — Velocity Y (parsecs/year)
vz       — float   — Velocity Z (parsecs/year)
lum      — float   — Luminosity (Solar luminosities)
```

### Native Coordinate System
- **Frame:** J2000 Equatorial (same as astronomy-engine and Exoplanet Archive)
- **Origin:** Sun
- **Axes:** +X → Vernal Equinox (RA=0, Dec=0), +Z → North Celestial Pole, +Y → RA 6h
- **Units:** Parsecs

### >> TRANSFORM REQUIRED

The x, y, z columns are **pre-computed in parsecs**. Only a unit conversion is needed:

```javascript
// Parsec → Light-years → Scene units
const PC_TO_LY = 3.26156;
const sceneScale = 10; // 1 LY = 10 scene units

const sceneX = star.x * PC_TO_LY * sceneScale;
const sceneY = star.y * PC_TO_LY * sceneScale;
const sceneZ = star.z * PC_TO_LY * sceneScale;
// meshGroup global scale (×10,000) is applied automatically
```

**No spherical-to-cartesian math needed** — the HYG database already did it.

### >> COLOR MAPPING (B-V Color Index → RGB)

The `ci` (color index) field maps to star color temperature:

| B-V (`ci`) | Color | Temp (K) | RGB Approximation |
|------------|-------|----------|-------------------|
| -0.3 to -0.1 | Blue-white | 30,000+ | `#9bb0ff` |
| 0.0 | White | ~10,000 | `#aabfff` |
| 0.3 | Yellow-white | ~7,500 | `#cad7ff` |
| 0.6 | Yellow (Sun-like) | ~6,000 | `#fff4ea` |
| 1.0 | Orange | ~4,500 | `#ffd2a1` |
| 1.4+ | Red | ~3,000 | `#ffcc6f` |

Standard algorithm (Tanner Helland's method):

```javascript
function bvToRGB(bv) {
  let t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  // Then apply Planck blackbody → sRGB conversion
  let r, g, b;
  // ... (temperature to RGB lookup)
  return new THREE.Color(r, g, b);
}
```

### >> BRIGHTNESS MAPPING (Magnitude → Size/Opacity)

```javascript
// Apparent magnitude → visual size
// mag 0 = brightest stars (Sirius = -1.46)
// mag 6 = barely visible to naked eye
// mag 10+ = telescopic only
const size = Math.max(0.1, 2.0 - star.mag * 0.2);
const opacity = Math.max(0.1, 1.0 - star.mag / 12.0);
```

### >> DATA SIZE OPTIMIZATION

| Strategy | Size | Stars |
|----------|------|-------|
| Full CSV | ~30 MB | ~120,000 |
| Gzipped CSV | ~5-8 MB | ~120,000 |
| Filter mag < 10 | ~3 MB | ~40,000 |
| Filter mag < 8 | ~1 MB | ~15,000 |
| Binary format (Float32Array) | ~2 MB | ~120,000 (x,y,z,ci,mag only) |

**Recommendation:** Export to a compact binary or JSON with only `x, y, z, ci, mag, proper` columns. Use `THREE.BufferGeometry` + `THREE.Points` for rendering (not instanced meshes — stars are just point sprites).

### Fields Used by Three.js Rendering

| CSV Column | Type | Unit | Three.js Use |
|------------|------|------|-------------|
| `x` | `float` | parsecs | `position.x` (after × 3.26156 × 10) |
| `y` | `float` | parsecs | `position.y` |
| `z` | `float` | parsecs | `position.z` |
| `ci` | `float` | B-V index | Star color (blackbody color) |
| `mag` | `float` | magnitude | Point size / brightness |
| `proper` | `string` | — | Label for named stars (Sirius, etc.) |
| `lum` | `float` | Solar luminosities | Optional: glow intensity |

### Integration Point
- **File to modify/create:** `src/objects/StarField.js` (replace procedural stars with real data)
- **Strategy:** Load star data as a `Float32Array`, populate a `THREE.BufferGeometry` with position and color attributes, render as `THREE.Points` with a custom ShaderMaterial for brightness falloff.

---

## Coordinate System Compatibility Matrix

All three sources use **J2000 Equatorial** orientation. They are **fully compatible** — no rotation or axis remapping is needed.

| Source | Origin | Native Units | Axes | To Scene Units |
|--------|--------|-------------|------|---------------|
| **astronomy-engine** | Sun | AU | J2000 EQ: +X=VE, +Z=NCP | `× 1.581e-5 × 10` (AU→LY→scene) |
| **NASA Exoplanets** | Earth* | parsecs (spherical) | J2000 EQ (RA/Dec) | Spherical→Cartesian, `× 3.26156 × 10` |
| **HYG Stars** | Sun | parsecs (cartesian) | J2000 EQ: +X=VE, +Z=NCP | `× 3.26156 × 10` |

> *NASA Exoplanet Archive RA/Dec are Earth-centered, but at interstellar distances (parsecs), the Sun-Earth offset (~5e-6 pc) is negligible.

### Scene Coordinate Summary

```
+X  →  Vernal Equinox (RA=0h, Dec=0°)
+Y  →  RA=6h, Dec=0°
+Z  →  North Celestial Pole (Dec=+90°)

1 scene unit  = 0.1 light-years
10 scene units = 1 light-year
32.6 scene units = 1 parsec
```

After `meshGroup.scale.set(10000, 10000, 10000)`:
```
1 world unit = 0.00001 light-years = ~0.095 AU
```

---

## Summary: What Needs Changing vs What's Already Done

| Component | Status | Action Needed |
|-----------|--------|---------------|
| Exoplanet coordinate transform | **DONE** | `CoordinateComputer.js` already converts RA/Dec/parsecs → Cartesian LY |
| Exoplanet data pipeline | **DONE** | JSON clusters already loaded by `PlanetDataService.js` |
| Solar system static positions | **DONE** | `solar_system.json` has AU positions |
| Solar system **live** positions | **NEW** | Install `astronomy-engine`, call `HelioVector()` per frame |
| Moon position | **NEW** | `GeoVector()` + Earth offset (see Section 1) |
| Star field (real stars) | **NEW** | Parse HYG CSV → `THREE.Points` in `StarField.js` |
| Star colors from B-V index | **NEW** | Implement B-V → RGB conversion |
| Star brightness from magnitude | **NEW** | Map `mag` → point size/opacity |
| Coordinate frame alignment | **NONE** | All three sources use J2000 Equatorial — no rotation needed |
| Unit scaling | **NONE** | Existing `sceneScale` and `globalScale` apply uniformly |

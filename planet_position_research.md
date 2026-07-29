# Planet Position Research — Complete Redesign

## Final Architecture (Working)

**Dual-scale with mode switching.** Space has too much dynamic range for one linear scale (10^13 ratio between Earth's radius and the farthest exoplanet). Every professional space viz uses separate scales.

| Mode | When | Scale | Visible |
|------|------|-------|---------|
| **Solar** | Camera < 600,000 units from Sun | 1 AU = 10,000 scene units | Solar system planets (astronomy-engine) |
| **Interstellar** | Camera > 600,000 units from Sun | 1 LY = 1,000 scene units | Exoplanets + Stars + Sun marker |

Both modes use the same **J2000 Equatorial (ICRS)** coordinate frame. The pipeline produces `x_ly, y_ly, z_ly` in light-years. `astronomy-engine` produces heliocentric AU. Same axes, different units.

---

## Previous Problem

The pipeline had accumulated multiple conflicting approaches:
- Two separate pipelines (`fetch_exoplanets.py` vs legacy 00-05 steps) writing to the same directory
- Exoplanets labeled "Earth-centered" but are actually heliocentric (at parsec distances the difference is negligible but the labeling causes confusion)
- Solar system handled by a completely different system (`astronomy-engine` runtime) with no data pipeline at all
- No single source of truth — the frontend has multiple code paths depending on which data format it encounters
- Scale constants that were changed mid-development, leaving hardcoded values throughout

## The Solution: One Pipeline, One Format, One Coordinate System

### Design Principles

1. **Single coordinate frame**: Heliocentric J2000 Equatorial (ICRS), Cartesian, in light-years
2. **Single pipeline script**: One Python script that produces ALL data for the frontend
3. **Single data format**: Every object (planet, star) has `x_ly, y_ly, z_ly` in the same frame
4. **Solar system at runtime**: `astronomy-engine` computes live positions — no static JSON needed
5. **Pre-computed cartesian**: The pipeline does ALL math (RA/Dec → Cartesian), the frontend just multiplies by `LY_TO_SCENE`

### Why All Three Sources Are Compatible (No Rotation Needed)

| Source | Frame | Origin | Axes | Compatible? |
|--------|-------|--------|------|-------------|
| NASA Exoplanet Archive (RA/Dec) | ICRS / J2000 Equatorial | Heliocentric* | +X=Vernal Equinox, +Z=Celestial North | Yes |
| astronomy-engine (HelioVector) | J2000 Equatorial | Heliocentric | Same | Yes |
| HYG Database (x,y,z parsecs) | J2000 Equatorial | Heliocentric | Same | Yes |

*RA/Dec is technically geocentric, but at parsec distances the Sun-Earth offset (~5e-6 pc) is negligible.

**All three sources share the same axes. No rotation, no frame conversion. Just unit conversion.**

---

## New Pipeline: `pipelines/build_universe.py`

### What It Produces

```
nasa_data/
├── clusters/
│   ├── cluster_index.json          ← index of all exoplanet clusters
│   ├── nearby_quad1.json           ← exoplanets 0-100 LY, RA 0-90°
│   ├── nearby_quad2.json           ← ...
│   ├── ...                         ← 16 cluster files (4 distance × 4 angle)
│   └── no_position.json            ← planets without distance data
└── (no solar_system.json — handled at runtime by astronomy-engine)

public/
└── star_data/
    ├── hyg_stars.bin               ← binary: 7 floats per star (x,y,z,r,g,b,size)
    └── hyg_meta.json               ← metadata
```

### Data Source: NASA Exoplanet Archive

**Table**: `pscomppars` (Composite Parameters — one row per planet, best values)
- Better than `ps` table: already deduplicated, ~5,800 rows vs ~39,000
- ~95-98% have valid `sy_dist` (distance in parsecs) from Gaia DR3

**Columns to fetch**:
```
pl_name, hostname, sy_dist, ra, dec,
pl_rade, pl_bmasse, pl_eqt, pl_orbper, pl_orbsmax,
discoverymethod, disc_year,
st_teff, st_rad, st_mass, st_spectype
```

### Coordinate Transform (The Only Math)

```python
# Input: RA (degrees), Dec (degrees), Distance (parsecs)
# Output: x, y, z in light-years, heliocentric J2000 equatorial

PARSEC_TO_LY = 3.26156

def to_cartesian_ly(ra_deg, dec_deg, dist_pc):
    dist_ly = dist_pc * PARSEC_TO_LY
    ra_rad  = math.radians(ra_deg)
    dec_rad = math.radians(dec_deg)
    
    x = dist_ly * math.cos(dec_rad) * math.cos(ra_rad)
    y = dist_ly * math.cos(dec_rad) * math.sin(ra_rad)
    z = dist_ly * math.sin(dec_rad)
    
    return x, y, z, dist_ly
```

This is standard spherical-to-cartesian. The result is heliocentric J2000 equatorial — directly compatible with `astronomy-engine` and HYG.

### Output Schema (Per Exoplanet)

```json
{
  "pl_name": "Kepler-452 b",
  "hostname": "Kepler-452",
  "ra": 286.85,
  "dec": 44.22,
  "sy_dist": 556.57,
  "x_ly": -1011.42,
  "y_ly": -1203.87,
  "z_ly": 1265.33,
  "dist_ly": 1815.07,
  "pl_rade": 1.63,
  "pl_bmasse": 3.29,
  "pl_eqt": 265,
  "pl_orbper": 384.84,
  "pl_orbsmax": 1.046,
  "discoverymethod": "Transit",
  "disc_year": 2015,
  "st_teff": 5757,
  "st_rad": 1.11,
  "st_mass": 1.04,
  "st_spectype": "G2V",
  "characteristics": {
    "radius_position": "Super-Earth",
    "atmosphere_type": "N2-O2 (Potentially Breathable)",
    "principal_material": "Rocky (Silicates/Iron/Water)",
    "habitability_percent": 85,
    "toxicity_percent": 10,
    "orbit_type": "Circular - Habitable Zone"
  }
}
```

**Key points**:
- `x_ly, y_ly, z_ly` at top level — the only position fields the frontend needs
- `dist_ly` for distance-based clustering and UI display
- `characteristics` for UI enrichment only (not positioning)
- No `coordinates_3d` wrapper, no `position` field, no `system` label — simple and flat

### Clustering Strategy

Same as current (proven, works well for progressive loading):

| Tier | Distance Range | Quadrants | Files |
|------|---------------|-----------|-------|
| nearby | 0-100 LY | 4 (by RA) | 4 |
| medium | 100-500 LY | 4 | 4 |
| far | 500-2000 LY | 4 | 4 |
| veryfar | 2000+ LY | 4 | 4 |

Distance tiers use `dist_ly` (computed). Quadrants use `ra` (0-90°, 90-180°, etc.).

### Star Data (HYG)

Same pipeline as current (`process_hyg_stars.py`) — it already works correctly:
- Downloads HYG CSV
- Pre-computed `x, y, z` in parsecs → multiply by 3.26156 → light-years
- Same J2000 equatorial frame, heliocentric
- Output: binary Float32Array (x,y,z,r,g,b,size per star)

**No changes needed** — HYG pipeline is correct.

### Solar System (Runtime)

`SolarSystemService.js` + `astronomy-engine`:
- `HelioVector(body, date)` → heliocentric AU → multiply by `AU_TO_SCENE`
- Same J2000 equatorial frame
- No pipeline output needed — computed live per frame

**No changes needed** — solar system pipeline is correct.

---

## Frontend Changes Required

### PlanetDataService.js

The `enrichPlanetData()` method needs to map the new flat format:

```javascript
enrichPlanetData(planet) {
    // New pipeline puts x_ly at top level — map to coordinates_3d for renderer
    if (planet.x_ly != null && !planet.characteristics?.coordinates_3d) {
        if (!planet.characteristics) planet.characteristics = {};
        planet.characteristics.coordinates_3d = {
            x_light_years: planet.x_ly,
            y_light_years: planet.y_ly,
            z_light_years: planet.z_ly,
        };
    }
    if (!planet.characteristics?.distance_to_earth_ly && planet.dist_ly) {
        planet.characteristics.distance_to_earth_ly = planet.dist_ly;
    }
    // ... rest of visual enrichment (classify, color, atmosphere)
}
```

This is essentially what it does now — the new pipeline just produces cleaner input.

### ExoplanetField.js

No changes — it already reads `coordinates_3d.x_light_years * LY_TO_SCENE`.

### SceneConstants.js

Current unified constants are correct:
```
LY_TO_SCENE = 1,000
AU_TO_SCENE = AU_TO_LY × LY_TO_SCENE = 0.01581
```

---

## How The Full Scene Fits Together

```
                    Heliocentric J2000 Equatorial
                    All positions in Light-Years × 1,000

                                    Sun ●  (origin)
                                   /  |
                            Earth ·   · Mars       (~0.02 scene units from Sun)
                           /
                    Jupiter ·                       (~0.08 scene units)
                   /
            Neptune ·                               (~0.47 scene units)
           /
    ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                                                    (~1 scene unit = solar system edge)
    
    
    
    
              ★ Proxima Cen b                       (~4,240 scene units)
    
    
              ★ Tau Ceti                            (~11,900 scene units)
    
    
    
    
              ★ 55 Cnc                              (~40,000 scene units)
    
    
    ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★                     (~100,000+ scene units)
    (thousands of exoplanets)
    
    ★ ★ ★ ★ ★ (HYG stars — 109K points)           (~0 to 3,260,000 scene units)
```

### Scale Reference

| Object | Distance from Sun | Scene Units | Note |
|--------|------------------|-------------|------|
| Mercury | 0.39 AU | 0.006 | Innermost planet |
| Earth | 1.0 AU | 0.016 | Our home |
| Moon | 1.003 AU | 0.016 | ~0.0004 from Earth |
| Neptune | 30 AU | 0.47 | Outermost major planet |
| Proxima Cen b | 4.24 LY | 4,240 | Nearest exoplanet |
| Kepler-452 b | 1,815 LY | 1,815,000 | Famous Earth-like |
| Farthest exoplanet | ~3,260 LY | 3,260,000 | Edge of catalog |

---

## Execution Checklist

- [x] Write `pipelines/build_universe.py` — new clean pipeline
- [x] Use `pscomppars` table (deduplicated, 6,153 planets → 6,126 with positions)
- [x] Output flat JSON with `x_ly, y_ly, z_ly` at top level
- [x] Run pipeline and verify output data (all sqrt(x²+y²+z²) match dist_ly)
- [x] PlanetDataService.js already maps `x_ly → coordinates_3d.x_light_years` — no changes needed
- [x] Verify build compiles — `vite build` succeeds
- [ ] Test in browser — exoplanets at correct positions, no overlap with solar system

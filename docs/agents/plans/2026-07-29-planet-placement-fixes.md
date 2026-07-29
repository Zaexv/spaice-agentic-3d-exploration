---
date: 2026-07-29T21:01:48Z
git_commit: c8f5ad646e3c3306e7a17c2f8304779cbe927747
branch: fix-planets
topic: "Planets never appear in wrong/absurd positions"
tags: [plan, exoplanets, solar-system, teleport, rendering, coordinates]
status: draft
---

# Planet Placement Fixes — Implementation Plan

## Overview

Make planet placement *perceptually* correct: no exoplanet ever reads as "sitting next to Earth", teleport always lands facing the actual planet mesh, moons render outside their parents, and every planet is renderable. Explicit user decision: **perceptual correctness over astronomical precision** — visual compression and artistic spread are acceptable as long as nothing looks absurd.

Based on: `docs/agents/research/2026-07-29-planet-placement-pipeline.md` (Iteration Plan v2 + LLM-as-judge review). Bug IDs (B1–B11) refer to that document's register.

## Current State Analysis

- Cluster data on disk is correct (verified numerically) — all bugs are front-end scene/interaction issues.
- The "mxx0123012 next to Earth" effect has a concrete mechanism:
  - Distant exoplanets are emissive bright dots (`emissiveIntensity: 0.6`, `ExoplanetField.js:327-340`), inflated to a minimum of 3 px (`EXO_MIN_PIXELS = 3`, `ExoplanetField.js:13-23`), rendered on top of the solar-system view.
  - The click raycaster (`InputManager.js:122-177`) intersects **any** exoplanet mesh — including sub-pixel-origin dots inflated by adaptive scale — and opens the exploration dialog for it. A planet 20,000 ly away is clickable "next to Earth".
  - `PlanetHoverInfo` is constructed with an empty planets array (`main.js:192-196`) — hover is inert; clicks are the only label source.
- Teleport lands at catalog coords, but meshes in multi-planet systems are displaced by spread offsets ≥8,000 units (`ExoplanetField.js:47-103` vs `TeleportController.js:26-33`) — B3.
- Teleport approach offset is uncapped while mesh radius is clamped → spawn inside mesh when `pl_rade < 0.27` — B5.
- All moons render inside parents: Moon orbit 0.081 scene units vs Earth mesh radius 0.5 (`SolarSystemService.js:94-102`, `SolarSystemField.js:243`) — B2.
- 453 planets beyond camera far plane (dist > 5,000 ly → >1×10¹⁰ units vs `far = 1e10`, `Camera.js:18`) — B1; float32 jitter at those magnitudes — B4.

### Key Discoveries:
- Single choke point for exoplanet coordinates: `PlanetDataService.enrichPlanetData()` (`PlanetDataService.js:47-92`) — every consumer (mesh creation, teleport, proximity) reads `characteristics.coordinates_3d` built there. A position policy applied there propagates everywhere automatically.
- Spread offsets are derivable from data alone (`buildMultiPlanetOffsets()` is a pure function of the planet list) — a position API does not need meshes to exist.
- No test framework (`package.json`: no vitest/jest). Verification scripts must be plain Node.
- Adaptive-scale caps already exist per system (`updateSystemScaleCaps`, `ExoplanetField.js:467-501`) — reuse pattern for global caps.

## Desired End State

From the cockpit near Earth: solar-system planets and the Sun are the only "object-like" things; every distant exoplanet is indistinguishable from a background star (faint point, not clickable). Approaching an exoplanet system smoothly promotes it: dot → clickable disc → textured planet. Teleporting to any planet (including TRAPPIST-1 siblings and >5,000 ly targets) lands the ship just outside the mesh, facing it, with no jitter. Moon, Io, Titan visible beside their parents.

Verify: `window.debugAuditAllPlanets()` reports 0 violations; manual flight checklist below passes.

## What We're NOT Doing

- No star-catalog reconciliation / host-star markers (v2 Phase 4) — deferred, not needed for perceptual correctness.
- No astronomical-precision guarantees beyond direction; veryfar distances are deliberately compressed.
- No floating-origin refactor, no `logarithmicDepthBuffer`, no `LY_TO_SCENE` sweep (Option A) — the compression approach makes all three unnecessary.
- No pipeline (`build_universe.py`) changes — data stays as-is.
- No removal of the artistic multi-planet spread (user accepted it).

## Implementation Approach

Four phases in user-priority order, each independently shippable. The far-plane/precision fix (Phase 4) switches from v2's Option A to **Option C (radial compression at load time)**: the user explicitly dropped the precision requirement, so compressing `dist_ly > 4,000 ly` planets inward (direction preserved) fixes B1 *and* B4 in ~10 lines at the `enrichPlanetData` choke point, with zero renderer/shader/solar-system changes. UI keeps showing true catalog distance.

## Architecture and Code Reuse

- Reuse `enrichPlanetData()` as the single coordinate policy point (compression lives here).
- Extract spread-offset computation so `ExoplanetField` and the new position API share one function.
- Reuse the existing adaptive-scale pixel math (`exoAdaptiveScale`) for click gating (same formula answers "how many pixels does this mesh subtend?").

```
src/
├── config/SceneConstants.js        # + EXO_DOT constants, COMPRESS_* constants; CAMERA_* consumed
├── core/Camera.js                  # use CAMERA_NEAR/CAMERA_FAR constants (B10)
├── services/PlanetDataService.js   # enrichPlanetData: radial compression (B1/B4)
├── objects/ExoplanetField.js       # dot look (Phase 1), getPlanetWorldPosition API (Phase 2),
│                                   #   pl_bmasse fix (B9)
├── controls/InputManager.js        # click gating by apparent size (Phase 1)
├── utils/TeleportController.js     # mesh-true target + clamped offset (B3/B5)
├── utils/ProximityDetector.js      # position API instead of private math (B3)
├── objects/SolarSystemField.js     # moon orbit floor tracks inflated parent (B2)
├── main.js                         # debugAuditAllPlanets hook; fix nearbyObjects filter (B11)
└── scripts/verify_universe.mjs     # NEW: node data-invariant check
```

---

## Phase 1: Distant exoplanets blend into the starfield (perceptual separation)

### Overview
Kill the "labeled planet next to Earth" effect: distant exoplanet dots become faint star-like points and stop being clickable until genuinely approached.

### Changes Required:

#### [ ] 1. Dot appearance — tier-3 material and inflation floor
**File**: `src/objects/ExoplanetField.js`
**Changes**: Lower `EXO_MIN_PIXELS` 3 → 1.5 (`:13`). Tier-3 material (`:327-340`): `emissiveIntensity` 0.6 → 0.25 so dots match starfield brightness instead of outshining it. Add a global adaptive-scale cap so a dot never subtends more than ~4 px until the camera is within its system range:

```js
// exoAdaptiveScale already returns the inflation needed for EXO_MIN_PIXELS.
// Add: never inflate beyond EXO_MAX_FAR_PIXELS (4) unless cameraDistance < EXO_PROMOTE_DISTANCE.
const EXO_PROMOTE_DISTANCE = 10_000_000; // 5 ly — inside a system's neighborhood
```

#### [ ] 2. Click gating by apparent size
**File**: `src/controls/InputManager.js` (`:153-175`)
**Changes**: After raycast hit, compute apparent pixel size of the hit mesh with the same formula as `exoAdaptiveScale` (extract helper `apparentPixels(radius, distance)` into `SceneConstants.js` or a shared util). Ignore hits below `MIN_CLICK_PIXELS = 8`:

```js
const worldPos = new THREE.Vector3();
hitObject.getWorldPosition(worldPos);
const dist = camera.position.distanceTo(worldPos);
const radius = (hitObject.userData.baseRadius ?? 1) * hitObject.scale.x;
if (apparentPixels(radius, dist) < MIN_CLICK_PIXELS) continue; // treat as background star
```

Solar bodies (`userData.isSolar`) exempt — they are always legitimately clickable.

#### [ ] 3. Quick wins (from research doc, zero risk)
- [ ] **File**: `src/objects/ExoplanetField.js` — replace all `planet.pl_masse` reads with `planet.pl_bmasse` (`:256, :298, :317`, `upgradeToHighResTexture`, `downgradeToLowResTexture`) (B9).
- [ ] **File**: `src/core/Camera.js` — import and use `CAMERA_NEAR`, `CAMERA_FAR` from SceneConstants (`:17-18`) (B10).
- [ ] **File**: `src/utils/TeleportController.js:42` — delete stale scale comment.

### Success Criteria:

#### Automated Verification:
- [ ] `npm run build` succeeds.
- [ ] `grep -rn "pl_masse\b" src/ | grep -v pl_bmasse` returns nothing.

#### Manual Verification:
- [ ] From spawn (solar system): no bright colored dots that read as "objects"; sky looks like a starfield.
- [ ] Clicking empty sky / faint dots near Earth opens NO exploration dialog.
- [ ] Clicking Earth/Mars/Jupiter still opens the dialog.
- [ ] Teleport to Proxima Cen b (via navigator): the planet is clickable once it fills ≥8 px.

**Implementation Note**: pause for manual confirmation — this phase defines the core UX.

---

## Phase 2: Teleport & proximity use real mesh positions (B3, B5)

### Overview
One position API; teleport lands facing the mesh, never inside it, even for planets whose cluster is still loading.

### Changes Required:

#### [ ] 1. Extract shared spread-offset computation
**File**: `src/objects/ExoplanetField.js`
**Changes**: `buildMultiPlanetOffsets(planets)` already pure (`:47-103`) — export it (or move to `src/services/PlanetLayout.js`). Add:

```js
/** Final world position (base + spread offset), mesh NOT required.
 *  Re-resolves offsets from the current planet list — call at use time, don't cache. */
getPlanetWorldPosition(pl_name) {
    const mesh = this.planetMeshMap.get(pl_name);
    if (mesh) { const v = new THREE.Vector3(); mesh.getWorldPosition(v); return v; }
    const planet = this.dataService.getPlanetByName(pl_name);
    if (!planet?.characteristics?.coordinates_3d) return null;
    const c = planet.characteristics.coordinates_3d;
    const pos = new THREE.Vector3(c.x_light_years, c.y_light_years, c.z_light_years)
        .multiplyScalar(LY_TO_SCENE);
    const offset = this.multiPlanetOffsets.get(pl_name);
    return offset ? pos.add(offset) : pos;
}
```

#### [ ] 2. TeleportController uses the API + clamped offset
**File**: `src/utils/TeleportController.js` (`:16-51`)
**Changes**: Replace private coordinate math: solar bodies → `solarSystemField.bodyMeshes.get(name).position`; exoplanets → `exoplanetField.getPlanetWorldPosition(pl_name)`. Clamp approach offset with the mesh clamp:

```js
const meshRadius = Math.max(MIN_PLANET_RADIUS,
    Math.min((planet.pl_rade || 1.0) * EARTH_RADIUS_SCALE, MAX_PLANET_RADIUS));
const offset = meshRadius * 1.5; // always ≥ 1.5× actual mesh radius — inside-spawn impossible
```

#### [ ] 3. ProximityDetector uses the API
**File**: `src/utils/ProximityDetector.js` (`:45-97`)
**Changes**: Replace the `coordinates_3d × LY_TO_SCENE` branch with `exoplanetField.getPlanetWorldPosition(planet.pl_name)`; solar branch with `solarSystemField.bodyMeshes` lookup (falls back to AU math when mesh absent). Delete the per-planet `meshGroup.traverse` (O(n²) — `planetMeshMap.get(pl_name)` already exists).

#### [ ] 4. Fix nearbyObjects filter (B11)
**File**: `main.js:334-335`
**Changes**: Pass real meshes: `[...solarSystemField.bodyMeshes.values(), ...]` — or drop `checkProximity` call if braking unwanted. Decision: pass solar meshes only (exoplanet braking irrelevant at dot scale).

### Success Criteria:

#### Automated Verification:
- [ ] `npm run build` succeeds.
- [ ] Console check in-app: `app.teleportController.teleportToPlanet(app.planetDataService.getPlanetByName('TRAPPIST-1 e'))` then `app.spacecraft.getPosition().distanceTo(app.exoplanetField.getPlanetWorldPosition('TRAPPIST-1 e'))` ∈ [meshRadius, 3×meshRadius].

#### Manual Verification:
- [ ] Teleport to each TRAPPIST-1 planet from navigator: target planet centered ahead each time.
- [ ] Teleport to a `pl_rade < 0.27` planet (e.g. search "Kepler-37 b"): ship outside the mesh, planet visible.

---

## Phase 3: Moons outside parents (B2)

### Overview
Moon orbital radius floor tracks the parent's *current inflated* radius every frame — judge-reviewed fix, immune to adaptive-scale re-swallowing.

### Changes Required:

#### [ ] 1. Per-frame moon clearance
**File**: `src/objects/SolarSystemField.js` (`update()`, `:77-122`)
**Changes**: After positioning parents and computing their adaptive scales, position moons relative to parent with a clearance floor:

```js
const MOON_CLEARANCE = 1.8;
// direction from ephemeris kept; magnitude floored:
const parentInflatedR = parentMesh.scale.x * parentBaseRadius;
const orbitVec = moonPos.sub(parentPos);                    // AU-scaled ephemeris offset
const minR = parentInflatedR * MOON_CLEARANCE + moonInflatedR;
if (orbitVec.length() < minR) orbitVec.setLength(minR);
moonMesh.position.copy(parentPos).add(orbitVec);
```

`SolarSystemService` unchanged (keeps returning heliocentric AU positions); the field layer owns visual clearance. Requires storing `baseRadius` in `userData` at `_createBodyMesh` (`:243-272`) and a parent lookup (`body.hostname`).

### Success Criteria:

#### Automated Verification:
- [ ] `npm run build` succeeds.
- [ ] Console: for each moon mesh, `moon.position.distanceTo(parent.position) > parent.scale.x * parent.userData.baseRadius` — add this loop to `debugAuditAllPlanets()` (Phase 4).

#### Manual Verification:
- [ ] Moon visible beside Earth at close range AND from ~1,000 units away.
- [ ] Io/Europa/Ganymede/Callisto visible around Jupiter; Titan beside Saturn.

---

## Phase 4: All planets renderable, no jitter — radial compression (B1 + B4, replaces Option A)

### Overview
Compress `dist_ly > 4,000` planets inward at the `enrichPlanetData` choke point. Direction preserved; displayed distance stays the catalog value. Max scene position drops from 5.5×10¹⁰ (beyond far plane, float32 spacing ~4,096 units) to <1×10¹⁰ (inside far plane, spacing ≤512 units ≈ sub-pixel).

### Changes Required:

#### [ ] 1. Compression at the choke point
**File**: `src/services/PlanetDataService.js` (`enrichPlanetData()`, `:53-61`)
**Changes**:

```js
// Perceptual compression: keep direction, pull veryfar planets inside the
// renderable/precise sphere. UI distance stays catalog dist_ly.
const COMPRESS_START_LY = 4000;
const COMPRESS_RANGE_LY = 800;   // 27,723 ly → ~4,700 ly rendered
function compressedDist(distLy) {
    if (distLy <= COMPRESS_START_LY) return distLy;
    return COMPRESS_START_LY + Math.log10(distLy / COMPRESS_START_LY) * COMPRESS_RANGE_LY;
}
// scale factor applied to x_ly/y_ly/z_ly before writing coordinates_3d:
const k = compressedDist(planet.dist_ly) / planet.dist_ly;
```

Constants live in `SceneConstants.js`. `characteristics.distance_to_earth_ly` keeps the true `dist_ly` (already does).

#### [ ] 2. Audit function
**File**: `main.js` (or `src/utils/DebugAudit.js`)
**Changes**: `window.debugAuditAllPlanets()` — for every entry in `planetMeshMap`: recompute expected position (compressed coords + spread offset) vs `mesh.getWorldPosition()`; report count of violations > 1 unit, plus the Phase 3 moon-clearance loop, plus `maxDistance ≤ CAMERA_FAR` check. Must print `0 violations`.

#### [ ] 3. Data invariant script
**File**: `scripts/verify_universe.mjs` (NEW, plain Node)
**Changes**: Reads all cluster JSONs; asserts for every planet: `‖(x_ly,y_ly,z_ly)‖ ≈ dist_ly ≈ sy_dist × 3.26156` (tol 0.02 ly); asserts `cluster_index.json` counts match files; asserts `compressedDist(max dist_ly) × LY_TO_SCENE < CAMERA_FAR`. Add npm script `"verify": "node scripts/verify_universe.mjs"`.

### Success Criteria:

#### Automated Verification:
- [ ] `npm run verify` passes (all 6,126 planets).
- [ ] `npm run build` succeeds.
- [ ] In-app `debugAuditAllPlanets()` → 0 violations after full progressive load.

#### Manual Verification:
- [ ] Teleport to the farthest planet (search navigator for a >20,000 ly entry): planet renders, no jitter/wobble while orbiting it.
- [ ] Exploration dialog for that planet still shows the true catalog distance.

---

## Testing Strategy

### Unit Tests:
No framework — invariants live in `scripts/verify_universe.mjs` (data) and `debugAuditAllPlanets()` (runtime):
- coords ↔ distance consistency for all planets; index counts; compressed max distance < far plane.
- runtime: expected-vs-actual mesh position (catches future offset/scale regressions); moon clearance; teleport landing band.

### Manual Testing Steps:
1. Spawn → look around: starfield uniform, no colored "object" dots; click sky → nothing opens.
2. Click Earth → dialog opens; press Escape → untargets.
3. Navigator → teleport to TRAPPIST-1 e → planet centered, land outside mesh; repeat for siblings b–h.
4. Navigator → teleport to Kepler-37 b (tiny) → not inside mesh.
5. Navigator → teleport to a >20,000 ly planet → renders, stable, dialog shows true distance.
6. Fly to Jupiter → four Galilean moons visible outside the disc; Earth → Moon visible.

## Performance Considerations

- Click gating adds one `getWorldPosition` + arithmetic per raycast hit — negligible.
- ProximityDetector loses its per-candidate `traverse` (O(n) meshes each) → strictly faster.
- Compression is load-time only. No per-frame cost added except the moon clearance loop (≤17 moons).

## Migration Notes

No data migration — cluster JSONs untouched; compression is applied in-memory at load. Revert = revert commits; each phase is an independent commit.

## References

- Research: `docs/agents/research/2026-07-29-planet-placement-pipeline.md` (bug register B1–B11, Iteration Plan v2, judge review)
- Spread offsets: `src/objects/ExoplanetField.js:47-103`
- Coordinate choke point: `src/services/PlanetDataService.js:47-92`
- Click raycast: `src/controls/InputManager.js:122-177`
- Adaptive scale math: `src/objects/ExoplanetField.js:17-23`, `src/objects/SolarSystemField.js:16-26`

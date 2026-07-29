/**
 * SceneConstants — Unified coordinate system for SpAIce
 *
 * Positions and radii are scaled together so visual proportions look natural.
 *
 *   Sun radius:      3.0    (< Mercury orbit 12.2 — fits with 9.2 gap)
 *   Earth:           0.5 radius at 31.6 orbit (1.6%)
 *   Jupiter:         5.6 radius at 164 orbit (3.4%)
 *   Neptune:         at 949 scene units
 *   Proxima Cen b:   at 8,480,000 scene units (8,937× farther than Neptune)
 *
 * Coordinate frame: Heliocentric J2000 Equatorial (ICRS)
 */

// ─── Unit Conversions ────────────────────────────────────────────────
export const PARSEC_TO_LY = 3.26156;
export const AU_TO_LY = 1.581e-5;
export const LY_TO_PARSEC = 1 / PARSEC_TO_LY;

// ─── The One Scale ──────────────────────────────────────────────────
/** 1 light-year = 2,000,000 scene units */
export const LY_TO_SCENE = 2_000_000;

/** 1 AU ≈ 31.62 scene units (derived) */
export const AU_TO_SCENE = AU_TO_LY * LY_TO_SCENE;

// ─── Solar System Planet Rendering ──────────────────────────────────
/** 1 Earth radius = 0.5 scene units */
export const SOLAR_RADIUS_SCALE = 0.5;

/** Max solar planet radius */
export const SOLAR_MAX_RADIUS = 6.0;

/** Sun radius */
export const SUN_RADIUS = 3.0;

// ─── Exoplanet Rendering ────────────────────────────────────────────
/** 1 Earth radius = 5,000 scene units for exoplanets */
export const EARTH_RADIUS_SCALE = 5_000;

/** Max exoplanet radius */
export const MAX_PLANET_RADIUS = 50_000;

/** Min visible exoplanet radius */
export const MIN_PLANET_RADIUS = 2_000;

// ─── Camera ──────────────────────────────────────────────────────────
export const CAMERA_NEAR = 0.01;
export const CAMERA_FAR = 10_000_000_000;

// ─── LOD (distance thresholds in scene units) ───────────────────────
export const LOD = {
    HIGH_DETAIL: 50_000_000,    // < 25 LY
    MEDIUM_DETAIL: 200_000_000, // < 100 LY
    UPDATE_INTERVAL_MS: 1000,
    MAX_UPDATES_PER_FRAME: 2,
};

// ─── Derived ─────────────────────────────────────────────────────────
export const PARSEC_TO_SCENE = PARSEC_TO_LY * LY_TO_SCENE;

// ─── Rendering Layers ──────────────────────────────────────────────────
/** Objects on this layer (stars, sun flares) get selective bloom. Layer 0 (default) never blooms. */
export const BLOOM_LAYER = 1;

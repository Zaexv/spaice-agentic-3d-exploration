/**
 * CoordinateComputer - Computes 3D coordinates for planets
 */

/**
 * Compute and assign 3D coordinates to a planet object.
 * Uses existing pre-computed coordinates or computes from RA/Dec/Distance.
 * Solar system planets are handled separately by SolarSystemService.js — this
 * function is only for exoplanets loaded from JSON clusters.
 */
export function computeCoordinates(planet) {
    // Path 1: Already has valid coordinates — skip
    if (planet.characteristics?.coordinates_3d?.x_light_years != null) {
        return;
    }

    // Path 2: Compute from RA/Dec/Distance (standard spherical → cartesian)
    const ra = planet.ra;
    const dec = planet.dec;
    const distParsecs = planet.sy_dist;

    if (ra == null || dec == null || distParsecs == null) return;

    const distLightYears = distParsecs * 3.26156;
    const raRad = (ra * Math.PI) / 180;
    const decRad = (dec * Math.PI) / 180;

    if (!planet.characteristics) {
        planet.characteristics = {};
    }

    planet.characteristics.coordinates_3d = {
        x_light_years: distLightYears * Math.cos(decRad) * Math.cos(raRad),
        y_light_years: distLightYears * Math.cos(decRad) * Math.sin(raRad),
        z_light_years: distLightYears * Math.sin(decRad),
        system: 'Computed from RA/Dec/Distance'
    };

    if (!planet.characteristics.distance_to_earth_ly) {
        planet.characteristics.distance_to_earth_ly = distLightYears;
    }
}

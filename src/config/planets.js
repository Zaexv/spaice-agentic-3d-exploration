/**
 * Solar System Planets configuration
 *
 * DEPRECATED: The static solar_system.json has been removed.
 * Solar system planets are now computed in real-time by:
 *   - src/services/SolarSystemService.js  (astronomy-engine positions)
 *   - src/objects/SolarSystemField.js      (3D rendering)
 *
 * This loader is kept as a no-op stub for backwards compatibility.
 */

/**
 * @deprecated Use SolarSystemService.js instead.
 * @returns {Promise<Array>} Always returns an empty array.
 */
export async function loadSolarSystemPlanets() {
    console.warn('loadSolarSystemPlanets() is deprecated. Solar system is now handled by SolarSystemService.js');
    return [];
}

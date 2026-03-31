/**
 * CoordinateComputer - Computes 3D coordinates for planets
 */

/**
 * Compute and assign 3D coordinates to a planet object.
 * Uses existing position field or computes from celestial coordinates (RA/Dec/Distance).
 */
export function computeCoordinates(planet) {
    if (planet.characteristics?.coordinates_3d?.x_light_years !== null &&
        planet.characteristics?.coordinates_3d?.x_light_years !== undefined) {
        return;
    }

    if (!planet.characteristics) {
        planet.characteristics = {};
    }

    if (planet.position && planet.position.x !== null && planet.position.x !== undefined) {
        const distParsecs = planet.sy_dist || 0;
        const distLightYears = distParsecs * 3.26156;
        const maxPos = Math.max(Math.abs(planet.position.x), Math.abs(planet.position.y), Math.abs(planet.position.z));

        let x, y, z;
        if (maxPos < 50 && distLightYears > 1) {
            const ra = planet.ra;
            const dec = planet.dec;
            if (ra != null && dec != null) {
                const raRad = (ra * Math.PI) / 180;
                const decRad = (dec * Math.PI) / 180;
                x = distLightYears * Math.cos(decRad) * Math.cos(raRad);
                y = distLightYears * Math.cos(decRad) * Math.sin(raRad);
                z = distLightYears * Math.sin(decRad);
            } else {
                x = planet.position.x;
                y = planet.position.y;
                z = planet.position.z;
            }
        } else {
            x = planet.position.x;
            y = planet.position.y;
            z = planet.position.z;
        }

        planet.characteristics.coordinates_3d = {
            x_light_years: x, y_light_years: y, z_light_years: z,
            system: 'Galactic (from position field)'
        };
        if (!planet.characteristics.distance_to_earth_ly && distLightYears > 0) {
            planet.characteristics.distance_to_earth_ly = distLightYears;
        }
        return;
    }

    const ra = planet.ra;
    const dec = planet.dec;
    const distParsecs = planet.sy_dist;

    if (ra == null || dec == null || distParsecs == null) return;

    const distLightYears = distParsecs * 3.26156;
    const raRad = (ra * Math.PI) / 180;
    const decRad = (dec * Math.PI) / 180;

    planet.characteristics.coordinates_3d = {
        x_light_years: distLightYears * Math.cos(decRad) * Math.cos(raRad),
        y_light_years: distLightYears * Math.cos(decRad) * Math.sin(raRad),
        z_light_years: distLightYears * Math.sin(decRad),
        system: 'Galactic (computed from RA/Dec/Dist)'
    };
    if (!planet.characteristics.distance_to_earth_ly) {
        planet.characteristics.distance_to_earth_ly = distLightYears;
    }
}

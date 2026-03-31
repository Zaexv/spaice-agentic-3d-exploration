/**
 * PlanetClassifier - Classifies planets by type based on radius and temperature
 */

/**
 * Classify planet based on Radius (Earth Radii) and Temperature (Kelvin)
 */
export function classifyPlanet(radius, temp) {
    let type = 'rocky';
    let subType = 'terrestrial';

    if (radius > 6.0) {
        type = 'gasGiant';
        subType = 'gas_giant';
    } else if (radius >= 3.0) {
        type = 'iceGiant';
        subType = 'ice_giant';
    } else if (radius >= 1.5) {
        type = 'rocky';
        subType = 'super_earth';
    } else if (radius >= 1.0) {
        type = 'rocky';
        subType = 'earth_sized';
    } else {
        type = 'rocky';
        subType = 'sub_earth';
    }

    if (temp > 1000) {
        subType = type === 'gasGiant' ? 'hot_jupiter' : 'lava_world';
    } else if (temp < 200) {
        subType = type === 'gasGiant' ? 'cold_giant' : 'ice_world';
    } else if (temp >= 200 && temp <= 350) {
        if (type === 'rocky' && radius <= 2.0) {
            subType = 'habitable';
        }
    } else {
        if (type === 'rocky') subType = 'desert_world';
    }

    return { type, subType };
}

/**
 * Scale radius for scene visualization
 */
export function getScaledRadius(earthRadii) {
    let scale = earthRadii * 0.5;
    return Math.min(scale, 15);
}

/**
 * Calculate oblateness (flattening) based on planet type and rotation
 */
export function calculateFlattening(classification, name) {
    const { type } = classification;

    let hash = 0;
    for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
    const rand = (hash % 100) / 100;

    if (type === 'gasGiant') {
        return 0.05 + (rand * 0.05);
    } else if (type === 'iceGiant') {
        return 0.015 + (rand * 0.01);
    } else {
        return 0.002 + (rand * 0.003);
    }
}

/**
 * Calculate mass for gravitational effects
 */
export function calculateMass(planet) {
    if (planet.pl_masse) return planet.pl_masse;

    const radius = planet.pl_rade || 1.0;
    const volume = Math.pow(radius, 3);

    let density = 1.0;
    if (planet.planetType === 'rocky') density = 5.0;
    else if (planet.planetType === 'iceGiant') density = 1.5;

    return volume * (density / 5.5);
}

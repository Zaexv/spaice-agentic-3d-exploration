/**
 * PlanetVisualGenerator - Generates visual attributes for planets
 */

const COMPOUNDS = {
    IRON_OXIDE: 0xBC2732,
    SILICATE: 0xA5A5A5,
    SULFUR: 0xE6C229,
    METHANE: 0x008080,
    ICE: 0xF0F8FF,
    WATER: 0x00008B,
    CHLOROPHYLL: 0x228B22,
    CARBON: 0x2F2F2F,
    HYDROGEN: 0xF5DEB3
};

export function getCompounds() {
    return COMPOUNDS;
}

export function generatePlanetColors(classification, name) {
    let hash = 0;
    const str = name || 'default';
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const rand = () => {
        const t = Math.sin(hash++) * 10000;
        return t - Math.floor(t);
    };

    const { type, subType } = classification;

    let baseColor = COMPOUNDS.SILICATE;
    let detailColor = COMPOUNDS.CARBON;
    let gasColors = [];

    if (subType === 'lava_world') {
        baseColor = COMPOUNDS.IRON_OXIDE;
        detailColor = COMPOUNDS.SULFUR;
    } else if (subType === 'ice_world') {
        baseColor = COMPOUNDS.ICE;
        detailColor = COMPOUNDS.SILICATE;
    } else if (subType === 'habitable') {
        baseColor = COMPOUNDS.WATER;
        detailColor = COMPOUNDS.SILICATE;
        if (rand() > 0.5) detailColor = COMPOUNDS.CHLOROPHYLL;
    } else if (subType === 'desert_world') {
        baseColor = 0xD2B48C;
        detailColor = COMPOUNDS.IRON_OXIDE;
    } else if (subType === 'gas_giant' || subType === 'hot_jupiter') {
        baseColor = COMPOUNDS.HYDROGEN;
        detailColor = (subType === 'hot_jupiter') ? 0x4B0082 : COMPOUNDS.SULFUR;
        gasColors = [baseColor, detailColor, (rand() > 0.5 ? COMPOUNDS.METHANE : COMPOUNDS.IRON_OXIDE)];
    } else if (subType === 'ice_giant') {
        baseColor = COMPOUNDS.METHANE;
        detailColor = COMPOUNDS.ICE;
        gasColors = [baseColor, detailColor, 0x4682B4];
    }

    const tweakColor = (hex, variance = 20) => {
        let r = (hex >> 16) & 0xFF;
        let g = (hex >> 8) & 0xFF;
        let b = hex & 0xFF;
        const change = (Math.floor(rand() * variance * 2) - variance);
        r = Math.min(255, Math.max(0, r + change));
        g = Math.min(255, Math.max(0, g + change));
        b = Math.min(255, Math.max(0, b + change));
        return (r << 16) + (g << 8) + b;
    };

    return {
        base: tweakColor(baseColor, 30),
        detail: tweakColor(detailColor, 30),
        gasColors: gasColors.map(c => tweakColor(c, 20))
    };
}

export function generateAtmosphere(classification, colors) {
    const { type, subType } = classification;

    if (subType === 'sub_earth' && subType !== 'ice_world') {
        return { enabled: false };
    }

    let enabled = true;
    let color = 0x87CEEB;
    let density = 0.2;
    let hasClouds = true;

    if (subType === 'lava_world') {
        color = COMPOUNDS.IRON_OXIDE;
        density = 0.4;
        hasClouds = false;
    } else if (subType === 'ice_world') {
        color = COMPOUNDS.ICE;
        density = 0.15;
        hasClouds = true;
    } else if (subType === 'desert_world') {
        color = 0xF4A460;
        density = 0.3;
        hasClouds = true;
    } else if (type === 'gasGiant') {
        color = colors.base;
        density = 0.6;
        hasClouds = true;
    } else if (type === 'iceGiant') {
        color = COMPOUNDS.METHANE;
        density = 0.6;
        hasClouds = true;
    } else if (subType === 'habitable') {
        color = 0x4a90e2;
        density = 0.2;
        hasClouds = true;
    }

    return { enabled, color, density, hasClouds };
}

export function generateRings(classification, name) {
    const { type } = classification;

    let shouldHaveRings = false;
    if (type === 'gasGiant' || type === 'iceGiant') {
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
        shouldHaveRings = (hash % 2 === 0);
    }

    if (!shouldHaveRings) return { enabled: false };

    return {
        enabled: true,
        innerRadius: 1.4,
        outerRadius: 2.2 + (Math.random()),
        color1: 0x8c7853,
        color2: 0x4a4a4a
    };
}

export function applySolarSystemOverrides(planet) {
    const name = planet.pl_name;
    planet.isSolar = true;

    switch (name) {
        case 'Mercury':
            planet.color = 0xA5A5A5;
            planet.detailColor = 0x5C5C5C;
            planet.atmosphere.enabled = false;
            break;
        case 'Venus':
            planet.color = 0xE3BB76;
            planet.detailColor = 0xD4AF37;
            planet.atmosphere.enabled = true;
            planet.atmosphere.color = 0xC29547;
            planet.atmosphere.density = 0.9;
            break;
        case 'Earth':
            planet.color = 0x228B22;
            planet.detailColor = 0x1E90FF;
            planet.atmosphere.enabled = true;
            planet.atmosphere.color = 0x4a90e2;
            planet.atmosphere.density = 0.2;
            break;
        case 'Mars':
            planet.color = 0xBC2732;
            planet.detailColor = 0x8B4513;
            planet.atmosphere.enabled = true;
            planet.atmosphere.color = 0xBC2732;
            planet.atmosphere.density = 0.05;
            break;
        case 'Jupiter':
            planet.color = 0xD9A066;
            planet.detailColor = 0x8C471E;
            planet.rings.enabled = false;
            break;
        case 'Saturn':
            planet.color = 0xEAD6B8;
            planet.detailColor = 0xA08F70;
            planet.rings.enabled = true;
            planet.rings.innerRadius = 1.2;
            planet.rings.outerRadius = 2.3;
            planet.rings.color1 = 0xCDBA96;
            planet.rings.color2 = 0x8B7D6B;
            break;
        case 'Uranus':
            planet.color = 0xD1E7E7;
            planet.detailColor = 0x88B0C3;
            planet.rings.enabled = true;
            planet.rings.innerRadius = 1.6;
            planet.rings.outerRadius = 2.0;
            planet.rings.color1 = 0x555555;
            planet.rings.color2 = 0x777777;
            planet.tilt = 97.77 * (Math.PI / 180);
            break;
        case 'Neptune':
            planet.color = 0x5B5DDF;
            planet.detailColor = 0x2E308E;
            planet.rings.enabled = true;
            planet.rings.innerRadius = 1.5;
            planet.rings.outerRadius = 2.2;
            planet.rings.color1 = 0x3a3a3a;
            planet.rings.color2 = 0x4a4a4a;
            break;
        case 'Pluto':
            planet.color = 0xE3CFB4;
            planet.detailColor = 0x5C4A42;
            planet.atmosphere.enabled = false;
            break;
    }
}

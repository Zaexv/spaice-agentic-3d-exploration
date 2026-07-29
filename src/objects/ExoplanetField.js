import * as THREE from 'three';
import {
    generateRockyTextureAsync,
    generateGasGiantTextureAsync,
    generateIceGiantTextureAsync,
    generateNormalMapAsync,
    generateLavaEmissiveTexture,
    getColorByComposition
} from '../utils/textureGenerator.js';
import { createAtmosphere } from '../shaders/AtmosphereShader.js';
import { LY_TO_SCENE, AU_TO_SCENE, EARTH_RADIUS_SCALE, MAX_PLANET_RADIUS, MIN_PLANET_RADIUS, LOD } from '../config/SceneConstants.js';
import { StarLightPool } from '../utils/StarLightPool.js';

// ─── Adaptive Scaling for Exoplanets ────────────────────────────────
const EXO_MIN_PIXELS = 3;
const EXO_SCREEN_REF = 1920;
const EXO_HALF_FOV = (60 / 2) * Math.PI / 180;

function exoAdaptiveScale(meshRadius, cameraDistance) {
    if (cameraDistance <= 0) return 1;
    const viewWidth = 2 * cameraDistance * Math.tan(EXO_HALF_FOV);
    const currentPixels = (meshRadius * 2 / viewWidth) * EXO_SCREEN_REF;
    if (currentPixels >= EXO_MIN_PIXELS) return 1;
    return EXO_MIN_PIXELS / currentPixels;
}

const MULTI_PLANET_MIN_SPREAD = 8_000;
const MULTI_PLANET_ORBIT_VISUAL_BOOST = 300;
const MULTI_PLANET_SCALE_SAFETY = 0.92;

function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function getSystemKey(planet) {
    return planet.hostname || planet.host_name || planet.star_name || null;
}

function getRenderedRadius(planet) {
    const radiusInEarthRadii = planet.pl_rade || 1.0;
    return Math.max(MIN_PLANET_RADIUS, Math.min(radiusInEarthRadii * EARTH_RADIUS_SCALE, MAX_PLANET_RADIUS));
}

function buildMultiPlanetOffsets(planets) {
    const grouped = new Map();

    for (const planet of planets) {
        const systemKey = getSystemKey(planet);
        if (!systemKey) continue;
        if (!grouped.has(systemKey)) grouped.set(systemKey, []);
        grouped.get(systemKey).push(planet);
    }

    const offsets = new Map();

    for (const [systemKey, group] of grouped) {
        if (group.length < 2) continue;

        const sortedPlanets = [...group].sort((a, b) => {
            const aOrbit = Number.isFinite(a.pl_orbsmax) ? a.pl_orbsmax : Number.POSITIVE_INFINITY;
            const bOrbit = Number.isFinite(b.pl_orbsmax) ? b.pl_orbsmax : Number.POSITIVE_INFINITY;
            if (aOrbit !== bOrbit) return aOrbit - bOrbit;
            return (a.pl_name || '').localeCompare(b.pl_name || '');
        });

        const planetCount = sortedPlanets.length;
        const phase = ((hashString(systemKey) % 3600) / 3600) * Math.PI * 2;
        const maxRadius = Math.max(...sortedPlanets.map(getRenderedRadius));
        const safeClearance = maxRadius * 2.4;
        const sinTerm = Math.sin(Math.PI / planetCount);
        const separationRadius = sinTerm > 0 ? safeClearance / (2 * sinTerm) : safeClearance;

        for (let i = 0; i < planetCount; i++) {
            const planet = sortedPlanets[i];
            const planetRadius = getRenderedRadius(planet);
            const orbitAu = Number.isFinite(planet.pl_orbsmax) && planet.pl_orbsmax > 0 ? planet.pl_orbsmax : 0;
            const boostedOrbitDistance = orbitAu * AU_TO_SCENE * MULTI_PLANET_ORBIT_VISUAL_BOOST;
            const orbitalDistance = Math.max(
                MULTI_PLANET_MIN_SPREAD,
                separationRadius,
                boostedOrbitDistance,
                planetRadius * 2.5
            );

            const angle = phase + (i / planetCount) * Math.PI * 2;
            const hash = hashString(`${systemKey}:${planet.pl_name || ''}`);
            const inclination = ((((hash >> 20) % 41) - 20) * Math.PI) / 180;
            offsets.set(
                planet.pl_name,
                new THREE.Vector3(
                    Math.cos(angle) * orbitalDistance,
                    Math.sin(inclination) * orbitalDistance * 0.2,
                    Math.sin(angle) * orbitalDistance
                )
            );
        }
    }

    return offsets;
}

/**
 * ExoplanetField - Renders thousands of NASA exoplanets as realistic 3D spheres
 * Uses instanced rendering for performance with astronomically accurate sizes
 */
export class ExoplanetField {
    constructor(planetDataService) {
        this.dataService = planetDataService;
        this.meshGroup = new THREE.Group();
        this.meshGroup.name = 'NASA_Exoplanets_3D';
        this.planets = [];
        this.loaded = false;
        this.renderedPlanets = new Set(); // Track rendered planet IDs

        // For compatibility with old code
        this.mesh = this.meshGroup;

        // LOD System - Distance-based texture loading
        this.lodConfig = {
            highDetailDistance: LOD.HIGH_DETAIL,
            mediumDetailDistance: LOD.MEDIUM_DETAIL,
            updateInterval: LOD.UPDATE_INTERVAL_MS,
            maxUpdatesPerFrame: LOD.MAX_UPDATES_PER_FRAME,
        };
        this.lastLodUpdate = 0;
        this.planetMeshMap = new Map(); // Map planet name -> mesh for quick lookup
        this.loadedHighResTextures = new Set(); // Track which planets have high-res textures loaded
        this.pendingLazyLoads = []; // Track pending lazy load operations
        this.multiPlanetOffsets = new Map();

        // Host-star lighting: Tier-1 (near) planets register a proxy host-star position;
        // a bounded pool of real lights tracks the nearest ones to the viewer each frame.
        this.starLightPool = new StarLightPool(this.meshGroup);
    }

    /**
     * Load and render NASA exoplanets incrementally
     */
    async load() {
        if (this.loaded) return;

        console.log('  📦 Loading planet data incrementally...');

        // 1. Load nearby planets first for quick display
        const nearby = await this.dataService.loadNearbyFirst();
        this.planets = nearby;
        this.create3DMeshes(nearby);
        this.loaded = true;

        // 2. Load remaining clusters one by one in background to prevent spikes
        const clusterIndex = await this.dataService.initialize();
        const otherClusters = Object.keys(clusterIndex.clusters)
            .filter(name => name !== 'no_position' && !name.startsWith('nearby'));

        console.log(`  📋 Loading ${otherClusters.length} additional clusters: ${otherClusters.join(', ')}`);

        // Load in background
        this.loadClustersProgressively(otherClusters);
    }

    /**
     * Load clusters one by one and update visualization
     */
    async loadClustersProgressively(clusterNames) {
        let loadedCount = 0;
        const totalClusters = clusterNames.length;

        for (const name of clusterNames) {
            const clusterPlanets = await this.dataService.loadCluster(name);
            if (clusterPlanets && clusterPlanets.length > 0) {
                // Add new planets to local collection
                this.planets.push(...clusterPlanets);
                // Render only the new batch
                this.create3DMeshes(clusterPlanets);

                loadedCount++;
                console.log(`  📦 Progress: ${loadedCount}/${totalClusters} clusters loaded (${this.dataService.getAllPlanets().length} total planets)`);

                // Allow some breathing room between clusters
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        console.log(`✨ All ${totalClusters} clusters loaded! Total: ${this.dataService.getAllPlanets().length} planets rendered.`);
    }

    /**
     * Create 3D sphere meshes for a batch of planets
     */
    async create3DMeshes(planetBatch = this.planets) {
        if (!planetBatch || planetBatch.length === 0) return;
        this.multiPlanetOffsets = buildMultiPlanetOffsets(this.planets);
        this.applyMultiPlanetLayout();
        this.updateSystemScaleCaps();

        // Shared geometries
        const lowPolyGeom = new THREE.SphereGeometry(1, 12, 8); // Tier 3: Far
        lowPolyGeom.computeVertexNormals();

        const midPolyGeom = new THREE.SphereGeometry(1, 16, 12); // Tier 2: Medium
        midPolyGeom.computeVertexNormals();

        const highPolyGeom = new THREE.SphereGeometry(1, 32, 24); // Tier 1: Near
        highPolyGeom.computeVertexNormals();

        const distantMaterials = new Map();
        const batchSize = 30; // Smaller batches for smoother execution
        let index = 0;

        const processBatch = () => {
            const end = Math.min(index + batchSize, planetBatch.length);

            for (; index < end; index++) {
                const planet = planetBatch[index];

                // Avoid rendering duplicates
                if (this.renderedPlanets.has(planet.pl_name)) continue;

                const coords = planet.characteristics?.coordinates_3d;

                // UNIFIED: All planets must have valid coordinates_3d
                if (!coords || coords.x_light_years === null) {
                    console.warn(`⚠️ Skipping ${planet.pl_name}: missing coordinates_3d`);
                    continue;
                }

                const distLY = planet.sy_dist * 3.26156 || Math.sqrt(
                    coords.x_light_years ** 2 +
                    coords.y_light_years ** 2 +
                    coords.z_light_years ** 2
                );
                const radiusInEarthRadii = planet.pl_rade || 1.0;

                const radius = Math.max(MIN_PLANET_RADIUS, Math.min(radiusInEarthRadii * EARTH_RADIUS_SCALE, MAX_PLANET_RADIUS));

                let tier = 3;
                if (distLY < 25) tier = 1;
                else if (distLY < 100) tier = 2;

                const temperature = planet.pl_eqt || 300;
                let material;

                // Use enriched planet type if available, otherwise estimate
                let planetType = planet.planetType;
                if (!planetType) {
                    const radPos = (planet.characteristics?.radius_position || '').toLowerCase();
                    planetType = 'rocky';
                    if (radPos.includes('jupiter') || radiusInEarthRadii > 6) planetType = 'gasGiant';
                    else if (radPos.includes('neptune') || radiusInEarthRadii > 2) planetType = 'iceGiant';
                }

                if (tier === 1) {
                    // Use enriched colors if available, otherwise generate
                    let colors;
                    if (planet.color && planet.detailColor) {
                        colors = { base: planet.color, detail: planet.detailColor };
                    } else {
                        colors = getColorByComposition(planet.characteristics?.principal_material || planetType, temperature, radiusInEarthRadii, planet.pl_masse || 1.0);
                    }

                    // PBR Material Settings based on Planetary Composition
                    let roughness = 0.9;
                    let metalness = 0.0;
                    let emissive = 0x000000;
                    let emissiveIntensity = 0;
                    let emissiveMap = null;

                    const subType = planet.planetSubType || '';
                    const isLava = subType === 'lava_world' || subType === 'hot_jupiter';

                    if (subType === 'habitable' || subType === 'ice_world') {
                        roughness = 0.5;
                    } else if (isLava) {
                        roughness = 0.8;
                        // Glowing veins/pools map instead of a flat emissive tint
                        emissive = 0xffffff;
                        emissiveIntensity = 1.2;
                        emissiveMap = generateLavaEmissiveTexture(256);
                    } else if (subType === 'gas_giant' || subType === 'ice_giant') {
                        roughness = 0.6;
                    }

                    // Initialize with simple base color, then UPGRADE to texture asynchronously.
                    material = new THREE.MeshStandardMaterial({
                        color: new THREE.Color(colors.base),
                        roughness: roughness,
                        metalness: metalness,
                        emissive: emissive || new THREE.Color(0x000000),
                        emissiveIntensity: emissiveIntensity,
                        emissiveMap: emissiveMap,
                        transparent: false,
                        opacity: 1.0,
                        alphaTest: 0,
                        depthWrite: true,
                        depthTest: true,
                        side: THREE.FrontSide
                    });

                } else if (tier === 2) {
                    // Medium distance - simple colors, no textures
                    let colors;
                    if (planet.color && planet.detailColor) {
                        colors = { base: planet.color, detail: planet.detailColor };
                    } else {
                        colors = getColorByComposition(planet.characteristics?.principal_material || planetType, temperature, radiusInEarthRadii, planet.pl_masse || 1.0);
                    }

                    material = new THREE.MeshStandardMaterial({
                        color: new THREE.Color(colors.base),
                        roughness: 0.9,
                        metalness: 0.1,
                        transparent: false, // NEVER transparent
                        opacity: 1.0,
                        alphaTest: 0,
                        depthWrite: true,
                        depthTest: true,
                        side: THREE.FrontSide
                    });

                } else {
                    // Use enriched color if available
                    let baseColor = planet.color;
                    if (!baseColor) {
                        const style = getColorByComposition(planetType, temperature, radiusInEarthRadii, planet.pl_masse || 1.0);
                        baseColor = style.base;
                    }

                    // Cache key based on color value (efficient batching)
                    const colorKey = `mat_${baseColor}`;

                    if (distantMaterials.has(colorKey)) {
                        material = distantMaterials.get(colorKey);
                    } else {
                        material = new THREE.MeshStandardMaterial({
                            color: new THREE.Color(baseColor),
                            emissive: new THREE.Color(baseColor),
                            emissiveIntensity: 0.6,
                            roughness: 1.0,
                            metalness: 0,
                            transparent: false,
                            opacity: 1.0,
                            depthWrite: true,
                            depthTest: true,
                            side: THREE.FrontSide
                        });
                        distantMaterials.set(colorKey, material);
                    }
                }

                const geometry = (tier === 1) ? highPolyGeom.clone() : (tier === 2 ? midPolyGeom.clone() : lowPolyGeom.clone());
                geometry.scale(radius, radius, radius);
                geometry.computeBoundingSphere(); // Required for raycaster after manual scale

                const mesh = new THREE.Mesh(geometry, material);

                // Force planets to render AFTER stars (write depth buffer)
                mesh.renderOrder = 10;

                // Apply Oblateness (Flattening)
                if (planet.flattening) {
                    mesh.scale.set(1, 1.0 - planet.flattening, 1);
                    mesh.userData.shapeScale = new THREE.Vector3(1, 1.0 - planet.flattening, 1);
                } else {
                    mesh.userData.shapeScale = new THREE.Vector3(1, 1, 1);
                }

                // Position in scene units (light-years * LY_TO_SCENE)
                const basePosition = new THREE.Vector3(
                    coords.x_light_years * LY_TO_SCENE,
                    coords.y_light_years * LY_TO_SCENE,
                    coords.z_light_years * LY_TO_SCENE
                );
                const multiPlanetOffset = this.multiPlanetOffsets.get(planet.pl_name);

                if (multiPlanetOffset) {
                    basePosition.add(multiPlanetOffset);
                }

                mesh.position.copy(basePosition);

                mesh.userData.planetData = planet;
                mesh.userData.planet = planet; // Compatibility
                mesh.userData.planetName = planet.pl_name; // Compatibility
                mesh.userData.basePosition = new THREE.Vector3(
                    coords.x_light_years * LY_TO_SCENE,
                    coords.y_light_years * LY_TO_SCENE,
                    coords.z_light_years * LY_TO_SCENE
                );
                mesh.userData.baseRadius = radius;
                mesh.userData.maxAdaptiveScale = Number.POSITIVE_INFINITY;

                // PBR Shadows
                mesh.castShadow = true;
                mesh.receiveShadow = true;

                // --- Geometry Enhancements (Tier 1 Only) ---
                if (tier === 1) {
                    // Host-star lighting proxy: exoplanet host star positions aren't tracked
                    // in the current data, so approximate a plausible direction/distance from
                    // a deterministic per-planet hash (stable across frames since the planet
                    // itself doesn't move).
                    const dirHash = hashString(`hoststar:${planet.pl_name}`);
                    const theta = ((dirHash % 3600) / 3600) * Math.PI * 2;
                    const phi = (((dirHash >> 12) % 1800) / 1800) * Math.PI - Math.PI / 2;
                    const offsetDir = new THREE.Vector3(
                        Math.cos(phi) * Math.cos(theta),
                        Math.sin(phi),
                        Math.cos(phi) * Math.sin(theta)
                    );
                    const hostStarPosition = mesh.position.clone().add(offsetDir.multiplyScalar(radius * 40));
                    mesh.userData.hostStarPosition = hostStarPosition;
                    this.starLightPool.setEmitter(planet.pl_name, hostStarPosition);

                    // Atmosphere for habitable exoplanets
                    if (planet.atmosphere && planet.atmosphere.enabled) {
                        const atmosphereLayers = createAtmosphere(radius, planet.atmosphere);
                        atmosphereLayers.forEach(layer => {
                            mesh.add(layer);
                        });
                    }

                    // Ring System
                    if (planet.rings && planet.rings.enabled) {
                        const inner = planet.rings.innerRadius || 1.4;
                        const outer = planet.rings.outerRadius || 2.2;
                        const ringGeom = new THREE.RingGeometry(inner, outer, 32);
                        const ringMat = new THREE.MeshStandardMaterial({
                            color: planet.rings.color1 || 0x8c7853,
                            side: THREE.DoubleSide,
                            transparent: true,
                            opacity: 0.8,
                            depthWrite: true, // Rings write depth
                            depthTest: true,  // Rings respect depth
                            roughness: 0.8,
                            metalness: 0.2
                        });

                        // Align texture UVs
                        const pos = ringGeom.attributes.position;
                        const v3 = new THREE.Vector3();
                        for (let i = 0; i < pos.count; i++) {
                            v3.fromBufferAttribute(pos, i);
                            ringGeom.attributes.uv.setXY(i, v3.length() < (inner + outer) / 2 ? 0 : 1, 1);
                        }

                        const ringMesh = new THREE.Mesh(ringGeom, ringMat);
                        ringMesh.renderOrder = 10; // Same as planets
                        ringMesh.rotation.x = Math.PI / 2; // Flat relative to planet
                        ringMesh.receiveShadow = true;
                        ringMesh.castShadow = true;
                        mesh.add(ringMesh);
                    }
                }

                this.meshGroup.add(mesh);
                this.planetMeshMap.set(planet.pl_name, mesh); // Track for LOD updates
                this.renderedPlanets.add(planet.pl_name);

                // Trigger async upgrade for Tier 1 procedural planets
                if (tier === 1) {
                    this.upgradeToHighResTexture(mesh, planet);
                    this.loadedHighResTextures.add(planet.pl_name);
                }
            }

            if (index < planetBatch.length) {
                this.updateSystemScaleCaps();
                if (window.requestIdleCallback) window.requestIdleCallback(processBatch);
                else setTimeout(processBatch, 16);
            } else {
                this.updateSystemScaleCaps();
            }
        };

        processBatch();
    }

    applyMultiPlanetLayout() {
        for (const [planetName, mesh] of this.planetMeshMap) {
            if (!mesh?.userData?.basePosition) continue;
            const offset = this.multiPlanetOffsets.get(planetName);
            if (offset) {
                mesh.position.copy(mesh.userData.basePosition).add(offset);
            } else {
                mesh.position.copy(mesh.userData.basePosition);
            }
        }
    }

    updateSystemScaleCaps() {
        const systemMeshes = new Map();

        for (const mesh of this.planetMeshMap.values()) {
            if (!mesh?.userData) continue;
            mesh.userData.maxAdaptiveScale = Number.POSITIVE_INFINITY;

            const planetData = mesh.userData.planetData || mesh.userData.planet;
            const systemKey = planetData ? getSystemKey(planetData) : null;
            if (!systemKey) continue;

            if (!systemMeshes.has(systemKey)) systemMeshes.set(systemKey, []);
            systemMeshes.get(systemKey).push(mesh);
        }

        for (const meshes of systemMeshes.values()) {
            if (meshes.length < 2) continue;

            for (let i = 0; i < meshes.length; i++) {
                const meshA = meshes[i];
                const radiusA = meshA.userData.baseRadius || meshA.geometry?.boundingSphere?.radius || MIN_PLANET_RADIUS;
                for (let j = i + 1; j < meshes.length; j++) {
                    const meshB = meshes[j];
                    const radiusB = meshB.userData.baseRadius || meshB.geometry?.boundingSphere?.radius || MIN_PLANET_RADIUS;
                    const centerDistance = meshA.position.distanceTo(meshB.position);
                    const radiiSum = radiusA + radiusB;
                    if (radiiSum <= 0) continue;

                    const pairScaleCap = Math.max(0.1, (centerDistance * MULTI_PLANET_SCALE_SAFETY) / radiiSum);
                    meshA.userData.maxAdaptiveScale = Math.min(meshA.userData.maxAdaptiveScale, pairScaleCap);
                    meshB.userData.maxAdaptiveScale = Math.min(meshB.userData.maxAdaptiveScale, pairScaleCap);
                }
            }
        }
    }

    /** No longer clearing everything by default */
    update3DMeshes() {
        this.create3DMeshes();
    }

    /**
     * Get color based on habitability score
     */
    getColorByHabitability(habitability) {
        // Green for high, yellow for medium, red for low
        if (habitability > 70) {
            return new THREE.Color(0x39ff14); // Bright green
        } else if (habitability > 40) {
            return new THREE.Color(0xff6b00); // Orange
        } else if (habitability > 20) {
            return new THREE.Color(0xff006e); // Pink
        } else {
            return new THREE.Color(0x8b00ff); // Purple
        }
    }

    /**
     * Update animation and LOD system
     * @param {number} deltaTime - Time since last frame
     * @param {THREE.Vector3} spacecraftPosition - Current spacecraft world position (optional)
     */
    update(deltaTime, spacecraftPosition = null) {
        // LOD System: Update planet textures based on distance from spacecraft
        if (spacecraftPosition) {
            this.updateLOD(spacecraftPosition);
            this.starLightPool.update(spacecraftPosition);
            this.updateSunDirections();
        }
    }

    /**
     * Feed each Tier-1 planet's atmosphere shader(s) a live direction toward its
     * (proxy) host star. Exoplanet meshes are static (no rotation/orbit today), so
     * this only needs to run once per registered planet, but is cheap enough to
     * run every frame alongside the LOD/light-pool update.
     */
    updateSunDirections() {
        const direction = new THREE.Vector3();
        for (const [, mesh] of this.planetMeshMap) {
            const hostStarPosition = mesh.userData.hostStarPosition;
            if (!hostStarPosition) continue;

            direction.subVectors(hostStarPosition, mesh.position).normalize();
            mesh.traverse((child) => {
                if (child.material?.uniforms?.sunDirection) {
                    child.material.uniforms.sunDirection.value.copy(direction);
                }
            });
        }
    }

    /**
     * Force LOD refresh - call after teleportation
     * Uses lazy loading to prevent screen freezing - textures load progressively
     */
    forceRefreshLOD(spacecraftPosition) {
        if (!spacecraftPosition) return;

        console.log('🔄 Starting lazy LOD refresh...');
        console.log(`📍 Spacecraft position: ${spacecraftPosition.x.toFixed(0)}, ${spacecraftPosition.y.toFixed(0)}, ${spacecraftPosition.z.toFixed(0)}`);

        // Cancel any pending lazy load operations
        if (this.pendingLazyLoads) {
            this.pendingLazyLoads.forEach(id => {
                if (window.cancelIdleCallback) cancelIdleCallback(id);
                else clearTimeout(id);
            });
        }
        this.pendingLazyLoads = [];

        // Quick downgrade of previously loaded textures (this is fast)
        for (const planetName of this.loadedHighResTextures) {
            const mesh = this.planetMeshMap.get(planetName);
            if (mesh) {
                const planetData = mesh.userData.planetData || mesh.userData.planet;
                if (planetData) {
                    this.downgradeToLowResTexture(mesh, planetData);
                }
            }
        }
        this.loadedHighResTextures.clear();

        // Find all planets that need upgrading, sorted by distance (closest first)
        const planetsToUpgrade = [];

        for (const [planetName, mesh] of this.planetMeshMap) {
            const planetWorldPos = new THREE.Vector3();
            mesh.getWorldPosition(planetWorldPos);
            const distance = spacecraftPosition.distanceTo(planetWorldPos);

            if (distance < this.lodConfig.highDetailDistance) {
                const planetData = mesh.userData.planetData || mesh.userData.planet;
                planetsToUpgrade.push({ planetName, mesh, planetData, distance });
            }
        }

        // Sort by distance - load closest planets first
        planetsToUpgrade.sort((a, b) => a.distance - b.distance);

        console.log(`📊 ${planetsToUpgrade.length} planets queued for lazy loading`);

        // Load textures lazily, one at a time, using idle callbacks
        let loadIndex = 0;
        const loadNext = () => {
            if (loadIndex >= planetsToUpgrade.length) {
                console.log(`✅ Lazy LOD complete: ${planetsToUpgrade.length} planets upgraded`);
                return;
            }

            const { planetName, mesh, planetData } = planetsToUpgrade[loadIndex];

            // Upgrade this planet's texture
            this.upgradeToHighResTexture(mesh, planetData);
            this.loadedHighResTextures.add(planetName);
            loadIndex++;

            // Schedule next load during idle time (or use setTimeout fallback)
            const scheduleNext = (callback) => {
                if (window.requestIdleCallback) {
                    return window.requestIdleCallback(callback, { timeout: 100 });
                } else {
                    return setTimeout(callback, 16); // ~60fps frame budget
                }
            };

            const id = scheduleNext(loadNext);
            this.pendingLazyLoads.push(id);
        };

        // Start lazy loading after a brief delay to let the teleport animation finish
        setTimeout(loadNext, 50);
    }

    /**
     * LOD Update - Upgrade/downgrade planet textures based on distance from spacecraft
     */
    updateLOD(spacecraftPosition) {
        const now = performance.now();
        if (now - this.lastLodUpdate < this.lodConfig.updateInterval) return;
        this.lastLodUpdate = now;

        let updatesThisFrame = 0;

        for (const [planetName, mesh] of this.planetMeshMap) {
            if (updatesThisFrame >= this.lodConfig.maxUpdatesPerFrame) break;

            // Get world position of planet mesh
            const planetWorldPos = new THREE.Vector3();
            mesh.getWorldPosition(planetWorldPos);

            // Calculate distance from spacecraft
            const distance = spacecraftPosition.distanceTo(planetWorldPos);

            // Adaptive scaling — keep exoplanets visible at any distance
            const baseRadius = mesh.userData.baseRadius || mesh.geometry?.boundingSphere?.radius || MIN_PLANET_RADIUS;
            const adaptiveScale = exoAdaptiveScale(baseRadius, distance);
            const maxAdaptiveScale = mesh.userData.maxAdaptiveScale ?? Number.POSITIVE_INFINITY;
            const scale = Math.min(adaptiveScale, maxAdaptiveScale);
            const shapeScale = mesh.userData.shapeScale || new THREE.Vector3(1, 1, 1);
            mesh.scale.copy(shapeScale).multiplyScalar(scale);

            // Determine desired LOD level
            const needsHighRes = distance < this.lodConfig.highDetailDistance;
            const hasHighRes = this.loadedHighResTextures.has(planetName);

            const planetData = mesh.userData.planetData || mesh.userData.planet;

            // Upgrade texture if close and not already high-res
            if (needsHighRes && !hasHighRes) {
                this.upgradeToHighResTexture(mesh, planetData);
                this.loadedHighResTextures.add(planetName);
                updatesThisFrame++;
            }
            // Downgrade texture if far and currently high-res (save memory)
            else if (!needsHighRes && hasHighRes && distance > this.lodConfig.mediumDetailDistance) {
                this.downgradeToLowResTexture(mesh, planetData);
                this.loadedHighResTextures.delete(planetName);
                updatesThisFrame++;
            }
        }
    }

    /**
     * Upgrade a planet's material to high-resolution procedural textures
     */
    upgradeToHighResTexture(mesh, planetData) {
        if (!mesh || !planetData) return;

        const planetType = planetData.planetType || 'rocky';
        const temperature = planetData.pl_eqt || 300;
        const radius = planetData.pl_rade || 1.0;
        const mass = planetData.pl_masse || 1.0;
        const colors = getColorByComposition(
            planetData.characteristics?.principal_material || planetType,
            temperature,
            radius,
            mass
        );

        let texture, normalMap;

        // Generate high-quality procedural textures (512px)
        let texturePromise, normalMapPromise;

        if (planetType === 'gasGiant') {
            const bandColors = [colors.base, colors.detail, colors.base];
            texturePromise = generateGasGiantTextureAsync(bandColors, 512);
            normalMapPromise = generateNormalMapAsync(512, 0.5);
        } else if (planetType === 'iceGiant') {
            texturePromise = generateIceGiantTextureAsync(colors.base, 512);
            normalMapPromise = generateNormalMapAsync(512, 0.3);
        } else {
            texturePromise = generateRockyTextureAsync(colors.base, colors.detail, 512);
            normalMapPromise = generateNormalMapAsync(512, 2.0);
        }

        // Apply textures when ready (Non-blocking!)
        Promise.all([texturePromise, normalMapPromise]).then(([texture, normalMap]) => {
            // Check if mesh still exists and hasn't been downgraded already
            if (mesh && mesh.material) {
                // IMPORTANT: Texture repeats must be set here for DataTextures
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                normalMap.wrapS = THREE.RepeatWrapping;
                normalMap.wrapT = THREE.RepeatWrapping;

                mesh.material.map = texture;
                mesh.material.normalMap = normalMap;

                // Reset material to PBR values suitable for high-res
                mesh.material.color.setHex(0xffffff); // White so texture shows

                // Lava worlds keep their glowing-veins emissive map through the high-res
                // upgrade instead of losing it to the generic reset below.
                const subType = planetData.planetSubType || planetData.characteristics?.planetSubType || '';
                const isLava = subType === 'lava_world' || subType === 'hot_jupiter';
                if (!isLava) {
                    mesh.material.emissive.setHex(0x000000);
                    mesh.material.emissiveIntensity = 0;
                }

                // Earth-like roughness/metalness or default
                // We don't have easy access to 'isEarth' here without re-checking name, so use generic
                mesh.material.roughness = 0.8;
                mesh.material.metalness = 0.1;

                mesh.material.needsUpdate = true;
            }
        }).catch(err => {
            console.error('Failed to generate high-res texture for', planetData.pl_name, err);
        });

        console.log(`🔍 LOD: Upgraded ${planetData.pl_name} to high-res textures (Async)`);
    }

    /**
     * Downgrade a planet's material to low-resolution for distant viewing
     */
    downgradeToLowResTexture(mesh, planetData) {
        if (!mesh || !planetData) return;

        const planetType = planetData.planetType || 'rocky';
        const temperature = planetData.pl_eqt || 300;
        const radius = planetData.pl_rade || 1.0;
        const mass = planetData.pl_masse || 1.0;
        const colors = getColorByComposition(
            planetData.characteristics?.principal_material || planetType,
            temperature,
            radius,
            mass
        );

        // Use simple color material (no textures)
        if (mesh.material) {
            if (mesh.material.map) mesh.material.map.dispose();
            if (mesh.material.normalMap) mesh.material.normalMap.dispose();
            mesh.material.map = null;
            mesh.material.normalMap = null;

            // "Shine like stars" effect for distant planets
            mesh.material.color.setHex(colors.base);
            mesh.material.emissive.setHex(colors.base);
            mesh.material.emissiveIntensity = 0.8; // Bright glow
            mesh.material.roughness = 1.0;         // No specular reflection
            mesh.material.metalness = 0.0;

            mesh.material.needsUpdate = true;
        }

        console.log(`📉 LOD: Downgraded ${planetData.pl_name} to simple material`);
    }

    /**
     * Get planet at position (for interaction)
     */
    getPlanetAtPosition(position, radius = 5) {
        return this.planets.find(planet => {
            const coords = planet.characteristics?.coordinates_3d;
            if (!coords) return false;
            const planetPos = new THREE.Vector3(
                coords.x_light_years * LY_TO_SCENE,
                coords.y_light_years * LY_TO_SCENE,
                coords.z_light_years * LY_TO_SCENE
            );
            return planetPos.distanceTo(position) < radius;
        });
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.starLightPool.dispose();
        while (this.meshGroup.children.length > 0) {
            const child = this.meshGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            this.meshGroup.remove(child);
        }
        this.renderedPlanets.clear();
    }
}

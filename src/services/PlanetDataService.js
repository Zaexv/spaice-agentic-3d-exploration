/**
 * PlanetDataService - Handles loading and managing NASA exoplanet cluster data
 * with position-based dynamic loading
 */
import { classifyPlanet, getScaledRadius, calculateFlattening, calculateMass } from './PlanetClassifier.js';
import { generatePlanetColors, generateAtmosphere, generateRings, applySolarSystemOverrides } from './PlanetVisualGenerator.js';
import { computeCoordinates } from './CoordinateComputer.js';

export class PlanetDataService {
    constructor() {
        this.clusters = new Map();
        this.allPlanets = [];
        this.isLoading = false;
        this.loadedClusters = new Set();
        this.clusterIndex = null;
        this.sceneScale = 10; // 1 light-year = 10 scene units
    }

    /**
     * Initialize - Load cluster index first
     */
    async initialize() {
        if (this.clusterIndex) {
            console.log('✓ Cluster index already loaded');
            return this.clusterIndex;
        }

        try {
            console.log('Loading cluster index...');
            const response = await fetch('nasa_data/clusters/cluster_index.json');

            if (!response.ok) {
                throw new Error(`Failed to load cluster index: ${response.status}`);
            }

            this.clusterIndex = await response.json();
            console.log(`✓ Cluster index loaded: ${this.clusterIndex.total_clusters} clusters, ${this.clusterIndex.total_planets} total planets`);

            return this.clusterIndex;
        } catch (error) {
            console.error('❌ Error loading cluster index:', error);
            throw error;
        }
    }

    /**
     * Enrich planet data with computed 3D coordinates and visual assets
     */
    enrichPlanetData(planet) {
        // 1. Compute 3D Coordinates
        computeCoordinates(planet);

        // 2. Classify Planet & Generate Visual Attributes
        if (!planet.planetType) {
            const radius = planet.pl_rade || 1.0;
            const temp = planet.pl_eqt || 288;

            const classification = classifyPlanet(radius, temp);
            planet.planetType = classification.type;
            planet.planetSubType = classification.subType;

            planet.radius = getScaledRadius(radius);

            const colors = generatePlanetColors(classification, planet.pl_name);
            planet.color = colors.base;
            planet.detailColor = colors.detail;
            if (classification.type === 'gasGiant') {
                planet.gasColors = colors.gasColors;
            }

            planet.atmosphere = generateAtmosphere(classification, colors);
            planet.rings = generateRings(classification, planet.pl_name);
            planet.flattening = calculateFlattening(classification, planet.pl_name);
            planet.mass = calculateMass(planet);

            if (planet.hostname === 'Sun') {
                applySolarSystemOverrides(planet);
            }
        }

        return planet;
    }

    /**
     * Load solar system planets from cluster
     */
    async loadSolarSystem() {
        console.log('  🌍 Loading solar system from PlanetDataService...');
        const solarPlanets = await this.loadCluster('solar_system');

        if (solarPlanets && solarPlanets.length > 0) {
            solarPlanets.forEach(p => p.isSolar = true);
            console.log(`  ✓ Loaded ${solarPlanets.length} solar system planets`);
        } else {
            console.warn('  ⚠️ No solar system planets loaded');
        }

        return solarPlanets;
    }

    /**
     * Load a specific cluster JSON file
     */
    async loadCluster(clusterName) {
        if (this.loadedClusters.has(clusterName)) {
            console.log(`  ↪ Cluster ${clusterName} already loaded (cached)`);
            return this.clusters.get(clusterName);
        }

        try {
            this.isLoading = true;
            console.log(`  ⬇ Loading cluster ${clusterName}...`);
            const response = await fetch(`nasa_data/clusters/${clusterName}.json`);

            if (!response.ok) {
                if (response.status === 404) {
                    console.warn(`  ⚠️ Cluster ${clusterName} not found (404) - skipping`);
                    this.loadedClusters.add(clusterName);
                    return [];
                }
                throw new Error(`Failed to load cluster: ${clusterName} (${response.status})`);
            }

            const data = await response.json();

            if (Array.isArray(data)) {
                const enrichedData = data.map(planet => this.enrichPlanetData(planet));

                this.clusters.set(clusterName, enrichedData);
                this.loadedClusters.add(clusterName);
                this.allPlanets.push(...enrichedData);

                console.log(`  ✓ Loaded ${clusterName}: ${enrichedData.length} planets (total: ${this.allPlanets.length})`);
                return enrichedData;
            } else {
                console.error(`  ❌ Invalid cluster format for ${clusterName}`);
                this.loadedClusters.add(clusterName);
                return [];
            }
        } catch (error) {
            console.error(`  ❌ Error loading cluster ${clusterName}:`, error);
            return [];
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Load multiple clusters progressively
     */
    async loadClusters(clusterNames) {
        const results = [];
        for (const name of clusterNames) {
            const data = await this.loadCluster(name);
            results.push(data);
        }
        return results;
    }

    /**
     * Load clusters based on camera position (position-based loading)
     */
    async loadClustersNearPosition(position, maxDistance = 500) {
        if (!this.clusterIndex) {
            await this.initialize();
        }

        const distance = Math.sqrt(position.x ** 2 + position.y ** 2 + position.z ** 2);

        let tierToLoad = 'nearby';
        if (distance > 1000) tierToLoad = 'veryfar';
        else if (distance > 500) tierToLoad = 'far';
        else if (distance > 200) tierToLoad = 'medium';

        const angle = Math.atan2(position.z, position.x);
        const quadrant = Math.floor((angle + Math.PI) / (Math.PI / 2)) % 4 + 1;

        console.log(`📍 Position-based loading: distance=${distance.toFixed(1)}, tier=${tierToLoad}, quad=${quadrant}`);

        const clustersToLoad = [];

        const primaryCluster = `${tierToLoad}_quad${quadrant}`;
        if (this.clusterIndex.clusters[primaryCluster]) {
            clustersToLoad.push(primaryCluster);
        }

        const adjacentQuads = [
            (quadrant % 4) + 1,
            quadrant === 1 ? 4 : quadrant - 1
        ];

        for (const adjQuad of adjacentQuads) {
            const adjCluster = `${tierToLoad}_quad${adjQuad}`;
            if (this.clusterIndex.clusters[adjCluster]) {
                clustersToLoad.push(adjCluster);
            }
        }

        const nearbyClusters = ['nearby_quad1', 'nearby_quad2', 'nearby_quad3', 'nearby_quad4'];
        for (const nearby of nearbyClusters) {
            if (!clustersToLoad.includes(nearby)) {
                clustersToLoad.push(nearby);
            }
        }

        console.log(`  Loading clusters: ${clustersToLoad.join(', ')}`);
        await this.loadClusters(clustersToLoad);

        return this.allPlanets;
    }

    /**
     * Load nearby clusters first (optimized loading strategy)
     */
    async loadNearbyFirst() {
        if (!this.clusterIndex) {
            await this.initialize();
        }

        console.log('📦 Loading nearby quadrants...');
        const nearbyQuads = ['nearby_quad1', 'nearby_quad2', 'nearby_quad3', 'nearby_quad4'];
        await this.loadClusters(nearbyQuads);

        console.log(`✓ Loaded ${this.allPlanets.length} nearby planets`);
        return this.allPlanets;
    }

    /**
     * Load all available clusters
     */
    async loadAllClusters() {
        if (!this.clusterIndex) {
            await this.initialize();
        }

        const allClusterNames = Object.keys(this.clusterIndex.clusters);
        console.log(`📦 Loading all ${allClusterNames.length} clusters...`);

        await this.loadClusters(allClusterNames);

        console.log(`✓ Loaded all ${this.allPlanets.length} planets from ${this.loadedClusters.size} clusters`);
        return this.allPlanets;
    }

    /**
     * Get all loaded planets (only those with valid coordinates), deduplicated
     */
    getAllPlanets() {
        const validPlanets = this.allPlanets.filter(p => {
            const coords = p.characteristics?.coordinates_3d;
            return coords && coords.x_light_years !== null && coords.x_light_years !== undefined;
        });

        const uniquePlanets = new Map();
        for (const planet of validPlanets) {
            if (!uniquePlanets.has(planet.pl_name)) {
                uniquePlanets.set(planet.pl_name, planet);
            }
        }

        const result = Array.from(uniquePlanets.values());

        if (result.length < validPlanets.length) {
            console.warn(`⚠️ Deduplicated planets: ${validPlanets.length} → ${result.length} (removed ${validPlanets.length - result.length} duplicates)`);
        }

        return result;
    }

    searchByName(query) {
        if (!query) return this.allPlanets;
        const lowerQuery = query.toLowerCase();
        return this.allPlanets.filter(planet =>
            planet.pl_name?.toLowerCase().includes(lowerQuery)
        );
    }

    filterByHabitability(minPercent = 0, maxPercent = 100) {
        return this.allPlanets.filter(planet => {
            const habitability = planet.characteristics?.habitability_percent || 0;
            return habitability >= minPercent && habitability <= maxPercent;
        });
    }

    filterByDistance(maxDistance) {
        return this.allPlanets.filter(planet => {
            const distance = planet.sy_dist || 0;
            return distance <= maxDistance;
        });
    }

    filter(options = {}) {
        let results = [...this.allPlanets];

        results = results.filter(p => {
            const coords = p.characteristics?.coordinates_3d;
            return coords && coords.x_light_years !== null && coords.x_light_years !== undefined;
        });

        if (options.name) {
            const lowerQuery = options.name.toLowerCase();
            results = results.filter(p =>
                p.pl_name?.toLowerCase().includes(lowerQuery)
            );
        }

        if (options.minHabitability !== undefined) {
            results = results.filter(p =>
                (p.characteristics?.habitability_percent || 0) >= options.minHabitability
            );
        }

        if (options.maxToxicity !== undefined) {
            results = results.filter(p =>
                (p.characteristics?.toxicity_percent || 0) <= options.maxToxicity
            );
        }

        if (options.maxDistance !== undefined) {
            results = results.filter(p =>
                (p.sy_dist || 0) <= options.maxDistance
            );
        }

        if (options.planetType) {
            results = results.filter(p =>
                p.characteristics?.radius_position?.toLowerCase().includes(options.planetType.toLowerCase())
            );
        }

        return results;
    }

    getPlanetByName(name) {
        return this.allPlanets.find(p => p.pl_name === name);
    }

    getRandomPlanet() {
        const validPlanets = this.getAllPlanets();
        if (validPlanets.length === 0) return null;
        const index = Math.floor(Math.random() * validPlanets.length);
        return validPlanets[index];
    }

    getStats() {
        const allPlanets = this.getAllPlanets();
        return {
            totalPlanets: allPlanets.length,
            totalRawEntries: this.allPlanets.length,
            clustersLoaded: this.loadedClusters.size,
            clusterNames: Array.from(this.loadedClusters)
        };
    }
}

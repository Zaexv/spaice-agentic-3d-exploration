/**
 * ProximityDetector - Detects closest planet to spacecraft
 * Uses AU_TO_SCENE for solar planets, LY_TO_SCENE for exoplanets.
 */
import * as THREE from 'three';
import { AU_TO_SCENE, LY_TO_SCENE } from '../config/SceneConstants.js';

export class ProximityDetector {
    constructor(planetDataService, exoplanetField, solarSystemField) {
        this.dataService = planetDataService;
        this.exoplanetField = exoplanetField;
        this.solarSystemField = solarSystemField;
        this.lastClosestPlanet = null;
        this.updateThrottle = 500; // ms between updates
        this.lastUpdateTime = 0;
        this.searchRadius = 5_000_000; // Unified scale — covers ~250 LY
    }

    /**
     * Get the closest planet to a given position
     * @param {THREE.Vector3} position - Spacecraft position
     * @returns {Object|null} - { planet, distance, worldPosition, mesh }
     */
    getClosestPlanet(position) {
        const now = Date.now();

        // Throttle updates
        if (now - this.lastUpdateTime < this.updateThrottle) {
            return this.lastClosestPlanet;
        }

        this.lastUpdateTime = now;

        const allPlanets = this.dataService.getAllPlanets();

        if (!allPlanets || allPlanets.length === 0) {
            return null;
        }

        let closestPlanet = null;
        let closestDistance = Infinity;
        let closestWorldPos = null;
        let closestMesh = null;

        for (const planet of allPlanets) {
            // Get planet position in world coordinates
            let planetWorldPos;

            const isSolarPlanet = planet.isSolar || planet.hostname === 'Sun';

            if (isSolarPlanet && planet.position) {
                planetWorldPos = new THREE.Vector3(
                    planet.position.x * AU_TO_SCENE,
                    planet.position.y * AU_TO_SCENE,
                    planet.position.z * AU_TO_SCENE
                );
            } else if (planet.characteristics?.coordinates_3d) {
                const coords = planet.characteristics.coordinates_3d;
                planetWorldPos = new THREE.Vector3(
                    coords.x_light_years * LY_TO_SCENE,
                    coords.y_light_years * LY_TO_SCENE,
                    coords.z_light_years * LY_TO_SCENE
                );
            } else {
                continue;
            }

            const distance = position.distanceTo(planetWorldPos);

            // Only consider planets within search radius
            if (distance < this.searchRadius && distance < closestDistance) {
                closestDistance = distance;
                closestPlanet = planet;
                closestWorldPos = planetWorldPos;

                // Try to find the mesh for this planet
                let foundMesh = null;

                if (isSolarPlanet) {
                    const meshName = planet.pl_name || planet.name;
                    foundMesh = this.solarSystemField?.bodyMeshes?.get(meshName) || null;
                }

                // Check exoplanet field
                if (!foundMesh && this.exoplanetField && this.exoplanetField.meshGroup) {
                    this.exoplanetField.meshGroup.traverse((child) => {
                        if (child.isMesh && child.userData && child.userData.planetData) {
                            if (child.userData.planetData.pl_name === planet.pl_name) {
                                foundMesh = child;
                            }
                        }
                    });
                }

                closestMesh = foundMesh;
            }
        }

        if (closestPlanet) {
            this.lastClosestPlanet = {
                planet: closestPlanet,
                distance: closestDistance,
                worldPosition: closestWorldPos,
                mesh: closestMesh
            };

            return this.lastClosestPlanet;
        }

        this.lastClosestPlanet = null;
        return null;
    }

    /**
     * Check if closest planet has changed
     */
    hasClosestPlanetChanged(currentClosest) {
        if (!this.lastClosestPlanet && !currentClosest) return false;
        if (!this.lastClosestPlanet || !currentClosest) return true;

        return this.lastClosestPlanet.planet.pl_name !== currentClosest.planet.pl_name;
    }

    /**
     * Reset state
     */
    reset() {
        this.lastClosestPlanet = null;
    }
}

/**
 * Spacecraft Class
 * Auto-pilot forward with steering controls
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { generateThermalTileTexture, generateHeatShieldTexture } from '../utils/textureGenerator.js';

export class Spacecraft {
    constructor() {
        this.group = new THREE.Group();

        // Start near the Sun (Earth at ~31.6 units, solar system ~950 units across)
        this.group.position.set(0, 50, 150);

        // Speeds for unified scale (solar system ~950 units, exoplanets ~8,480,000+ units)
        this.minSpeed = 1.0;
        this.maxSpeed = 50000000.0;
        this.forwardSpeed = 50.0;
        this.autopilotSpeed = 100.0;

        // Arcade flight parameters
        this.turnSpeed = 1.5;
        this.pitchSpeed = 1.2;
        this.bankLimit = 0.6;
        this.strafeFactor = 50.0;
        this.autoLevelSpeed = 4.0;
        this.strafeDecay = 4.0;

        this.steeringForce = 20.0;
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.lateralVelocity = 0; // Strafe speed component

        // Autopilot State
        this.autopilot = {
            enabled: false,
            target: null,
            minDistance: 30
        };

        // Animation
        this.animationTime = 0;

        // View Mode
        this.viewMode = 'CHASE';

        this.createSpacecraft();
    }

    createSpacecraft() {
        this.mesh = new THREE.Group();
        this.group.add(this.mesh);

        this.loadModel();

        // Add FX
        // Engines removed per user request
        this.createNavLights();
    }

    loadModel() {
        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
        loader.setDRACOLoader(dracoLoader);

        // Generate NASA Style Textures (Thermal Tiles & Heat Shield)
        // We use procedural textures instead of loading external files to ensure they exist
        const tileTexture = generateThermalTileTexture(512);
        const heatShieldTexture = generateHeatShieldTexture(512);

        loader.load('assets/space_shuttle.glb', (gltf) => {
            console.log('Spacecraft Model Loaded');
            const model = gltf.scene;
            model.scale.set(0.03, 0.03, 0.03);
            model.rotation.y = 0;

            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = false; // Disable self-shadowing to prevent "square" artifacts

                    // Apply custom spacecraft material with textures
                    // Use heat shield for bottom/nose? Since we don't have UV mapping guarantee for specific parts,
                    // we'll try to apply based on geometry or just use the tile texture which looks cool overall.
                    // Ideally, we'd mix them based on world position (bottom black, top white), but textures are applied in local UVs.
                    // For now, let's use the Thermal Tiles as the main hull texture.

                    child.material = new THREE.MeshStandardMaterial({
                        map: tileTexture,
                        // normalMap: normalTexture, // Dropping normal map if we don't have a matching one
                        metalness: 0.2, // Ceramic tiles are not metallic
                        roughness: 0.8, // Rough ceramic surface
                        envMapIntensity: 0.5,
                        color: 0xffffff
                    });

                    // Enhancement: If we can identify parts by name in the GLB, we could assign heat shield.
                    // Since we don't know the GLB structure, we stick to the white tiles for a unified "NASA" look.
                }
            });

            this.mesh.add(model);
            // Re-orient Space Shuttle model
            // If it flies backwards at Math.PI/2, we flip it.
            this.mesh.rotation.y = -Math.PI / 2;
        }, undefined, (error) => {
            console.error('An error occurred loading the spacecraft:', error);
            // Fallback geometry if model fails
            this.createFallbackSpacecraft();
        });
    }

    createFallbackSpacecraft() {
        // Simple Shuttle-like shape
        const group = new THREE.Group();

        const tileTexture = generateThermalTileTexture(256);
        const heatShieldTexture = generateHeatShieldTexture(256);

        const matWhite = new THREE.MeshStandardMaterial({ map: tileTexture, roughness: 0.8, metalness: 0.2 });
        const matBlack = new THREE.MeshStandardMaterial({ map: heatShieldTexture, roughness: 0.9, metalness: 0.1 });

        // Fuselage
        const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.5, 15, 16), matWhite);
        fuselage.rotation.z = Math.PI / 2;
        group.add(fuselage);

        // Nose
        const nose = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 32), matBlack);
        nose.rotation.z = -Math.PI / 2;
        nose.position.x = 9.5;
        group.add(nose);

        // Wings
        const wingGeom = new THREE.BoxGeometry(10, 0.5, 12);
        // Taper wings? simplified to box for now
        const wings = new THREE.Mesh(wingGeom, matWhite);
        wings.position.set(-2, -0.5, 0);
        group.add(wings);

        // Vertical Stabilizer
        const tail = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 0.5), matWhite);
        tail.position.set(-6, 3, 0);
        group.add(tail);

        group.scale.set(0.02, 0.02, 0.02);
        this.mesh.add(group);
    }



    createNavLights() {
        const portLight = new THREE.PointLight(0xff0000, 1, 1.0);
        portLight.position.set(0.03, -0.01, 0.05);
        this.mesh.add(portLight);

        const starboardLight = new THREE.PointLight(0x00ff00, 1, 1.0);
        starboardLight.position.set(0.03, -0.01, -0.05);
        this.mesh.add(starboardLight);

        this.portLight = portLight;
        this.starboardLight = starboardLight;
    }

    engageAutopilot(targetVector) {
        this.autopilot.enabled = true;
        this.autopilot.target = targetVector;
        this.forwardSpeed = this.autopilotSpeed;
    }

    disengageAutopilot() {
        if (this.autopilot.enabled) {
            this.autopilot.enabled = false;
            this.autopilot.target = null;
            this.forwardSpeed = this.defaultSpeed;
        }
    }

    toggleView() {
        this.viewMode = (this.viewMode === 'CHASE') ? 'COCKPIT' : 'CHASE';
    }

    steer(keys, deltaTime, mouseInput = { x: 0, y: 0 }) {
        const isSteering = keys.left || keys.right || keys.up || keys.down || keys.speedUp || keys.speedDown || keys.boost || keys.brake;
        if (isSteering) this.disengageAutopilot();

        if (this.autopilot.enabled && this.autopilot.target) {
            this.updateAutopilot(deltaTime);
        } else {
            this.updateManualControl(keys, deltaTime);
        }

        // Move straight forward — no drift, no strafe
        const forward = new THREE.Vector3(1, 0, 0);
        forward.applyQuaternion(this.group.quaternion);
        this.group.position.addScaledVector(forward, this.forwardSpeed * deltaTime);
    }

    updateAutopilot(deltaTime) {
        if (!this.autopilot.target) return;
        const direction = new THREE.Vector3().subVectors(this.autopilot.target, this.group.position);
        if (direction.length() < this.autopilot.minDistance) {
            this.disengageAutopilot();
            this.forwardSpeed = 0;
            return;
        }
        const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(1, 0, 0),
            direction.normalize()
        );
        this.group.quaternion.slerp(targetQuaternion, 2.0 * deltaTime);
    }

    updateManualControl(keys, deltaTime) {
        // 1. Speed Control (W/S)
        const acceleration = Math.max(50.0, this.forwardSpeed * 1.5);
        if (keys.speedUp) this.forwardSpeed += acceleration * deltaTime;
        if (keys.speedDown) this.forwardSpeed -= acceleration * deltaTime;
        this.forwardSpeed = THREE.MathUtils.clamp(this.forwardSpeed, this.minSpeed, this.maxSpeed);

        // 2. Yaw — track heading angle directly (prevents gimbal lock / upside-down)
        if (!this._yaw) this._yaw = 0;
        if (!this._pitch) this._pitch = 0;

        const turnInput = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
        const pitchInput = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);

        this._yaw += turnInput * this.turnSpeed * deltaTime;
        this._pitch += pitchInput * this.pitchSpeed * deltaTime;

        // Clamp pitch so ship never flips (max ±80 degrees)
        this._pitch = THREE.MathUtils.clamp(this._pitch, -1.4, 1.4);

        // Build orientation: yaw around world Y, then pitch around local Z
        // This keeps the ship's "up" always roughly aligned with world Y
        const euler = new THREE.Euler(0, this._yaw, this._pitch, 'YXZ');
        this.group.quaternion.setFromEuler(euler);

        // 3. Visual banking on the mesh (cosmetic only)
        const targetBank = -turnInput * this.bankLimit;
        this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, targetBank, deltaTime * this.autoLevelSpeed);
    }

    updateCamera(camera) {
        // Ship forward is +X. Camera sits behind (-X) and above (+Y).
        const isCockpit = this.viewMode === 'COCKPIT';

        const camOffset = isCockpit
            ? new THREE.Vector3(0.2, 0.05, 0)
            : new THREE.Vector3(-1.5, 0.4, 0);

        const lookOffset = isCockpit
            ? new THREE.Vector3(1.5, 0.03, 0)
            : new THREE.Vector3(3.0, 0.1, 0);

        // Transform to world space
        const targetPos = camOffset.applyQuaternion(this.group.quaternion).add(this.group.position);
        const targetLook = lookOffset.applyQuaternion(this.group.quaternion).add(this.group.position);

        // Always snap — no lag, no lerp, no jitter
        camera.position.copy(targetPos);
        camera.lookAt(targetLook);

        // Fixed FOV
        camera.fov = 70;
        camera.updateProjectionMatrix();
    }

    checkProximity(planets) {
        if (!planets) return;

        let nearestDist = Infinity;
        let nearestPlanetRadius = 1.0;

        for (const planet of planets) {
            // Planet position might be direct or in a group
            let planetPos = new THREE.Vector3();
            let radius = 10.0; // Default proximity radius

            if (planet.position) {
                // Check if it's a Vector3 (Solar system planet mesh/group)
                if (planet.position.isVector3) {
                    planetPos.copy(planet.position);
                    // Prefer userData.baseRadius (the true scene-unit radius) over
                    // geometry.parameters.radius — ExoplanetField bakes its adaptive
                    // scale directly into geometry vertices via geometry.scale(), which
                    // leaves geometry.parameters.radius stale at the pre-scale value (1),
                    // making this safety bubble a no-op at exoplanet scale otherwise.
                    if (planet.userData && planet.userData.baseRadius) {
                        radius = planet.userData.baseRadius;
                    } else if (planet.geometry && planet.geometry.parameters) {
                        radius = planet.geometry.parameters.radius;
                    } else if (planet.userData && planet.userData.radius) {
                        radius = planet.userData.radius;
                    }
                }
            }

            const dist = this.group.position.distanceTo(planetPos);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestPlanetRadius = radius;
            }
        }

        // Safety Bubble Logic
        // If within 3x radius, enforce speed limit
        const safetyThreshold = nearestPlanetRadius * 4.0;

        if (nearestDist < safetyThreshold) {
            // Calculate safety speed based on how close we are
            // Closer = Slower
            // at 1x radius (surface) -> max speed 50
            // at 4x radius -> max speed 2000

            const factor = Math.max(0, (nearestDist - nearestPlanetRadius) / (safetyThreshold - nearestPlanetRadius));
            const safeMaxSpeed = THREE.MathUtils.lerp(0.5, 200.0, factor);

            // Apply damping if current speed is too high
            if (this.forwardSpeed > safeMaxSpeed) {
                this.forwardSpeed = THREE.MathUtils.lerp(this.forwardSpeed, safeMaxSpeed, 0.05); // Rapid deceleration
            }
        }
    }

    update(deltaTime, nearbyPlanets = []) {
        this.animationTime += deltaTime;
        this._lastDt = deltaTime;

        // Check proximity to nearby planets to adjust speed
        this.checkProximity(nearbyPlanets);


        // Pulse engine glow


        if (this.portLight && this.starboardLight) {
            const blink = Math.floor(this.animationTime * 2) % 2 === 0;
            this.portLight.intensity = blink ? 1 : 0.1;
            this.starboardLight.intensity = blink ? 1 : 0.1;
        }
    }

    getPosition() { return this.group.position.clone(); }
    getSpeed() { return this.forwardSpeed; }

    dispose() {
        this.group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
                else child.material.dispose();
            }
        });
    }
}

/**
 * Camera Controller
 * Handles smooth camera animations and transitions
 */

import * as THREE from 'three';
import { gsap } from 'https://cdn.skypack.dev/gsap@3.12.2';

export class CameraController {
    constructor(camera, controls, spacecraft = null) {
        this.camera = camera;
        this.controls = controls;
        this.spacecraft = spacecraft;
        this.isAnimating = false;

        this.cameraMode = 'free';
        this.modeConfig = {
            chaseOffset: new THREE.Vector3(0, 5, 15),
            chaseLookOffset: new THREE.Vector3(0, 2, -15),
            chaseLerp: 0.1,
            orbitDistance: 25,
            orbitSpeed: 0.25
        };
        this.orbitTargetPlanet = null;
        this.orbitAngle = 0;
    }

    _createTweenCompletionGuard(totalTweens) {
        let completedCount = 0;
        let done = false;
        return () => {
            if (done) return;
            completedCount += 1;
            if (completedCount >= totalTweens) {
                done = true;
                this.isAnimating = false;
            }
        };
    }

    /**
     * Smoothly travel to a planet
     * @param {Object} planet - The planet object to travel to
     * @param {number} duration - Animation duration in seconds
     */
    travelToPlanet(planet, duration = 2.5) {
        if (this.isAnimating) return;

        this.isAnimating = true;

        // Calculate optimal camera position
        const planetPosition = new THREE.Vector3();
        planet.mesh.getWorldPosition(planetPosition);

        // Distance based on planet size (maintain good viewing angle)
        const minDistance = planet.config.radius * 2.5;
        const defaultDistance = planet.config.radius * 3.5;

        // Preserve current camera bearing relative to the planet when possible
        const currentDir = new THREE.Vector3().subVectors(this.camera.position, planetPosition);
        const hasValidDir = currentDir.lengthSq() > 0.0001;
        const approachDir = hasValidDir
            ? currentDir.normalize()
            : new THREE.Vector3(0.8, 0.4, 0.8).normalize();

        const safeDistance = Math.max(minDistance, defaultDistance);
        const targetCameraPosition = planetPosition.clone().add(
            approachDir.multiplyScalar(safeDistance)
        );

        // Notify spacecraft of navigation target
        if (this.spacecraft) {
            this.spacecraft.setNavigationTarget(planetPosition, duration);
        }

        const onTweenComplete = this._createTweenCompletionGuard(2);

        // Animate camera position
        gsap.to(this.camera.position, {
            x: targetCameraPosition.x,
            y: targetCameraPosition.y,
            z: targetCameraPosition.z,
            duration: duration,
            ease: 'power2.inOut',
            onComplete: () => {
                // Notify spacecraft of arrival
                if (this.spacecraft) {
                    this.spacecraft.clearNavigationTarget();
                }
                onTweenComplete();
            },
            onInterrupt: onTweenComplete
        });

        // Animate controls target (where camera looks)
        gsap.to(this.controls.target, {
            x: planetPosition.x,
            y: planetPosition.y,
            z: planetPosition.z,
            duration: duration,
            ease: 'power2.inOut',
            onComplete: onTweenComplete,
            onInterrupt: onTweenComplete
        });
    }

    /**
     * Return to home view (solar system overview)
     */
    returnToOverview(duration = 2.0) {
        if (this.isAnimating) return;

        this.isAnimating = true;

        // Default overview position
        const overviewPosition = { x: 0, y: 50, z: 150 };
        const overviewTarget = { x: 0, y: 0, z: 0 };

        // Notify spacecraft
        if (this.spacecraft) {
            this.spacecraft.clearNavigationTarget();
        }

        const onTweenComplete = this._createTweenCompletionGuard(2);

        gsap.to(this.camera.position, {
            x: overviewPosition.x,
            y: overviewPosition.y,
            z: overviewPosition.z,
            duration: duration,
            ease: 'power2.inOut',
            onComplete: onTweenComplete,
            onInterrupt: onTweenComplete
        });

        gsap.to(this.controls.target, {
            x: overviewTarget.x,
            y: overviewTarget.y,
            z: overviewTarget.z,
            duration: duration,
            ease: 'power2.inOut',
            onComplete: onTweenComplete,
            onInterrupt: onTweenComplete
        });
    }

    setCameraMode(mode, options = {}) {
        this.cameraMode = mode;
        this.modeConfig = { ...this.modeConfig, ...options };
    }

    setOrbitTarget(planet, distance = null) {
        this.orbitTargetPlanet = planet;
        if (distance !== null) {
            this.modeConfig.orbitDistance = distance;
        }
    }

    update(deltaTime = 0.016) {
        if (this.isAnimating) return;

        if (this.cameraMode === 'chase' && this.spacecraft?.group) {
            const chaseOffsetWorld = this.modeConfig.chaseOffset
                .clone()
                .applyQuaternion(this.spacecraft.group.quaternion)
                .add(this.spacecraft.group.position);
            const lookTarget = this.modeConfig.chaseLookOffset
                .clone()
                .applyQuaternion(this.spacecraft.group.quaternion)
                .add(this.spacecraft.group.position);

            this.camera.position.lerp(chaseOffsetWorld, this.modeConfig.chaseLerp);
            this.controls?.target?.lerp(lookTarget, this.modeConfig.chaseLerp);
            return;
        }

        if (this.cameraMode === 'orbit' && this.orbitTargetPlanet?.mesh) {
            const targetPos = new THREE.Vector3();
            this.orbitTargetPlanet.mesh.getWorldPosition(targetPos);
            this.orbitAngle += this.modeConfig.orbitSpeed * deltaTime;

            const orbitPos = new THREE.Vector3(
                Math.cos(this.orbitAngle) * this.modeConfig.orbitDistance,
                this.modeConfig.orbitDistance * 0.35,
                Math.sin(this.orbitAngle) * this.modeConfig.orbitDistance
            ).add(targetPos);

            this.camera.position.copy(orbitPos);
            this.controls?.target?.copy(targetPos);
            return;
        }

        if (this.cameraMode === 'cockpit' && this.spacecraft) {
            this.spacecraft.isFirstPerson = true;
            this.spacecraft.updateCamera(this.camera);
        }
    }

    /**
     * Check if currently animating
     */
    isCurrentlyAnimating() {
        return this.isAnimating;
    }
}

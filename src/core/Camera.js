/**
 * Camera Manager
 * Handles camera setup and configuration
 */

import * as THREE from 'three';

export class CameraManager {
    constructor(canvas) {
        this.camera = this.createCamera(canvas);
        this.setupCameraPosition();
    }

    createCamera(canvas) {
        const aspect = canvas.clientWidth / canvas.clientHeight;
        const fov = 75;
        const near = 0.1;
        const far = 10_000_000_000;

        return new THREE.PerspectiveCamera(fov, aspect, near, far);
    }

    setupCameraPosition() {
        // Position camera for good initial view
        this.camera.position.set(0, 200, 500);
        this.camera.lookAt(0, 0, 0);
        
        // Camera-following fill light — low intensity, real falloff. Only meant to keep
        // close-up geometry (e.g. spacecraft cockpit) legible in deep space where no
        // star light reaches; must not compete with the Sun/host-star key light or it
        // washes out the day/night terminator.
        this.cameraLight = new THREE.PointLight(0xffffff, 0.3, 5000, 2);
        this.cameraLight.position.set(0, 0, 0);
        this.camera.add(this.cameraLight);
    }

    updateAspect(canvas) {
        const aspect = canvas.clientWidth / canvas.clientHeight;
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    getCamera() {
        return this.camera;
    }
}

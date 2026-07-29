/**
 * Scene Manager
 * Handles Three.js scene setup and configuration
 */

import * as THREE from 'three';

export class SceneManager {
    constructor() {
        this.scene = new THREE.Scene();
        this.setupScene();
    }

    setupScene() {
        // Set background to dark space
        this.scene.background = new THREE.Color(0x000011);

        // Add exponential fog for depth (ajustado para escala x10000)
        // DISABLED - fog was causing transparency issues
        // this.scene.fog = new THREE.FogExp2(0x000011, 0.00000002);

        // Fill lighting only — kept well below any per-body key light (Sun / host-star
        // pool) so a real day/night terminator can read on planet surfaces instead of
        // being washed out by uniform ambient/directional light.
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.18);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.1);
        directionalLight.position.set(1, 0.5, 0);
        this.scene.add(directionalLight);

        // Rim light — subtle edge highlight independent of any atmosphere shader's own
        // fresnel term, so airless (non-atmospheric) planets still read with a defined edge.
        const rimLight = new THREE.DirectionalLight(0xffeebb, 0.25);
        rimLight.position.set(-0.6, -0.3, 0.8);
        this.scene.add(rimLight);
    }

    add(object) {
        this.scene.add(object);
    }

    remove(object) {
        this.scene.remove(object);
    }

    getScene() {
        return this.scene;
    }
}

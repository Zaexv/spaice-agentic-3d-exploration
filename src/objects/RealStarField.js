/**
 * RealStarField — Renders ~109K real stars from HYG database
 * with realistic appearance: bright core, soft glow, diffraction spikes,
 * spectral colors, and magnitude-based brightness.
 */

import * as THREE from 'three';
import { LY_TO_SCENE, BLOOM_LAYER } from '../config/SceneConstants.js';

export class RealStarField {
    constructor() {
        this.mesh = null;
        this.geometry = null;
        this.material = null;
    }

    async load() {
        const response = await fetch('./star_data/hyg_stars.bin');
        if (!response.ok) {
            throw new Error(`Failed to load star data: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        const floats = new Float32Array(buffer);
        const FIELDS = 7;
        const count = floats.length / FIELDS;

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const o = i * FIELDS;

            // Position (light-years → scene units)
            positions[i * 3]     = floats[o]     * LY_TO_SCENE;
            positions[i * 3 + 1] = floats[o + 1] * LY_TO_SCENE;
            positions[i * 3 + 2] = floats[o + 2] * LY_TO_SCENE;

            // Color — boost brightness slightly so faint stars are still visible
            const r = floats[o + 3];
            const g = floats[o + 4];
            const b = floats[o + 5];
            const boost = 1.2;
            colors[i * 3]     = Math.min(1.0, r * boost);
            colors[i * 3 + 1] = Math.min(1.0, g * boost);
            colors[i * 3 + 2] = Math.min(1.0, b * boost);

            // Size — from pipeline (magnitude-based, 0.5 to 5.0)
            // Scale up for visibility: bright stars (size 5) should be prominent
            sizes[i] = floats[o + 6] * 1.5;
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        this.geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

        // Custom shader for realistic star rendering
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
            },
            vertexShader: `
                attribute float size;
                varying vec3 vColor;
                uniform float uPixelRatio;

                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                    // Size attenuation: stars shrink with distance but have a minimum
                    float dist = -mvPosition.z;
                    float attenuation = 300.0 / max(dist, 1.0);
                    float pointSize = size * attenuation * uPixelRatio;

                    // Clamp: bright nearby stars are large, distant ones are at least 1px
                    gl_PointSize = clamp(pointSize, 1.0, 40.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    // Distance from center of point sprite (0 at center, 1 at edge)
                    vec2 center = gl_PointCoord - 0.5;
                    float dist = length(center) * 2.0;

                    // Realistic star profile:
                    // 1. Bright Airy disk core (sharp, intense)
                    float core = exp(-dist * dist * 8.0);

                    // 2. Soft atmospheric glow (wider, dimmer)
                    float glow = exp(-dist * dist * 2.0) * 0.4;

                    // 3. Subtle diffraction spikes (4-point cross)
                    float spike = 0.0;
                    float angle = atan(center.y, center.x);
                    float spikeMask = pow(abs(cos(angle * 2.0)), 32.0); // 4 spikes
                    spike = spikeMask * exp(-dist * 3.0) * 0.15;

                    float brightness = core + glow + spike;

                    // Smooth fade to zero instead of hard discard (prevents black spark artifacts)
                    if (brightness < 0.005) discard;

                    // Apply spectral color — core is white-hot, edges show color
                    vec3 white = vec3(1.0);
                    vec3 starColor = mix(vColor, white, core * 0.7);

                    // Pre-multiplied alpha for additive blending — no black halos
                    gl_FragColor = vec4(starColor * brightness, 1.0);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
        });

        this.mesh = new THREE.Points(this.geometry, this.material);
        this.mesh.renderOrder = -999;
        this.mesh.frustumCulled = false; // Stars span the entire scene
        this.mesh.layers.enable(BLOOM_LAYER);

        console.log(`RealStarField: loaded ${count} stars`);
    }

    dispose() {
        if (this.geometry) { this.geometry.dispose(); this.geometry = null; }
        if (this.material) { this.material.dispose(); this.material = null; }
        this.mesh = null;
    }
}

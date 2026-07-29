/**
 * StarLightPool — fixed-size pool of THREE.PointLight, reassigned each frame
 * to the nearest registered "emitter" positions (exoplanet host-star proxies).
 *
 * With thousands of potential exoplanet host stars, an unbounded per-planet
 * PointLight count would blow both the shader-permutation cache and the
 * per-frame light-loop cost. A small fixed pool bounds that cost regardless
 * of how many planets are on screen.
 */
import * as THREE from 'three';

const DEFAULT_POOL_SIZE = 12;
const LIGHT_INTENSITY = 3;
const LIGHT_DECAY = 2;

export class StarLightPool {
    constructor(scene, size = DEFAULT_POOL_SIZE) {
        this.scene = scene;
        this.lights = [];
        this.emitters = new Map(); // key -> THREE.Vector3 world position

        for (let i = 0; i < size; i++) {
            const light = new THREE.PointLight(0xffffee, LIGHT_INTENSITY, 0, LIGHT_DECAY);
            light.visible = false;
            this.scene.add(light);
            this.lights.push(light);
        }
    }

    /** Register (or update) a host-star proxy position for a given key (e.g. planet name). */
    setEmitter(key, worldPosition) {
        this.emitters.set(key, worldPosition);
    }

    removeEmitter(key) {
        this.emitters.delete(key);
    }

    /** Reassign the pool's real lights to the N nearest emitters relative to viewerPosition. */
    update(viewerPosition) {
        if (this.emitters.size === 0 || !viewerPosition) {
            for (const light of this.lights) light.visible = false;
            return;
        }

        const sorted = Array.from(this.emitters.values())
            .map((pos) => ({ pos, distSq: pos.distanceToSquared(viewerPosition) }))
            .sort((a, b) => a.distSq - b.distSq)
            .slice(0, this.lights.length);

        for (let i = 0; i < this.lights.length; i++) {
            const light = this.lights[i];
            const entry = sorted[i];
            if (entry) {
                light.position.copy(entry.pos);
                light.visible = true;
            } else {
                light.visible = false;
            }
        }
    }

    /** Nearest active emitter position to a given point (for sunDirection calculations). */
    nearestEmitterTo(position) {
        let closest = null;
        let closestDistSq = Infinity;
        for (const pos of this.emitters.values()) {
            const distSq = pos.distanceToSquared(position);
            if (distSq < closestDistSq) {
                closestDistSq = distSq;
                closest = pos;
            }
        }
        return closest;
    }

    dispose() {
        for (const light of this.lights) {
            this.scene.remove(light);
        }
        this.lights = [];
        this.emitters.clear();
    }
}

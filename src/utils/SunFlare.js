/**
 * SunFlare — cheap additive glow + streak sprites for the Sun.
 *
 * Replaces the previous fresnel-shader glow sphere with something that reads
 * as an actual bright/flaring body. Built entirely from canvas-gradient
 * textures and THREE.Sprite (always faces camera, no GPU occlusion query,
 * no gl.readPixels() stall) — same approach used for lens-flare-style
 * effects that need to stay cheap at high object counts.
 */
import * as THREE from 'three';
import { BLOOM_LAYER } from '../config/SceneConstants.js';

function makeGlowTexture(size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,250,230,1)');
    grad.addColorStop(0.25, 'rgba(255,210,110,0.85)');
    grad.addColorStop(0.55, 'rgba(255,150,50,0.35)');
    grad.addColorStop(1, 'rgba(255,100,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

function makeStreakTexture(size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.max(8, size / 8);
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, 'rgba(255,220,150,0)');
    grad.addColorStop(0.5, 'rgba(255,220,150,0.55)');
    grad.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return new THREE.CanvasTexture(canvas);
}

const STREAK_COUNT = 4;

export class SunFlare {
    constructor(sunRadius) {
        this.group = new THREE.Group();
        this.group.name = 'SunFlare';

        const glowTexture = makeGlowTexture();
        const glowMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true,
        });
        this.glowSprite = new THREE.Sprite(glowMaterial);
        this.glowSprite.scale.setScalar(sunRadius * 6);
        this.glowSprite.layers.enable(BLOOM_LAYER);
        this.group.add(this.glowSprite);

        const streakTexture = makeStreakTexture();
        this.streaks = [];
        for (let i = 0; i < STREAK_COUNT; i++) {
            const material = new THREE.SpriteMaterial({
                map: streakTexture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
                rotation: (i / STREAK_COUNT) * Math.PI,
            });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(sunRadius * 14, sunRadius * 1.2, 1);
            sprite.layers.enable(BLOOM_LAYER);
            this.group.add(sprite);
            this.streaks.push(sprite);
        }
    }

    /** Match the Sun mesh's own adaptive scale so the flare stays proportional at any zoom. */
    matchScale(scaleVector) {
        this.group.scale.copy(scaleVector);
    }

    dispose() {
        this.group.traverse((obj) => {
            if (obj.material) {
                if (obj.material.map) obj.material.map.dispose();
                obj.material.dispose();
            }
        });
    }
}

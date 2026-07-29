/**
 * Post-Processing Manager
 * Selective bloom (stars/flares only, via BLOOM_LAYER) + SMAA + film grain.
 *
 * Bloom is "selective" because full-scene bloom previously bled starlight
 * through opaque planet surfaces. Only objects tagged with BLOOM_LAYER are
 * rendered while building the bloom buffer (via camera.layers switching),
 * then that buffer is additively composited on top of the normally-rendered
 * base scene.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM_LAYER } from '../config/SceneConstants.js';

const BASE_LAYER = 0;

const BLOOM_MIX_SHADER = {
    uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: null }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
            gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
        }
    `
};

export class PostProcessingManager {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        this.bloomComposer = null;
        this.composer = null;
        this.bloomPass = null;
        this.smaaPass = null;

        this.initComposer();
    }

    initComposer() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.renderer.getPixelRatio();

        // 1. Bloom-only composer — renders JUST BLOOM_LAYER objects (stars, sun flares)
        this.bloomComposer = new EffectComposer(this.renderer);
        this.bloomComposer.renderToScreen = false;
        this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width / 2, height / 2),
            0.6,  // Strength
            0.4,  // Radius
            0.85  // Threshold
        );
        this.bloomComposer.addPass(this.bloomPass);

        // 2. Composite pass — additively blends the bloom buffer onto the base render
        const mixMaterial = new THREE.ShaderMaterial({
            uniforms: {
                baseTexture: { value: null },
                bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
            },
            vertexShader: BLOOM_MIX_SHADER.vertexShader,
            fragmentShader: BLOOM_MIX_SHADER.fragmentShader
        });
        this.mixPass = new ShaderPass(mixMaterial, 'baseTexture');

        // 3. Final composer — base scene, SMAA, bloom composite, film grain, output
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.smaaPass = new SMAAPass(width * pixelRatio, height * pixelRatio);
        this.composer.addPass(this.smaaPass);

        this.composer.addPass(this.mixPass);

        const filmPass = new FilmPass(0.35, 0.0, 0, false);
        this.composer.addPass(filmPass);

        const outputPass = new OutputPass();
        this.composer.addPass(outputPass);
    }

    setSize(width, height) {
        const pixelRatio = this.renderer.getPixelRatio();
        this.bloomComposer.setSize(width, height);
        this.composer.setSize(width, height);
        if (this.smaaPass) {
            this.smaaPass.setSize(width * pixelRatio, height * pixelRatio);
        }
    }

    render() {
        // Render only BLOOM_LAYER objects into the bloom buffer
        this.camera.layers.set(BLOOM_LAYER);
        this.bloomComposer.render();

        // Restore default layer for the normal, full-scene render
        this.camera.layers.set(BASE_LAYER);
        this.composer.render();
    }

    dispose() {
        this.bloomComposer.dispose();
        this.composer.dispose();
    }
}

import * as THREE from 'three';
import { createAtmosphere, createCloudLayer } from '../shaders/AtmosphereShader.js';
import { AU_TO_SCENE, SOLAR_RADIUS_SCALE, SOLAR_MAX_RADIUS, SUN_RADIUS } from '../config/SceneConstants.js';
import { SunFlare } from '../utils/SunFlare.js';

// ─── Adaptive Scaling ───────────────────────────────────────────────
// At unified LY scale, the solar system is ~1 scene unit across.
// Planets must inflate massively to be visible at any zoom level.

const MIN_SCREEN_PIXELS = 4;     // minimum on-screen size
const SCREEN_WIDTH = 1920;       // reference resolution
const FOV_RAD_HALF = (60 / 2) * Math.PI / 180;

/**
 * Returns a scale multiplier so a planet stays at least MIN_SCREEN_PIXELS.
 */
function adaptiveScale(baseRadius, cameraDistance) {
    if (cameraDistance <= 0) return 1;

    const viewWidth = 2 * cameraDistance * Math.tan(FOV_RAD_HALF);
    const pixelsPerUnit = SCREEN_WIDTH / viewWidth;
    const currentPixels = baseRadius * 2 * pixelsPerUnit;

    if (currentPixels >= MIN_SCREEN_PIXELS) return 1;

    return MIN_SCREEN_PIXELS / currentPixels;
}

/**
 * SolarSystemField — Renders the solar system in real-time using positions
 * from SolarSystemService (astronomy-engine).
 *
 * Operates in AU-scaled scene units (1 AU = AU_TO_SCENE scene units).
 * Does NOT apply a group-level scale — each mesh position is individually converted.
 */
export class SolarSystemField {
    constructor(solarSystemService) {
        this.service = solarSystemService;
        this.group = new THREE.Group();
        this.group.name = 'SolarSystem_Group';

        // For scene.add compatibility
        this.mesh = this.group;

        this.textureLoader = new THREE.TextureLoader();
        this.bodyMeshes = new Map(); // name -> THREE.Mesh
        this.loaded = false;
    }

    // ─── Public API ─────────────────────────────────────────────────

    /**
     * Create initial meshes for all solar system bodies.
     */
    async load() {
        if (this.loaded) return;

        const bodies = this.service.getBodyPositions();

        // Sun (emissive sphere at origin)
        this._createSun();

        // Planets + Moon
        for (const body of bodies) {
            this._createBodyMesh(body);
        }

        this.loaded = true;
        console.log(`SolarSystemField: loaded ${this.bodyMeshes.size} bodies + Sun`);
    }

    /**
     * Per-frame update — refresh positions from the service, apply adaptive
     * scaling, and animate.
     * @param {number} deltaTime — seconds since last frame
     * @param {THREE.Vector3} [cameraPosition] — current camera world position
     */
    update(deltaTime, cameraPosition) {
        if (!this.loaded) return;

        const bodies = this.service.getBodyPositions();

        for (const body of bodies) {
            const mesh = this.bodyMeshes.get(body.name);
            if (!mesh) continue;

            mesh.position.set(
                body.position.x * AU_TO_SCENE,
                body.position.y * AU_TO_SCENE,
                body.position.z * AU_TO_SCENE,
            );

            // Adaptive scaling — keep planets visible at any zoom
            if (cameraPosition) {
                const baseRadius = Math.max(0.1, Math.min(body.pl_rade * SOLAR_RADIUS_SCALE, SOLAR_MAX_RADIUS));
                const dist = cameraPosition.distanceTo(mesh.position);
                const scale = adaptiveScale(baseRadius, dist);
                mesh.scale.setScalar(scale);
            }
        }

        // Sun adaptive scaling
        if (cameraPosition) {
            const sunMesh = this.bodyMeshes.get('Sun');
            if (sunMesh) {
                const dist = cameraPosition.distanceTo(sunMesh.position);
                const scale = adaptiveScale(SUN_RADIUS, dist);
                sunMesh.scale.setScalar(scale);
                if (this.sunFlare) this.sunFlare.matchScale(sunMesh.scale);
            }
        }

        // Live sun direction for every body's atmosphere shader (Sun sits at the origin)
        const sunOrigin = new THREE.Vector3(0, 0, 0);
        const bodyWorldPos = new THREE.Vector3();
        for (const [name, mesh] of this.bodyMeshes) {
            if (name === 'Sun') continue;
            mesh.getWorldPosition(bodyWorldPos);
            const sunDirection = sunOrigin.clone().sub(bodyWorldPos).normalize();
            mesh.traverse((child) => {
                if (child.material?.uniforms?.sunDirection) {
                    child.material.uniforms.sunDirection.value.copy(sunDirection);
                }
                if (child.material?.userData?.sunDirectionUniform) {
                    child.material.userData.sunDirectionUniform.value.copy(sunDirection);
                }
            });
        }

        // Earth rotation + cloud drift
        const earthMesh = this.bodyMeshes.get('Earth');
        if (earthMesh) {
            earthMesh.rotation.y += deltaTime * 0.1;
            const clouds = earthMesh.getObjectByName('EarthClouds');
            if (clouds) clouds.rotation.y += deltaTime * 0.03;
        }

        // Sun slowly rotates for subtle visual movement
        const sunMesh = this.group.getObjectByName('Sun');
        if (sunMesh) sunMesh.rotation.y += deltaTime * 0.02;
    }

    /**
     * Clean up all GPU resources.
     */
    dispose() {
        this.sunFlare?.dispose();
        this.group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (obj.material.map) obj.material.map.dispose();
                if (obj.material.normalMap) obj.material.normalMap.dispose();
                if (obj.material.emissiveMap) obj.material.emissiveMap.dispose();
                if (obj.material.metalnessMap) obj.material.metalnessMap.dispose();
                obj.material.dispose();
            }
        });
        while (this.group.children.length > 0) {
            this.group.remove(this.group.children[0]);
        }
        this.bodyMeshes.clear();
        this.loaded = false;
    }

    // ─── Internal helpers ───────────────────────────────────────────

    /**
     * Create the Sun mesh — emissive sphere fixed at origin.
     * At unified scale, SUN_RADIUS ≈ 0.05 scene units. Adaptive scaling
     * inflates it when the camera is far away.
     */
    _createSun() {
        const sunRadius = SUN_RADIUS;
        const geometry = new THREE.SphereGeometry(sunRadius, 48, 32);

        // Static lava texture — generated once, no animation overhead
        const texSize = 256;
        const canvas = document.createElement('canvas');
        canvas.width = texSize;
        canvas.height = texSize;
        const ctx = canvas.getContext('2d');

        // Orange-yellow radial gradient with noise spots
        const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, '#fffae0');
        grad.addColorStop(0.3, '#ffcc33');
        grad.addColorStop(0.6, '#ff8800');
        grad.addColorStop(1.0, '#cc3300');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, texSize, texSize);

        // Add some noise spots for surface detail
        for (let i = 0; i < 800; i++) {
            const x = Math.random() * texSize;
            const y = Math.random() * texSize;
            const r = Math.random() * 8 + 2;
            const bright = Math.random();
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = bright > 0.5
                ? `rgba(255, 240, 180, ${bright * 0.4})`
                : `rgba(200, 60, 0, ${bright * 0.5})`;
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.MeshBasicMaterial({
            map: texture,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Sun';
        mesh.position.set(0, 0, 0);
        mesh.userData.planetData = {
            name: 'Sun', pl_name: 'Sun', pl_rade: 109, pl_masse: 333000,
            pl_eqt: 5778, isSolar: true, hostname: 'Sun',
        };
        mesh.userData.isSolar = true;
        this.group.add(mesh);

        // Sun flare — cheap additive glow + streak sprites (replaces the previous
        // fresnel-shader glow sphere so the Sun reads as a proper bright/flaring body).
        this.sunFlare = new SunFlare(sunRadius);
        this.sunFlare.group.position.set(0, 0, 0);
        this.group.add(this.sunFlare.group);

        // Sun light — the dominant key light for the whole solar system. Real decay
        // (inverse-square-ish falloff) so Mercury reads bright and Neptune reads dim,
        // instead of every body being lit identically regardless of distance.
        const sunLight = new THREE.PointLight(0xffffee, 8, 0, 2);
        sunLight.position.set(0, 0, 0);
        this.group.add(sunLight);

        // Store Sun mesh reference for adaptive scaling
        this.bodyMeshes.set('Sun', mesh);
    }

    /**
     * Create a mesh for a single solar system body.
     */
    _createBodyMesh(body) {
        const radius = Math.max(0.1, Math.min(body.pl_rade * SOLAR_RADIUS_SCALE, SOLAR_MAX_RADIUS));
        const segmentsW = body.pl_rade > 2 ? 32 : 24;
        const segmentsH = body.pl_rade > 2 ? 24 : 18;

        const geometry = new THREE.SphereGeometry(radius, segmentsW, segmentsH);
        const material = this._createMaterial(body);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = body.name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.renderOrder = 10;

        // Position
        mesh.position.set(
            body.position.x * AU_TO_SCENE,
            body.position.y * AU_TO_SCENE,
            body.position.z * AU_TO_SCENE,
        );

        // Metadata for UI compatibility
        mesh.userData.planetData = { ...body };
        mesh.userData.isSolar = true;

        // Body-specific extras
        this._addExtras(mesh, body, radius);

        this.bodyMeshes.set(body.name, mesh);
        this.group.add(mesh);
    }

    /**
     * Build a MeshStandardMaterial for a body, loading real textures where available.
     */
    _createMaterial(body) {
        const name = body.name;

        // Attempt to load a real texture
        const textureInfo = this._getTexturePath(name);

        if (textureInfo) {
            const map = this.textureLoader.load(textureInfo.diffuse);
            map.colorSpace = THREE.SRGBColorSpace;

            const opts = {
                map,
                roughness: 0.8,
                metalness: 0.1,
                depthWrite: true,
                depthTest: true,
                side: THREE.FrontSide,
            };

            // Earth gets additional maps
            if (name === 'Earth') {
                const specular = this.textureLoader.load('./textures/planets/earth/earth_specular_2048.jpg');
                const normal = this.textureLoader.load('./textures/planets/earth/earth_normal_2048.jpg');
                const emissive = this.textureLoader.load('./textures/planets/earth/earth_lights_2048.png');
                emissive.colorSpace = THREE.SRGBColorSpace;

                opts.metalnessMap = specular;
                opts.normalMap = normal;
                opts.emissiveMap = emissive;
                opts.emissive = new THREE.Color(0xffaa44);
                opts.emissiveIntensity = 0.8;
                opts.metalness = 0.5;
                opts.roughness = 0.2;
            }

            return new THREE.MeshStandardMaterial(opts);
        }

        // Fallback: plain colored material (Moon, Pluto, etc.)
        const color = this._getFallbackColor(name);
        return new THREE.MeshStandardMaterial({
            color,
            roughness: 0.9,
            metalness: 0.0,
            depthWrite: true,
            depthTest: true,
            side: THREE.FrontSide,
        });
    }

    /**
     * Return diffuse texture path for planets that have downloadable textures.
     */
    _getTexturePath(name) {
        const paths = {
            Mercury:  { diffuse: './textures/planets/mercury/2k_mercury.jpg' },
            Venus:    { diffuse: './textures/planets/venus/2k_venus_atmosphere.jpg' },
            Earth:    { diffuse: './textures/planets/earth/earth_day_2048.jpg' },
            Mars:     { diffuse: './textures/planets/mars/2k_mars.jpg' },
            Jupiter:  { diffuse: './textures/planets/jupiter/2k_jupiter.jpg' },
            Saturn:   { diffuse: './textures/planets/saturn/2k_saturn.jpg' },
            Uranus:   { diffuse: './textures/planets/uranus/2k_uranus.jpg' },
            Neptune:  { diffuse: './textures/planets/neptune/2k_neptune.jpg' },
        };
        return paths[name] || null;
    }

    /**
     * Fallback colours for bodies without textures.
     */
    _getFallbackColor(name) {
        const colors = {
            Moon: 0xaaaaaa, Pluto: 0xc2b280,
            Phobos: 0x888877, Deimos: 0x999988,
            Io: 0xccaa44, Europa: 0xccbb99, Ganymede: 0x998877, Callisto: 0x776655,
            Titan: 0xddaa66, Enceladus: 0xeeeeff, Mimas: 0xcccccc,
            Titania: 0xaabbcc, Oberon: 0x998888,
            Triton: 0xbbaacc, Charon: 0xaaaaaa,
        };
        return colors[name] || 0x888888;
    }

    /**
     * Add rings, atmosphere, clouds, or other geometry extras to a body mesh.
     */
    _addExtras(mesh, body, radius) {
        const name = body.name;

        // Saturn rings
        if (name === 'Saturn') {
            const innerR = radius * 1.4;
            const outerR = radius * 2.3;
            const ringGeom = new THREE.RingGeometry(innerR, outerR, 64);

            // Fix UV mapping so texture (if any) maps radially
            const pos = ringGeom.attributes.position;
            const v3 = new THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
                v3.fromBufferAttribute(pos, i);
                ringGeom.attributes.uv.setXY(
                    i,
                    v3.length() < (innerR + outerR) / 2 ? 0 : 1,
                    1,
                );
            }

            const ringMat = new THREE.MeshStandardMaterial({
                color: 0x8c7853,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.8,
                roughness: 0.8,
                metalness: 0.2,
                depthWrite: true,
                depthTest: true,
            });

            const ringMesh = new THREE.Mesh(ringGeom, ringMat);
            ringMesh.rotation.x = Math.PI / 2;
            ringMesh.renderOrder = 10;
            ringMesh.castShadow = true;
            ringMesh.receiveShadow = true;
            mesh.add(ringMesh);
        }

        // Earth atmosphere + clouds
        if (name === 'Earth') {
            // Clouds
            const cloudTex = this.textureLoader.load('./textures/planets/earth/earth_clouds_2048.png');
            cloudTex.colorSpace = THREE.SRGBColorSpace;

            const cloudMesh = createCloudLayer(radius, cloudTex);
            cloudMesh.material.uniforms.cloudOpacity.value = 0.5;
            cloudMesh.material.uniforms.cloudCoverage.value = 0.5;
            cloudMesh.name = 'EarthClouds';
            cloudMesh.userData.isClouds = true;
            mesh.add(cloudMesh);

            // Atmosphere glow
            const atmosphereConfig = { color: 0x4a90e2, enabled: true };
            const atmosphereLayers = createAtmosphere(radius, atmosphereConfig);
            atmosphereLayers.forEach((layer) => mesh.add(layer));
        }
    }
}

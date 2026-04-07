import * as THREE from 'three';
import template from './AxisIndicator.html?raw';
import './AxisIndicator.css';

export class AxisIndicator {
    constructor({ mount = document.getElementById('app') } = {}) {
        this.mount = mount || document.body;
        this.root = null;
        this._mounted = false;
        this.enabled = true;

        this._size = 47;
        this._gizmo = null;
        this._renderer = null;
        this._scene = null;
        this._camera = null;

        this._tmpQ = new THREE.Quaternion();
    }

    mountToDOM() {
        if (this._mounted) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'axis-indicator-root';
        wrapper.innerHTML = template;
        this.mount.appendChild(wrapper);
        this.root = wrapper;

        this.el = this.root.querySelector('#axis-indicator');
        this.canvas = this.root.querySelector('#axis-canvas');

        this._initThree();

        this._mounted = true;
    }

    _initThree() {
        if (!this.canvas) return;

        // Drive size from the canvas attribute so manual edits (e.g. 47) work.
        const size = Math.max(16, Number(this.canvas.width) || this._size);
        this._size = size;
        this.el?.style?.setProperty('--axis-size', `${size}px`);

        // Fit gizmo to canvas size (prevents "clipping" that looks like overflow is hidden).
        const baseSize = 87;
        const fit = Math.min(1, size / baseSize);

        const renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true,
            powerPreference: 'low-power',
        });
        renderer.setSize(size, size, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);

        const scene = new THREE.Scene();

        // Use an orthographic camera so the gizmo can NEVER "clip" due to perspective/framing.
        // We size the frustum to fully contain the longest axis line + label offset.
        const axisLen = 2.6 * fit;
        const labelPad = 0.75 * fit;
        const extent = Math.max(1.2, axisLen + labelPad);
        const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.1, 100);
        camera.position.set(0, 0, 10);
        camera.lookAt(0, 0, 0);

        // Gizmo: simple world axes (just 3 lines + labels)
        const gizmo = new THREE.Group();
        const makeLabelSprite = (text, color) => {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 72px Consolas, "Courier New", monospace';
            ctx.fillStyle = '#000000';
            ctx.globalAlpha = 0.65;
            ctx.fillText(text, 66, 66);
            ctx.globalAlpha = 1;
            ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
            ctx.fillText(text, 64, 64);

            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;

            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
            const sprite = new THREE.Sprite(mat);
            const s = 0.95 * fit;
            sprite.scale.set(s, s, s);
            return sprite;
        };

        const makeAxisLine = (dirVec, color, labelChar) => {
            const length = axisLen;
            const geom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                dirVec.clone().normalize().multiplyScalar(length),
            ]);
            const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
            const line = new THREE.Line(geom, mat);
            gizmo.add(line);

            const label = makeLabelSprite(labelChar, color);
            if (label) {
                label.position.copy(dirVec.clone().normalize().multiplyScalar(length + 0.35 * fit));
                gizmo.add(label);
            }
        };

        makeAxisLine(new THREE.Vector3(1, 0, 0), 0xff3b5c, 'X');
        makeAxisLine(new THREE.Vector3(0, 1, 0), 0x00ff88, 'Y');
        makeAxisLine(new THREE.Vector3(0, 0, 1), 0x00d9ff, 'Z');

        scene.add(gizmo);

        this._renderer = renderer;
        this._scene = scene;
        this._camera = camera;
        this._gizmo = gizmo;
    }

    destroy() {
        if (!this._mounted) return;
        try {
            this._renderer?.dispose?.();
        } catch { /* noop */ }
        this.root?.remove();
        this.root = null;
        this._mounted = false;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (!this.root) return;
        this.root.querySelectorAll('.ui-hideable').forEach(el => {
            el.classList.toggle('hidden', !this.enabled);
        });
    }

    /**
     * Rotate gizmo so it shows WORLD axes in SCREEN space (Minecraft-style).
     * Pass the main scene camera after it has been updated.
     */
    updateFromCamera(camera) {
        if (!this.enabled || !this._mounted || !camera?.quaternion) return;
        if (!this._renderer || !this._scene || !this._camera || !this._gizmo) return;

        // If the main camera rotates, the world axes rotate *opposite* in screen space.
        this._tmpQ.copy(camera.quaternion).invert();
        this._gizmo.quaternion.copy(this._tmpQ);

        this._renderer.render(this._scene, this._camera);
    }
}


import * as THREE from 'three';

class InputManager {
    constructor(canvas, callbacks = {}) {
        this.canvas = canvas;
        this.callbacks = callbacks;
        this.deps = {};

        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false,
            speedUp: false,
            speedDown: false,
            boost: false,
            brake: false
        };

        this.mouse = { x: 0, y: 0 };

        this.controlsEnabled = true;
    }

    setDependencies(deps) {
        this.deps = deps;
    }

    setupControls() {
        window.addEventListener('keydown', (e) => {
            const activeElement = document.activeElement;
            const isTyping = activeElement && (
                activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.isContentEditable
            );
            if (isTyping) return;

            const narratorOpen = this.deps.narratorDialog && this.deps.narratorDialog.isShowing();
            const explorationOpen = this.deps.explorationDialog && this.deps.explorationDialog.isVisible();

            if (narratorOpen || explorationOpen) {
                if (e.code === 'ArrowUp') { this.keys.up = true; e.preventDefault(); return; }
                if (e.code === 'ArrowDown') { this.keys.down = true; e.preventDefault(); return; }
                if (e.code === 'ArrowLeft') { this.keys.left = true; e.preventDefault(); return; }
                if (e.code === 'ArrowRight') { this.keys.right = true; e.preventDefault(); return; }
                if (e.code === 'Escape') return;
                return;
            }

            if (!this.controlsEnabled) return;

            if (e.code === 'KeyW') this.keys.speedUp = true;
            if (e.code === 'KeyS') this.keys.speedDown = true;
            if (e.code === 'ArrowUp') this.keys.up = true;
            if (e.code === 'ArrowDown') this.keys.down = true;
            if (e.code === 'ArrowLeft') this.keys.left = true;
            if (e.code === 'ArrowRight') this.keys.right = true;
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.boost = true;
            if (e.code === 'Space') this.keys.brake = true;

            if (e.code === 'KeyV' || e.key === 'v' || e.key === 'V') this.callbacks.onViewToggle?.();
            if (e.code === 'KeyT') this.callbacks.onToggleNavigator?.();
            if (e.code === 'KeyH') this.callbacks.onToggleUI?.();
            if (e.code === 'KeyN') this.callbacks.onNarrateClosest?.();
            if (e.code === 'KeyP') this.callbacks.onOpenMenu?.();
            if (e.code === 'Escape') {
                this.callbacks.onCloseNavigator?.();
                this.callbacks.onUntarget?.();
            }
        });

        window.addEventListener('keyup', (e) => {
            const narratorOpen = this.deps.narratorDialog && this.deps.narratorDialog.isShowing();
            const explorationOpen = this.deps.explorationDialog && this.deps.explorationDialog.isVisible();

            if (narratorOpen || explorationOpen) {
                if (e.code === 'ArrowUp') this.keys.up = false;
                if (e.code === 'ArrowDown') this.keys.down = false;
                if (e.code === 'ArrowLeft') this.keys.left = false;
                if (e.code === 'ArrowRight') this.keys.right = false;
                return;
            }

            if (!this.controlsEnabled) return;

            if (e.code === 'KeyW') this.keys.speedUp = false;
            if (e.code === 'KeyS') this.keys.speedDown = false;
            if (e.code === 'ArrowUp') this.keys.up = false;
            if (e.code === 'ArrowDown') this.keys.down = false;
            if (e.code === 'ArrowLeft') this.keys.left = false;
            if (e.code === 'ArrowRight') this.keys.right = false;
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.boost = false;
            if (e.code === 'Space') this.keys.brake = false;

            if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') {
                this.keys.speedUp = false;
            }
            if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_') {
                this.keys.speedDown = false;
            }
        });
    }

    setupMouse(canvas) {
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            this.mouse.x = (e.clientX - rect.left - centerX) / (centerX * 0.8);
            this.mouse.y = (e.clientY - rect.top - centerY) / (centerY * 0.8);
            this.mouse.x = Math.max(-1, Math.min(1, this.mouse.x));
            this.mouse.y = Math.max(-1, Math.min(1, this.mouse.y));
        });

        canvas.style.cursor = 'default';

        // Raycasting for planet selection
        const raycaster = new THREE.Raycaster();
        raycaster.params.Points.threshold = 50; // Easier to click stars/points
        const mouseVec = new THREE.Vector2();

        window.addEventListener('click', (event) => {
            const target = event.target;
            if (target.closest('.ui-panel') ||
                target.closest('.modal-overlay') ||
                target.closest('#planet-modal') ||
                target.closest('.planet-exploration-dialog') ||
                target.closest('.exploration-dialog-overlay') ||
                target.closest('.toggle-btn') ||
                target.closest('.spaice-floating-btn') ||
                target.closest('button') ||
                target.closest('input')) {
                return;
            }
            if (event.target.id !== 'canvas') return;

            if (this.deps.spacecraft && this.deps.spacecraft.viewMode === 'COCKPIT') {
                mouseVec.x = 0;
                mouseVec.y = 0;
            } else {
                mouseVec.x = (event.clientX / window.innerWidth) * 2 - 1;
                mouseVec.y = -(event.clientY / window.innerHeight) * 2 + 1;
            }

            if (this.deps.cameraManager && this.deps.cameraManager.camera) {
                raycaster.setFromCamera(mouseVec, this.deps.cameraManager.camera);

                // Only raycast against planet groups (not stars — 109K points would be slow)
                const targets = [];
                if (this.deps.exoplanetField?.meshGroup) targets.push(this.deps.exoplanetField.meshGroup);
                if (this.deps.solarSystemField?.group) targets.push(this.deps.solarSystemField.group);

                const intersects = raycaster.intersectObjects(targets, true);

                if (intersects.length > 0) {
                    // Find the closest hit that has planetData
                    let planetData = null;
                    let hitObject = null;
                    for (const intersect of intersects) {
                        let obj = intersect.object;
                        while (obj) {
                            if (obj.userData?.planetData) {
                                planetData = obj.userData.planetData;
                                hitObject = obj;
                                break;
                            }
                            obj = obj.parent;
                        }
                        if (planetData) break;
                    }

                    if (planetData) {
                        this.callbacks.onPlanetClick?.(planetData, hitObject);
                    }
                }
            }
        });

        // View button
        const viewBtn = document.getElementById('btn-toggle-view');
        if (viewBtn) {
            viewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                viewBtn.blur();
                this.callbacks.onViewToggle?.();
            });
        }
    }
}

export { InputManager };

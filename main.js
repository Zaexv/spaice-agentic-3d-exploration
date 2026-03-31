import * as THREE from 'three';
import { SceneManager } from './src/core/Scene.js';
import { CameraManager } from './src/core/Camera.js';
import { RendererManager } from './src/core/Renderer.js';
import { StarField } from './src/objects/StarField.js';
import { Spacecraft } from './src/objects/Spacecraft.js';
import { PlanetDataService } from './src/services/PlanetDataService.js';
import { ExoplanetField } from './src/objects/ExoplanetField.js';
import { LoadingManager } from './src/utils/LoadingManager.js';
import { PlanetNavigator } from './src/controls/PlanetNavigator.js';
import { PlanetHoverInfo } from './src/utils/PlanetHoverInfo.js';
import { PlanetExplorationDialog } from './src/ui/PlanetExplorationDialog.js';
import { PlanetTargetingSquare } from './src/ui/PlanetTargetingSquare.js';
import { ProximityDetector } from './src/utils/ProximityDetector.js';
import AIService from './src/ai/AIService.js';
import { CONFIG, isAIConfigured } from './src/config/config.js';
import { WarpTunnel } from './src/objects/WarpTunnel.js';
import { GalaxyField } from './src/objects/GalaxyField.js';
import { SpaceDust } from './src/objects/SpaceDust.js';
import { SpaceDebris } from './src/objects/SpaceDebris.js';
import { InputManager } from './src/controls/InputManager.js';
import { HUDManager } from './src/ui/HUDManager.js';
import { TeleportController } from './src/utils/TeleportController.js';

class App {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.loadingManager = new LoadingManager();
        this.controlsEnabled = true;

        this.init();
    }

    async init() {
        this.loadingManager.start(4);

        try {
            // Step 1: Initialize core components
            this.loadingManager.updateStatus('Initializing Engine', 'Setting up 3D renderer...');
            this.sceneManager = new SceneManager();
            this.cameraManager = new CameraManager(this.canvas);
            this.rendererManager = new RendererManager(this.canvas);
            this.clock = new THREE.Clock();
            this.sceneManager.add(this.cameraManager.camera);
            this.loadingManager.completeStep('Engine');

            // Step 2: Setup controls
            this.loadingManager.updateStatus('Configuring Controls', 'Mapping keyboard and mouse...');
            this.hudManager = new HUDManager();
            this.inputManager = new InputManager(this.canvas, {
                onViewToggle: () => this.handleViewToggle(),
                onToggleNavigator: () => this.togglePlanetNavigator(),
                onCloseNavigator: () => this.closePlanetNavigator(),
                onToggleUI: () => this.hudManager.toggleUI(this.planetNavigator),
                onNarrateClosest: () => this.narrateClosestPlanet(),
                onPlanetClick: (planetData, hitObject) => this.handlePlanetClick(planetData, hitObject),
            });
            this.inputManager.setupControls();
            this.inputManager.setupMouse(this.canvas);
            this.loadingManager.completeStep('Controls');

            // Step 3: Build Universe
            this.loadingManager.updateStatus('Building Universe', 'Loading from NASA data clusters...');
            await this.createSceneObjects();
            this.initPlanetSelector();
            this.initExplorationDialog();
            this.initTargetingSquare();

            // Wire up dependencies that exist now
            this.inputManager.setDependencies({
                spacecraft: this.spacecraft,
                explorationDialog: this.explorationDialog,
                cameraManager: this.cameraManager,
                sceneManager: this.sceneManager,
                exoplanetField: this.exoplanetField,
                targetingSquare: this.targetingSquare,
                planetNavigator: this.planetNavigator,
            });

            this.teleportController = new TeleportController(this.spacecraft, this.exoplanetField);
            this.loadingManager.completeStep('Universe');

            // Step 4: Start animation and finalize
            this.loadingManager.updateStatus('Starting Mission', 'Engaging warp drive...');
            this.hudManager.setupUIControls(
                () => this.hudManager.toggleUI(this.planetNavigator),
                () => this.closeModal()
            );
            window.addEventListener('resize', () => this.onWindowResize());
            this.animate();
            this.loadingManager.completeStep('Animation');

            this.loadingManager.finish();

            if (this.spacecraft) this.hudManager.updateViewUI(this.spacecraft);

        } catch (error) {
            console.error('Initialization error:', error);

            if (error.name === 'WebGLNotAvailableError' || error.name === 'WebGLRendererCreationError') {
                this.loadingManager.showWebGLError(error.webglError || {
                    errorMessage: {
                        title: 'WebGL Error',
                        description: error.message,
                        steps: [
                            'Update your browser to the latest version',
                            'Enable hardware acceleration in browser settings',
                            'Update your graphics drivers',
                            'Try a different browser (Chrome, Firefox, Edge, or Safari)'
                        ]
                    },
                    diagnostics: null
                });
            } else {
                this.loadingManager.error(error.message);
            }
        }
    }

    // --- Scene Setup ---

    async createSceneObjects() {
        await this.initializePlanetDataService();
        await this.createEnvironment();
        await this.loadAllPlanets();
        this.createSpacecraft();
    }

    async initializePlanetDataService() {
        this.planetDataService = new PlanetDataService();
        await this.planetDataService.initialize();
    }

    async createEnvironment() {
        this.starField = new StarField(15000, 2000000);
        this.sceneManager.add(this.starField.mesh);

        this.galaxyField = new GalaxyField(5000000, 500);
        this.sceneManager.add(this.galaxyField.group);

        this.warpTunnel = new WarpTunnel();
        this.sceneManager.add(this.warpTunnel.group);

        this.spaceDust = new SpaceDust(2000, 400);
        this.sceneManager.add(this.spaceDust.mesh);

        this.spaceDebris = new SpaceDebris(this.sceneManager.scene, 40, 4000);
    }

    async loadAllPlanets() {
        try {
            this.exoplanetField = new ExoplanetField(this.planetDataService);

            await this.planetDataService.loadSolarSystem();
            await this.exoplanetField.load();

            if (this.exoplanetField.mesh) {
                this.sceneManager.add(this.exoplanetField.mesh);
            }

            this.planets = [];
        } catch (error) {
            console.error('Failed to load planets:', error);
            this.planets = [];
        }
    }

    createSpacecraft() {
        this.spacecraft = new Spacecraft();
        this.sceneManager.add(this.spacecraft.group);
    }

    // --- Planet UI ---

    initPlanetSelector() {
        this.planetNavigator = new PlanetNavigator(
            this.planetDataService,
            (planet) => this.teleportController?.teleportToPlanet(planet)
        );
        this.planetNavigator.loadPlanets();

        setTimeout(() => this.setupSpAIceButton(), 100);

        this.planetHoverInfo = new PlanetHoverInfo(
            this.cameraManager.camera,
            [],
            this.planetDataService
        );
    }

    initExplorationDialog() {
        let aiService = null;

        if (isAIConfigured()) {
            try {
                aiService = new AIService(CONFIG.ai.apiKey);
            } catch (error) {
                console.warn('OpenAI service not initialized:', error.message);
            }
        }

        this.explorationDialog = new PlanetExplorationDialog(aiService, this);
        this.proximityDetector = new ProximityDetector(this.planetDataService, this.exoplanetField);

        window.planetExplorationDialog = this.explorationDialog;
    }

    initTargetingSquare() {
        this.targetingSquare = new PlanetTargetingSquare(this.sceneManager.scene);
    }

    setupSpAIceButton() {
        const spAIceBtn = document.getElementById('spaice-btn');
        if (spAIceBtn) {
            spAIceBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.narrateClosestPlanet();
            });
        }

    }

    // --- Actions ---

    handlePlanetClick(planetData, hitObject) {
        this.lastClickedPlanet = planetData;

        if (this.targetingSquare) {
            const parentGroup = this.exoplanetField?.meshGroup;
            this.targetingSquare.target(hitObject, planetData, parentGroup);
        }

        if (this.explorationDialog) {
            this.explorationDialog.show(planetData);
        }
    }

    handleViewToggle() {
        if (this.spacecraft) {
            this.spacecraft.toggleView();
            this.hudManager.updateViewUI(this.spacecraft);
        }
    }

    togglePlanetNavigator() {
        if (this.planetNavigator) this.planetNavigator.toggle();
    }

    closePlanetNavigator() {
        if (this.planetNavigator) this.planetNavigator.hide();
    }

    showLastClickedPlanetInfo() {
        if (this.lastClickedPlanet && this.explorationDialog) {
            this.explorationDialog.show(this.lastClickedPlanet);
        }
    }

    narrateClosestPlanet() {
        if (!this.spacecraft || !this.proximityDetector || !this.explorationDialog) return;

        if (this.explorationDialog.isVisible()) return;

        const closest = this.proximityDetector.getClosestPlanet(this.spacecraft.group.position);
        if (!closest) return;

        if (this.targetingSquare && closest.mesh) {
            const parentGroup = this.exoplanetField?.meshGroup;
            this.targetingSquare.target(closest.mesh, closest.planet, parentGroup);
        }

        this.explorationDialog.show(closest.planet);
    }

    closeModal() {
        const modal = document.getElementById('planet-modal');
        const overlay = document.getElementById('modal-overlay');
        if (modal) modal.classList.remove('visible');
        if (overlay) overlay.classList.remove('visible');
    }

    // --- Animation Loop ---

    animate() {
        requestAnimationFrame(() => this.animate());

        const deltaTime = this.clock.getDelta();

        if (this.planets) {
            this.planets.forEach(planet => planet.update(deltaTime));
        }

        if (this.exoplanetField) {
            const spacecraftPos = this.spacecraft ? this.spacecraft.getPosition() : null;
            this.exoplanetField.update(deltaTime, spacecraftPos);
        }

        if (this.spacecraft) {
            this.spacecraft.steer(this.inputManager.keys, deltaTime, this.inputManager.mouse);

            const nearbyObjects = this.sceneManager.scene.children.filter(obj => obj.userData && obj.userData.planetData);
            this.spacecraft.update(deltaTime, nearbyObjects);
            this.spacecraft.updateCamera(this.cameraManager.camera);

            this.hudManager.updateHUD(this.spacecraft, this.targetingSquare);
        }

        if (this.planetHoverInfo) {
            this.planetHoverInfo.update();
        }

        if (this.warpTunnel && this.spacecraft) {
            this.warpTunnel.update(
                deltaTime,
                this.spacecraft.getSpeed(),
                this.cameraManager.camera.position,
                this.cameraManager.camera.quaternion
            );
        }

        if (this.spaceDust && this.spacecraft) {
            const speed = this.spacecraft.getSpeed();
            const direction = new THREE.Vector3(0, 0, -1);
            direction.applyQuaternion(this.spacecraft.group.quaternion);
            this.spaceDust.update(this.spacecraft.group.position, speed, direction);
        }

        if (this.nebulaField && this.spacecraft) {
            this.nebulaField.update(deltaTime, this.spacecraft.group.position);
        }

        if (this.spaceDebris && this.spacecraft) {
            this.spaceDebris.update(deltaTime, this.spacecraft.group.position);
        }

        if (this.targetingSquare) {
            this.targetingSquare.update(this.cameraManager.camera);
        }

        this.rendererManager.render(
            this.sceneManager.scene,
            this.cameraManager.camera
        );
    }

    onWindowResize() {
        this.cameraManager.updateAspect(this.canvas);
        this.rendererManager.updateSize(this.canvas);
    }

    dispose() {
        this.planets?.forEach(planet => planet.dispose());
        this.rendererManager.dispose();
        this.exoplanetField?.dispose();
        this.dynamicStarField?.dispose();
    }
}

// Initialize application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.app = new App();
    });
} else {
    window.app = new App();
}

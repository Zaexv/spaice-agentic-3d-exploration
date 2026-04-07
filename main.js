import * as THREE from 'three';
import { SceneManager } from './src/core/Scene.js';
import { CameraManager } from './src/core/Camera.js';
import { RendererManager } from './src/core/Renderer.js';
import { RealStarField } from './src/objects/RealStarField.js';
import { Spacecraft } from './src/objects/Spacecraft.js';
import { PlanetDataService } from './src/services/PlanetDataService.js';
import { SimulationClock } from './src/services/SimulationClock.js';
import { SolarSystemService } from './src/services/SolarSystemService.js';
import { SolarSystemField } from './src/objects/SolarSystemField.js';
import { ExoplanetField } from './src/objects/ExoplanetField.js';
import { LoadingManager } from './src/utils/LoadingManager.js';
import { PlanetNavigator } from './src/controls/PlanetNavigator.js';
import { PlanetHoverInfo } from './src/utils/PlanetHoverInfo.js';
import { PlanetExplorationDialog } from './src/ui/PlanetExplorationDialog.js';
import { PlanetTargetingSquare } from './src/ui/PlanetTargetingSquare.js';
import { ProximityDetector } from './src/utils/ProximityDetector.js';
import AIService from './src/ai/AIService.js';
import { NarratorDialog } from './src/ui/NarratorDialog.js';
import { CONFIG, isAIConfigured } from './src/config/config.js';
// WarpTunnel removed — clean space view
import { InputManager } from './src/controls/InputManager.js';
import { HUDManager } from './src/ui/HUDManager.js';
import { TeleportController } from './src/utils/TeleportController.js';
import { HelpPanel } from './src/ui/help-panel/HelpPanel.js';
import { FlightHUD } from './src/ui/flight-hud/FlightHUD.js';
import { AxisIndicator } from './src/ui/axis-indicator/AxisIndicator.js';

class App {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.loadingManager = new LoadingManager();
        this.controlsEnabled = true;
        this._solarMode = true;

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
            this.helpPanel = new HelpPanel();
            this.helpPanel.mountToDOM();
            this.hudManager.setHelpPanel(this.helpPanel);
            this.flightHUD = new FlightHUD();
            this.flightHUD.mountToDOM();
            this.hudManager.setFlightHUD(this.flightHUD);
            this.axisIndicator = new AxisIndicator();
            this.axisIndicator.mountToDOM();
            this.hudManager.setAxisIndicator(this.axisIndicator);
            this.inputManager = new InputManager(this.canvas, {
                onViewToggle: () => this.handleViewToggle(),
                onToggleNavigator: () => this.togglePlanetNavigator(),
                onCloseNavigator: () => this.closePlanetNavigator(),
                onToggleUI: () => this.hudManager.toggleUI(this.planetNavigator),
                onNarrateClosest: () => this.narrateClosestPlanet(),
                onPlanetClick: (planetData, hitObject) => this.handlePlanetClick(planetData, hitObject),
                onUntarget: () => this.untargetPlanet(),
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
                narratorDialog: this.narratorDialog,
                cameraManager: this.cameraManager,
                sceneManager: this.sceneManager,
                exoplanetField: this.exoplanetField,
                solarSystemField: this.solarSystemField,
                targetingSquare: this.targetingSquare,
                planetNavigator: this.planetNavigator,
            });

            this.teleportController = new TeleportController(this.spacecraft, this.exoplanetField, this.solarSystemField);
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
        this.simulationClock = new SimulationClock();
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
        // Real stars from HYG database (109K+ real stars with accurate positions and colors)
        this.realStarField = new RealStarField();
        await this.realStarField.load();
        this.sceneManager.add(this.realStarField.mesh);
    }

    async loadAllPlanets() {
        try {
            // Solar system (live ephemeris)
            this.solarSystemService = new SolarSystemService(this.simulationClock);
            this.solarSystemField = new SolarSystemField(this.solarSystemService);
            await this.solarSystemField.load();
            this.sceneManager.add(this.solarSystemField.mesh);

            // Register solar system bodies in the planet data service
            // so they appear in PlanetNavigator and ProximityDetector
            const solarBodies = this.solarSystemService.getBodyPositions();
            for (const body of solarBodies) {
                this.planetDataService.allPlanets.push(body);
            }

            // Exoplanets (from NASA cluster JSONs)
            this.exoplanetField = new ExoplanetField(this.planetDataService);
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
        this.proximityDetector = new ProximityDetector(this.planetDataService, this.exoplanetField, this.solarSystemField);
        this.narratorDialog = new NarratorDialog(aiService);

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
            const parentGroup = hitObject.userData?.isSolar
                ? this.solarSystemField?.group
                : this.exoplanetField?.meshGroup;
            this.targetingSquare.target(hitObject, planetData, parentGroup);
        }

        if (this.explorationDialog) {
            this.explorationDialog.show(planetData);
        }
    }

    untargetPlanet() {
        if (this.targetingSquare) this.targetingSquare.hide();
        if (this.explorationDialog) this.explorationDialog.hide?.();
        if (this.narratorDialog && this.narratorDialog.isShowing()) this.narratorDialog.hide?.();
        this.lastClickedPlanet = null;
        this.closeModal();
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
        if (!this.spacecraft || !this.proximityDetector || !this.narratorDialog) return;

        if (this.narratorDialog.isShowing()) return;

        const closest = this.proximityDetector.getClosestPlanet(this.spacecraft.group.position);
        if (!closest) return;

        if (this.targetingSquare && closest.mesh) {
            const parentGroup = closest.mesh.userData?.isSolar
                ? this.solarSystemField?.group
                : this.exoplanetField?.meshGroup;
            this.targetingSquare.target(closest.mesh, closest.planet, parentGroup);
        }

        this.narratorDialog.show(closest.planet);
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

        // Advance simulation clock
        if (this.simulationClock) {
            this.simulationClock.update(deltaTime);
        }

        if (this.planets) {
            this.planets.forEach(planet => planet.update(deltaTime));
        }

        // Update solar system positions from ephemeris
        if (this.solarSystemField) {
            this.solarSystemField.update(deltaTime);
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

            this.hudManager.updateHUD(this.spacecraft, this.targetingSquare, this.cameraManager.camera);
        }

        if (this.planetHoverInfo) {
            this.planetHoverInfo.update();
        }

        if (this.targetingSquare) {
            this.targetingSquare.update(this.cameraManager.camera);
        }

        // ─── Adaptive Scale: Switch between solar and interstellar mode ─────
        if (this.spacecraft && this.solarSystemField && this.exoplanetField) {
            const distFromSun = this.spacecraft.group.position.length();
            const THRESHOLD = 600000; // SOLAR_MODE_RADIUS from SceneConstants

            if (distFromSun < THRESHOLD) {
                // SOLAR MODE
                if (!this._solarMode) {
                    this._solarMode = true;
                    this.solarSystemField.group.visible = true;
                    this.exoplanetField.meshGroup.visible = false;
                    this.cameraManager.camera.near = 1;
                    this.cameraManager.camera.far = 2000000;
                    this.cameraManager.camera.updateProjectionMatrix();
                }
            } else {
                // INTERSTELLAR MODE
                if (this._solarMode !== false) {
                    this._solarMode = false;
                    this.solarSystemField.group.visible = false;
                    this.exoplanetField.meshGroup.visible = true;
                    this.cameraManager.camera.near = 1;
                    this.cameraManager.camera.far = 20000000;
                    this.cameraManager.camera.updateProjectionMatrix();
                }
            }
            // Stars always visible
            if (this.realStarField?.mesh) this.realStarField.mesh.visible = true;
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
        this.solarSystemField?.dispose();
        this.realStarField?.dispose();
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

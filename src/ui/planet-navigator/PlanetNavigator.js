/**
 * PlanetNavigator - UI for quick planet navigation
 *
 * Decoupled into src/ui/planet-navigator (HTML/CSS/JS).
 * Still exposes `container` so other UIs (pause menu) can embed it.
 */
import template from './PlanetNavigator.html?raw';
import './PlanetNavigator.css';

export class PlanetNavigator {
    constructor(planetDataService, onPlanetSelect) {
        this.dataService = planetDataService;
        this.onPlanetSelect = onPlanetSelect;
        this.nearbyPlanets = [];
        this.filteredPlanets = [];
        this.currentPage = 0;
        this.planetsPerPage = 5;

        this.createUI();
        this.attachEventListeners();
    }

    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'planet-navigator';
        this.container.className = 'planet-navigator';
        this.container.innerHTML = template;
        document.body.appendChild(this.container);
    }

    attachEventListeners() {
        // Search
        const search = this.container.querySelector('#nav-search');
        if (search) {
            search.addEventListener('input', (e) => this.handleSearch(e.target.value));
        }

        // Filter buttons (scoped)
        this.container.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.applyFilter(btn.dataset.filter);
            });
        });

        // Pagination
        const prev = this.container.querySelector('#nav-prev');
        const next = this.container.querySelector('#nav-next');
        if (prev) prev.addEventListener('click', () => this.prevPage());
        if (next) next.addEventListener('click', () => this.nextPage());

        // Toggle minimize (kept for compatibility; pause-menu hides it)
        const toggle = this.container.querySelector('#nav-toggle');
        if (toggle) toggle.addEventListener('click', () => this.toggle());

        // Click container when minimized to expand
        this.container.addEventListener('click', (e) => {
            if (this.container.classList.contains('minimized') && !e.target.closest('#nav-toggle')) {
                this.show();
            }
        });
    }

    async loadPlanets() {
        try {
            console.log('🗺️ Navigator: Waiting for all planet data...');

            this.nearbyPlanets = this.dataService.getAllPlanets();
            this.filteredPlanets = this.nearbyPlanets;
            this.renderPlanetList();

            const updateInterval = setInterval(() => {
                const currentCount = this.dataService.getAllPlanets().length;
                if (currentCount > this.nearbyPlanets.length) {
                    this.nearbyPlanets = this.dataService.getAllPlanets();
                    this.filteredPlanets = this.nearbyPlanets;
                    this.renderPlanetList();
                    console.log(`🗺️ Navigator updated: ${this.nearbyPlanets.length} planets`);
                }
            }, 2000);

            await this.waitForAllClusters();
            clearInterval(updateInterval);

            this.nearbyPlanets = this.dataService.getAllPlanets();
            this.filteredPlanets = this.nearbyPlanets;
            const stats = this.dataService.getStats();
            console.log(`✓ Navigator complete: ${this.nearbyPlanets.length} planets from ${stats.clustersLoaded} clusters`);
            this.renderPlanetList();
        } catch (error) {
            console.error('❌ Navigator: Error loading planets:', error);
            const listElement = this.container.querySelector('#nav-planet-list');
            if (listElement) {
                listElement.innerHTML = `
                    <div class="nav-error">
                        <p>❌ Failed to load planet data</p>
                        <p style="font-size: 12px;">${error.message}</p>
                    </div>
                `;
            }
        }
    }

    async waitForAllClusters() {
        const clusterIndex = await this.dataService.initialize();
        const totalClusters = Object.keys(clusterIndex.clusters).length;

        console.log(`🗺️ Navigator: Waiting for ${totalClusters} clusters to load...`);

        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const stats = this.dataService.getStats();
                if (stats.clustersLoaded >= totalClusters) {
                    console.log(`✅ Navigator: All ${stats.clustersLoaded} clusters loaded!`);
                    console.log(`📋 Loaded clusters: ${stats.clusterNames.join(', ')}`);
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 1000);

            setTimeout(() => {
                clearInterval(checkInterval);
                const stats = this.dataService.getStats();
                console.warn(`⚠️ Navigator: Timeout after 60s (${stats.clustersLoaded}/${totalClusters} clusters loaded)`);
                resolve();
            }, 60000);
        });
    }

    handleSearch(query) {
        if (!query) {
            this.nearbyPlanets = this.dataService.getAllPlanets();
        } else {
            this.nearbyPlanets = this.dataService.searchByName(query);
        }
        this.filteredPlanets = this.nearbyPlanets;
        this.currentPage = 0;
        this.renderPlanetList();
    }

    applyFilter(filter) {
        const allPlanets = this.dataService.getAllPlanets();

        switch (filter) {
            case 'habitable':
                this.nearbyPlanets = allPlanets.filter(p => (p.characteristics?.habitability_percent || 0) > 50);
                break;
            case 'nearby':
                this.nearbyPlanets = allPlanets.filter(p => (p.sy_dist || 0) * 3.262 < 100);
                break;
            default:
                this.nearbyPlanets = allPlanets;
        }

        this.filteredPlanets = this.nearbyPlanets;
        this.currentPage = 0;
        this.renderPlanetList();
    }

    renderPlanetList() {
        const list = this.container.querySelector('#nav-planet-list');
        if (!list) return;

        if (!this.filteredPlanets || this.filteredPlanets.length === 0) {
            const stats = this.dataService.getStats();
            list.innerHTML = `
                <div class="nav-loading">
                    <p>⏳ Loading planets...</p>
                    <p style="font-size: 12px;">${stats.clustersLoaded} clusters loaded</p>
                </div>
            `;
            return;
        }

        const startIdx = this.currentPage * this.planetsPerPage;
        const endIdx = startIdx + this.planetsPerPage;
        const planetsToShow = this.filteredPlanets.slice(startIdx, endIdx);

        if (planetsToShow.length === 0) {
            list.innerHTML = '<div class="nav-no-results">No planets found</div>';
            return;
        }

        list.innerHTML = planetsToShow.map(planet => {
            const name = planet.pl_name || 'Unknown Planet';
            const distance = planet.sy_dist !== undefined && planet.sy_dist !== null
                ? `${planet.sy_dist.toFixed(6)} pc`
                : 'Unknown';
            const habitability = planet.characteristics?.habitability_percent || 0;
            const toxicity = planet.characteristics?.toxicity_percent || 0;
            const type = planet.characteristics?.radius_position || 'Unknown';
            const atmosphere = planet.characteristics?.atmosphere_type || 'Unknown';
            const material = planet.characteristics?.principal_material || 'Unknown';
            const radius = planet.pl_rade ? `${planet.pl_rade.toFixed(2)}` : 'N/A';
            const mass = planet.pl_bmasse ? `${planet.pl_bmasse.toFixed(2)}` : 'N/A';

            let habClass = 'low';
            if (habitability >= 70) habClass = 'high';
            else if (habitability >= 40) habClass = 'medium';

            return `
                <div class="nav-planet-item" data-planet="${name}">
                    <div class="nav-planet-header">
                        <div class="nav-planet-name">${name}</div>
                        <button class="nav-go-btn" data-planet-name="${name}">GO →</button>
                    </div>
                    <div class="nav-planet-details">
                        <div class="nav-detail-row">
                            <span class="nav-label">📍 Distance:</span>
                            <span class="nav-value">${distance}</span>
                        </div>
                        <div class="nav-detail-row">
                            <span class="nav-label">🌍 Type:</span>
                            <span class="nav-value">${type}</span>
                        </div>
                        <div class="nav-detail-row">
                            <span class="nav-label">📏 Radius:</span>
                            <span class="nav-value">${radius}</span>
                        </div>
                        <div class="nav-detail-row">
                            <span class="nav-label">⚖️ Mass:</span>
                            <span class="nav-value">${mass}</span>
                        </div>
                        <div class="nav-detail-row">
                            <span class="nav-label">🌫️ Atmosphere:</span>
                            <span class="nav-value nav-value-small">${atmosphere}</span>
                        </div>
                        <div class="nav-detail-row">
                            <span class="nav-label">🪨 Material:</span>
                            <span class="nav-value nav-value-small">${material}</span>
                        </div>
                        <div class="nav-metrics">
                            <div class="nav-metric">
                                <span class="nav-metric-label">Habitability</span>
                                <div class="nav-metric-bar ${habClass}">
                                    <div class="nav-metric-fill" style="width: ${habitability}%"></div>
                                </div>
                                <span class="nav-metric-value ${habClass}">${habitability}%</span>
                            </div>
                            <div class="nav-metric">
                                <span class="nav-metric-label">Toxicity</span>
                                <div class="nav-metric-bar toxicity">
                                    <div class="nav-metric-fill" style="width: ${toxicity}%"></div>
                                </div>
                                <span class="nav-metric-value toxicity">${toxicity}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.nav-go-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const planetName = btn.dataset.planetName;
                const planet = this.dataService.getPlanetByName(planetName);
                if (planet && this.onPlanetSelect) this.onPlanetSelect(planet);
            });
        });

        this.updatePagination();
    }

    updatePagination() {
        const totalPages = Math.ceil(this.filteredPlanets.length / this.planetsPerPage);
        const pageInfo = this.container.querySelector('#nav-page-info');
        const prevBtn = this.container.querySelector('#nav-prev');
        const nextBtn = this.container.querySelector('#nav-next');
        if (!pageInfo || !prevBtn || !nextBtn) return;

        const startIdx = this.currentPage * this.planetsPerPage + 1;
        const endIdx = Math.min((this.currentPage + 1) * this.planetsPerPage, this.filteredPlanets.length);

        pageInfo.textContent = `${startIdx}-${endIdx} of ${this.filteredPlanets.length} planets`;
        prevBtn.disabled = this.currentPage === 0;
        nextBtn.disabled = this.currentPage >= totalPages - 1;
    }

    prevPage() {
        if (this.currentPage > 0) {
            this.currentPage--;
            this.renderPlanetList();
        }
    }

    nextPage() {
        const totalPages = Math.ceil(this.filteredPlanets.length / this.planetsPerPage);
        if (this.currentPage < totalPages - 1) {
            this.currentPage++;
            this.renderPlanetList();
        }
    }

    toggle() {
        this.container.classList.toggle('minimized');
        const toggleBtn = this.container.querySelector('#nav-toggle');
        if (!toggleBtn) return;
        toggleBtn.textContent = this.container.classList.contains('minimized') ? '▶ Show' : '◀ Minimize';
    }

    show() {
        this.container.classList.remove('minimized');
        const toggleBtn = this.container.querySelector('#nav-toggle');
        if (toggleBtn) toggleBtn.textContent = '◀ Minimize';
    }

    hide() {
        this.container.classList.add('minimized');
        const toggleBtn = this.container.querySelector('#nav-toggle');
        if (toggleBtn) toggleBtn.textContent = '▶ Show';
    }

    dispose() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}


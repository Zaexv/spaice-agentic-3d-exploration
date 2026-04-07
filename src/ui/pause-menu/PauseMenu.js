import template from './PauseMenu.html?raw';
import './PauseMenu.css';

export class PauseMenu {
    constructor({ mount = document.getElementById('app') } = {}) {
        this.mount = mount || document.body;
        this.root = null;
        this._mounted = false;

        this._paused = false;
        this._view = 'menu'; // 'menu' | 'navigator'

        this._onPauseChange = null;
        this._planetNavigator = null;
        this._navigatorOriginalParent = null;
        this._navigatorOriginalNextSibling = null;
    }

    mountToDOM() {
        if (this._mounted) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'pause-menu-root';
        wrapper.innerHTML = template;
        this.mount.appendChild(wrapper);
        this.root = wrapper;

        this.pauseBtn = this.root.querySelector('#pause-btn');
        this.overlay = this.root.querySelector('#pause-overlay');
        this.modal = this.root.querySelector('#pause-modal');
        this.closeBtn = this.root.querySelector('#pause-close');
        this.backBtn = this.root.querySelector('#pause-back');
        this.titleEl = this.root.querySelector('#pause-title');

        this.viewMenu = this.root.querySelector('#pause-view-menu');
        this.viewNavigator = this.root.querySelector('#pause-view-navigator');
        this.navHost = this.root.querySelector('#pause-navigator-host');

        this.openNavigatorBtn = this.root.querySelector('#pause-open-navigator');
        this.resetBtn = this.root.querySelector('#pause-reset');

        this.pauseBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.open();
        });
        this.overlay?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        this.closeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        this.backBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setView('menu');
        });
        this.openNavigatorBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setView('navigator');
        });
        this.resetBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            // Easiest reliable "reset to first open"
            window.location.reload();
        });

        this.setView('menu');
        this.close();

        this._mounted = true;
    }

    onPauseChange(cb) {
        this._onPauseChange = cb;
    }

    setPlanetNavigator(planetNavigator) {
        this._planetNavigator = planetNavigator || null;
        // Hide from the main screen; it will only be shown when embedded.
        if (this._planetNavigator?.container) {
            this._planetNavigator.container.style.display = 'none';
        }
    }

    open() {
        if (!this._mounted) return;
        this.modal?.classList.add('visible');
        this.overlay?.classList.add('visible');
        this.setPaused(true);
        this.setView('menu');
    }

    close() {
        if (!this._mounted) return;
        this.modal?.classList.remove('visible');
        this.overlay?.classList.remove('visible');
        this._restoreNavigator();
        this.setPaused(false);
    }

    setPaused(paused) {
        const next = Boolean(paused);
        if (this._paused === next) return;
        this._paused = next;
        this._onPauseChange?.(next);
    }

    setView(view) {
        this._view = view === 'navigator' ? 'navigator' : 'menu';

        if (this.viewMenu) this.viewMenu.classList.toggle('visible', this._view === 'menu');
        if (this.viewNavigator) this.viewNavigator.classList.toggle('visible', this._view === 'navigator');

        if (this.backBtn) this.backBtn.style.visibility = this._view === 'navigator' ? 'visible' : 'hidden';
        if (this.titleEl) this.titleEl.textContent = this._view === 'navigator' ? 'Planet Navigator' : 'Menu';

        if (this._view === 'navigator') {
            this._embedNavigator();
        } else {
            this._restoreNavigator();
        }
    }

    _embedNavigator() {
        const nav = this._planetNavigator?.container;
        if (!nav || !this.navHost) return;

        if (!this._navigatorOriginalParent) {
            this._navigatorOriginalParent = nav.parentNode;
            this._navigatorOriginalNextSibling = nav.nextSibling;
        }

        nav.style.display = 'block';
        nav.classList.remove('minimized');
        this.navHost.appendChild(nav);
    }

    _restoreNavigator() {
        const nav = this._planetNavigator?.container;
        if (!nav) return;

        if (!this._navigatorOriginalParent) return;

        // Restore to original position in DOM.
        if (this._navigatorOriginalNextSibling && this._navigatorOriginalNextSibling.parentNode === this._navigatorOriginalParent) {
            this._navigatorOriginalParent.insertBefore(nav, this._navigatorOriginalNextSibling);
        } else {
            this._navigatorOriginalParent.appendChild(nav);
        }

        // Keep hidden outside the pause menu.
        nav.style.display = 'none';
    }
}


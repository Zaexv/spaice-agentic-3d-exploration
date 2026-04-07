import template from './FlightHUD.html?raw';
import './FlightHUD.css';

export class FlightHUD {
    constructor({ mount = document.getElementById('app') } = {}) {
        this.mount = mount || document.body;
        this.root = null;
        this._mounted = false;
        this.enabled = true;
    }

    mountToDOM() {
        if (this._mounted) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'flight-hud-root';
        wrapper.innerHTML = template;
        this.mount.appendChild(wrapper);
        this.root = wrapper;
        this._mounted = true;
    }

    destroy() {
        if (!this._mounted) return;
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
}


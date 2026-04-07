import template from './UIVisibilityToggle.html?raw';
import './UIVisibilityToggle.css';

export class UIVisibilityToggle {
    constructor({ mount = document.getElementById('app') } = {}) {
        this.mount = mount || document.body;
        this.root = null;
        this._mounted = false;
        this.hidden = false;
    }

    mountToDOM() {
        if (this._mounted) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'ui-visibility-toggle-root';
        wrapper.innerHTML = template;
        this.mount.appendChild(wrapper);
        this.root = wrapper;

        this.btn = this.root.querySelector('#ui-visibility-btn');
        this.icon = this.btn?.querySelector('.material-symbols-outlined');

        this.btn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        this._apply();
        this._mounted = true;
    }

    toggle() {
        this.setHidden(!this.hidden);
    }

    setHidden(hidden) {
        this.hidden = Boolean(hidden);
        this._apply();
    }

    _apply() {
        document.body.classList.toggle('ui-hidden', this.hidden);
        if (this.icon) {
            this.icon.textContent = this.hidden ? 'visibility_off' : 'visibility';
        }
    }
}


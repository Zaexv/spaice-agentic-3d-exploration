import template from './HelpPanel.html?raw';
import './HelpPanel.css';

export class HelpPanel {
    constructor({ mount = document.getElementById('app') } = {}) {
        this.mount = mount || document.body;
        this.enabled = true;
        this.root = null;
        this._mounted = false;
        this.isOpen = false;

        this._onHelpClick = this._onHelpClick.bind(this);
        this._onCloseClick = this._onCloseClick.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    mountToDOM() {
        if (this._mounted) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'help-panel-root';
        wrapper.innerHTML = template;
        this.mount.appendChild(wrapper);
        this.root = wrapper;

        this.helpBtn = this.root.querySelector('#controls-help-btn');
        this.modal = this.root.querySelector('#controls-modal');
        this.overlay = this.root.querySelector('#controls-modal-overlay');
        this.closeBtn = this.root.querySelector('#controls-modal-close');

        if (this.helpBtn) this.helpBtn.addEventListener('click', this._onHelpClick);
        if (this.closeBtn) this.closeBtn.addEventListener('click', this._onCloseClick);
        window.addEventListener('keydown', this._onKeyDown, true);

        // Start closed.
        this.close();

        this._mounted = true;
    }

    destroy() {
        if (!this._mounted) return;
        if (this.helpBtn) this.helpBtn.removeEventListener('click', this._onHelpClick);
        if (this.closeBtn) this.closeBtn.removeEventListener('click', this._onCloseClick);
        window.removeEventListener('keydown', this._onKeyDown, true);
        this.root?.remove();
        this.root = null;
        this._mounted = false;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (!this.helpBtn) return;
        this.helpBtn.style.opacity = this.enabled ? '1' : '0.3';
        this.helpBtn.style.pointerEvents = this.enabled ? 'auto' : 'none';
        if (!this.enabled) this.close();
    }

    open() {
        if (!this.enabled) return;
        if (this.modal) this.modal.classList.add('visible');
        if (this.overlay) this.overlay.classList.add('visible');
        this.isOpen = true;
    }

    close() {
        if (this.modal) this.modal.classList.remove('visible');
        if (this.overlay) this.overlay.classList.remove('visible');
        this.isOpen = false;
    }

    _onHelpClick(e) {
        e.stopPropagation();
        this.open();
    }

    _onCloseClick(e) {
        e.stopPropagation();
        this.close();
    }

    _onKeyDown(e) {
        if (e.code !== 'Escape') return;
        if (!this.isOpen) return;
        e.preventDefault();
        e.stopPropagation();
        this.close();
    }
}


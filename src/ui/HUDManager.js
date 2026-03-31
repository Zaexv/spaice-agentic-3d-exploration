/**
 * HUDManager - Manages HUD display updates and UI visibility
 */

export class HUDManager {
    constructor() {
        this.uiVisible = true;
    }

    updateHUD(spacecraft, targetingSquare) {
        if (!spacecraft) return;

        const position = spacecraft.group.position;
        const rotation = spacecraft.group.rotation;

        const velElem = document.getElementById('hud-velocity');
        const cockpitSpd = document.getElementById('cockpit-speed');
        const actualSpeed = spacecraft.getSpeed();
        if (velElem) velElem.textContent = `${actualSpeed.toFixed(2)} u/s`;
        if (cockpitSpd) cockpitSpd.textContent = `SPD: ${actualSpeed.toFixed(2)}`;

        const posX = document.getElementById('hud-pos-x');
        const posY = document.getElementById('hud-pos-y');
        const posZ = document.getElementById('hud-pos-z');
        if (posX) posX.textContent = (position.x / 10).toFixed(2);
        if (posY) posY.textContent = (position.y / 10).toFixed(2);
        if (posZ) posZ.textContent = (position.z / 10).toFixed(2);

        const heading = document.getElementById('hud-heading');
        if (heading) {
            const degrees = ((rotation.y * 180 / Math.PI) % 360 + 360) % 360;
            heading.textContent = `${degrees.toFixed(1)}°`;
        }

        this.updateTargetDisplay(targetingSquare);
    }

    updateTargetDisplay(targetingSquare) {
        const targetElem = document.querySelector('.cockpit-data-right .data-line');
        if (!targetElem) return;

        if (targetingSquare && targetingSquare.isTargeting() && targetingSquare.planetData) {
            const planetName = targetingSquare.planetData.pl_name || 'Unknown';
            targetElem.textContent = `TARGET: ${planetName}`;
        } else {
            targetElem.textContent = 'TARGET: NONE';
        }
    }

    updateViewUI(spacecraft) {
        const overlay = document.getElementById('cockpit-overlay');
        if (spacecraft.viewMode === 'COCKPIT') {
            if (overlay) overlay.classList.add('visible');
        } else {
            if (overlay) overlay.classList.remove('visible');
        }
    }

    toggleUI(planetNavigator) {
        this.uiVisible = !this.uiVisible;

        const panels = document.querySelectorAll('.ui-panel:not(#planet-modal)');
        panels.forEach(panel => {
            if (this.uiVisible) {
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
        });

        if (planetNavigator) {
            planetNavigator.container.style.display = this.uiVisible ? 'flex' : 'none';
        }

        const toggleBtn = document.getElementById('toggle-ui-btn');
        if (toggleBtn) {
            toggleBtn.style.opacity = this.uiVisible ? '1' : '0.3';
        }
    }

    setupUIControls(toggleCallback, closeModalCallback) {
        const toggleBtn = document.getElementById('toggle-ui-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCallback();
            });
        }

        const modalClose = document.getElementById('modal-close');
        const modalOverlay = document.getElementById('modal-overlay');
        if (modalClose) {
            modalClose.addEventListener('click', (e) => {
                e.stopPropagation();
                closeModalCallback();
            });
        }
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                e.stopPropagation();
                closeModalCallback();
            });
        }
    }
}

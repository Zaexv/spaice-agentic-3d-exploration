import * as THREE from 'three';

export class TeleportController {
    constructor(spacecraft, exoplanetField) {
        this.spacecraft = spacecraft;
        this.exoplanetField = exoplanetField;
    }

    teleportToPlanet(planet) {
        if (!planet) return;

        console.log(`🚀 Teleporting to ${planet.pl_name}`);

        let targetPosition;
        const globalScale = 10000;

        const isSolarPlanet = planet.hostname === 'Sun';
        if (isSolarPlanet && planet.position) {
            targetPosition = new THREE.Vector3(
                planet.position.x * 10 * globalScale,
                planet.position.y * 10 * globalScale,
                planet.position.z * 10 * globalScale
            );
        }
        else if (planet.characteristics?.coordinates_3d) {
            const coords = planet.characteristics.coordinates_3d;
            targetPosition = new THREE.Vector3(
                coords.x_light_years * 10 * globalScale,
                coords.y_light_years * 10 * globalScale,
                coords.z_light_years * 10 * globalScale
            );
        }

        if (!targetPosition) {
            console.warn(`Cannot teleport to ${planet.pl_name}: No coordinates available`);
            return;
        }

        this.createTeleportFlash();

        const planetRadius = (planet.pl_rade || 1.0) * 0.5 * globalScale;
        const offset = planetRadius * 1.5;
        const direction = targetPosition.clone().normalize();
        const approachPosition = targetPosition.clone().sub(direction.multiplyScalar(offset));

        setTimeout(() => {
            this.spacecraft.group.position.copy(approachPosition);

            if (this.spacecraft.velocity) {
                this.spacecraft.velocity.set(0, 0, 0);
                this.spacecraft.forwardSpeed = 100.0;
            }

            this.spacecraft.group.lookAt(targetPosition);

            if (this.exoplanetField) {
                this.exoplanetField.forceRefreshLOD(this.spacecraft.getPosition());
            }

            console.log(`✓ Teleported to ${planet.pl_name} at distance ${offset.toFixed(0)} units`);
        }, 200);
    }

    createTeleportFlash() {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: radial-gradient(circle, rgba(0,212,255,0.9) 0%, rgba(255,255,255,0.7) 30%, rgba(0,212,255,0.4) 70%, transparent 100%);
            pointer-events: none;
            z-index: 10000;
            opacity: 0;
            animation: teleportFlash 0.6s cubic-bezier(0.23, 1, 0.32, 1);
        `;

        if (!document.getElementById('teleport-flash-animation')) {
            const style = document.createElement('style');
            style.id = 'teleport-flash-animation';
            style.textContent = `
                @keyframes teleportFlash {
                    0% { opacity: 0; transform: scale(0.8); }
                    15% { opacity: 1; transform: scale(1.1); }
                    50% { opacity: 1; transform: scale(1.2); }
                    100% { opacity: 0; transform: scale(1); }
                }

                @keyframes screenShake {
                    0%, 100% { transform: translate(0, 0); }
                    10% { transform: translate(-5px, 2px); }
                    20% { transform: translate(5px, -2px); }
                    30% { transform: translate(-5px, -2px); }
                    40% { transform: translate(5px, 2px); }
                    50% { transform: translate(-5px, 2px); }
                    60% { transform: translate(5px, -2px); }
                    70% { transform: translate(-5px, -2px); }
                    80% { transform: translate(5px, 2px); }
                    90% { transform: translate(-5px, 2px); }
                }

                .camera-shake {
                    animation: screenShake 0.4s cubic-bezier(.36,.07,.19,.97);
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(flash);

        const canvas = document.getElementById('canvas');
        if (canvas) {
            canvas.classList.add('camera-shake');
            setTimeout(() => canvas.classList.remove('camera-shake'), 400);
        }

        this.playWarpSound();

        setTimeout(() => {
            flash.remove();
        }, 600);
    }

    playWarpSound() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            const ctx = new AudioContext();

            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(60, ctx.currentTime);
            osc1.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
            osc1.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.4);

            gain1.gain.setValueAtTime(0, ctx.currentTime);
            gain1.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
            gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

            osc1.connect(gain1);
            gain1.connect(ctx.destination);

            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(2000, ctx.currentTime);
            osc2.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);

            gain2.gain.setValueAtTime(0, ctx.currentTime);
            gain2.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.08);
            gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

            osc2.connect(gain2);
            gain2.connect(ctx.destination);

            osc1.start();
            osc2.start();
            osc1.stop(ctx.currentTime + 0.5);
            osc2.stop(ctx.currentTime + 0.5);

        } catch (e) {
            console.warn('Web Audio API not supported:', e);
        }
    }
}

# AdinPlay Rewarded Video — POC Implementation Plan

> **Goal:** Integrate AdinPlay rewarded video ads into SpAIce as a minimal, working Proof of Concept.  
> **Scope:** Single trigger point (planet teleport), one ad unit (rewarded video), no backend, no consent banner yet.  
> **Reference:** [tasks/improvements.md](./improvements.md) — Task 4 (Ads), subtasks 4.1 – 4.6.

---

## Overview

The POC validates the full rewarded-ad loop end-to-end in the browser:

```
Player teleports (5th time) → AdOverlay prompt appears
  → Player clicks "Watch Ad"
    → AdinPlay rewarded video plays
      → onRewarded callback fires → teleport executes
```

Everything is gated behind `VITE_ADS_ENABLED=true` so it can be toggled off in any environment without touching code.

---

## Prerequisites

Before writing any code:

1. **Register on AdinPlay** at [adinplay.com/publishers](https://adinplay.com/publishers/).
2. Add your site/game (e.g. `localhost` for dev, `spaice.app` for production).
3. In the AdinPlay dashboard, create a **Rewarded Video** ad unit. Note down:
   - Your **Publisher / Site ID** (appears in the tag URL: `//api.adinplay.com/libs/aiptag/pub/<SITE_ID>/...`)
4. Set `VITE_AD_SITE_ID=<your-site-id>` in your local `.env` file.

> ⚠️ AdinPlay requires a live HTTPS domain for ad delivery. During development, ads may not fill — the SDK will call the error/no-fill callback, which the `AdService` handles gracefully.

---

## Files Changed / Created

| Status | File | Purpose |
|---|---|---|
| **MODIFY** | `index.html` | Add `aiptag` bootstrap script to `<head>` |
| **MODIFY** | `src/config/config.js` | Add ad config fields |
| **MODIFY** | `.env.example` | Document new env vars |
| **NEW** | `src/services/AdService.js` | AdinPlay wrapper, lifecycle management |
| **NEW** | `src/ui/AdOverlay.js` | "Watch ad?" modal UI |
| **MODIFY** | `src/utils/TeleportController.js` | Inject ad trigger on every 5th teleport |
| **MODIFY** | `main.js` | Wire `AdService` + `AdOverlay` into app startup |

---

## Step-by-Step Implementation

---

### Step 1 — Add env vars to `.env.example` and `config.js`

#### [MODIFY] `.env.example`

Add below the existing ElevenLabs block:

```env
# ── Ads (AdinPlay) ──────────────────────────────────────────
# Set to true to enable ads. Leave false for local dev unless you have a valid site ID.
VITE_ADS_ENABLED=false
# Your AdinPlay publisher site ID (from the adinplay.com dashboard)
VITE_AD_SITE_ID=
# How many teleports between rewarded-ad prompts (default: 5)
VITE_AD_REWARDED_AFTER_TELEPORTS=5
```

#### [MODIFY] `src/config/config.js`

Add an `ads` block inside `export const CONFIG = { ... }`:

```js
// Ads (AdinPlay)
ads: {
    enabled: getEnvVar('VITE_ADS_ENABLED') === 'true',
    siteId: getEnvVar('VITE_AD_SITE_ID') || '',
    rewardedAfterTeleports: Number(getEnvVar('VITE_AD_REWARDED_AFTER_TELEPORTS')) || 5,
},
```

---

### Step 2 — Add the `aiptag` bootstrap to `index.html`

AdinPlay's SDK must be loaded as early as possible. Insert the following **before the closing `</head>` tag** in `index.html`:

```html
<!-- AdinPlay SDK bootstrap (loaded only when ads are enabled, see AdService.js) -->
<script>
    var aiptag = aiptag || {};
    aiptag.cmd = aiptag.cmd || [];
    aiptag.cmd.display  = aiptag.cmd.display  || [];
    aiptag.cmd.player   = aiptag.cmd.player   || [];
</script>
```

> **Why here and not in `AdService.js`?** The `aiptag` command queue must exist before the async SDK script runs, otherwise early `aiptag.cmd.push()` calls are lost. The actual `<script src="...tag.min.js">` is injected **dynamically** by `AdService.init()` so it is only loaded when `CONFIG.ads.enabled` is `true`.

---

### Step 3 — Create `src/services/AdService.js`

Full file to create:

```js
/**
 * AdService — AdinPlay rewarded video wrapper
 * Handles SDK injection, ad loading, and reward callbacks.
 * All methods are no-ops when CONFIG.ads.enabled is false.
 */
import { CONFIG } from '../config/config.js';
import { logger } from '../utils/logger.js';

export class AdService {
    constructor() {
        this._ready = false;       // SDK fully loaded
        this._adReady = false;     // A rewarded ad is pre-loaded and ready to show
        this._pendingReward = null; // Callback to fire after user completes the ad
    }

    /**
     * Inject the AdinPlay <script> tag and wait for SDK to initialise.
     * Call once during app startup.
     */
    async init() {
        if (!CONFIG.ads.enabled || !CONFIG.ads.siteId) {
            logger.info('[AdService] Ads disabled or siteId missing — skipping init.');
            return;
        }

        return new Promise((resolve) => {
            const script = document.createElement('script');
            // Replace <SITE_ID> with your actual siteId at runtime
            script.src = `//api.adinplay.com/libs/aiptag/pub/${CONFIG.ads.siteId}/tag.min.js`;
            script.async = true;

            script.onload = () => {
                this._ready = true;
                logger.info('[AdService] AdinPlay SDK loaded.');
                this._preloadRewarded();
                resolve();
            };

            script.onerror = () => {
                logger.warn('[AdService] Failed to load AdinPlay SDK (network error or ad blocker).');
                resolve(); // Resolve anyway — game continues without ads
            };

            document.head.appendChild(script);
        });
    }

    /**
     * Pre-warm the rewarded ad unit so it is ready when the player triggers it.
     * AdinPlay fills the ad in the background; we just track readiness.
     */
    _preloadRewarded() {
        if (!this._ready || typeof aiptag === 'undefined') return;

        aiptag.cmd.player.push(() => {
            // Check if adplayer is available (it's created by the SDK after load)
            if (aiptag.adplayer) {
                this._adReady = true;
                logger.debug('[AdService] Rewarded ad pre-loaded and ready.');
            }
        });
    }

    /**
     * Whether a rewarded ad is ready to show right now.
     * Use this to conditionally show the "Watch Ad" button/prompt.
     */
    isAdReady() {
        if (!CONFIG.ads.enabled) return false;
        return this._ready && this._adReady &&
               typeof aiptag !== 'undefined' && !!aiptag.adplayer;
    }

    /**
     * Show the rewarded ad. Calls onRewarded() only if the user completes the ad.
     * @param {Function} onRewarded — called with no arguments on successful completion
     * @param {Function} [onSkipped] — called if user skips / no ad fills
     */
    showRewardedAd(onRewarded, onSkipped = () => {}) {
        if (!CONFIG.ads.enabled) {
            // Ads disabled — grant reward immediately (dev mode shortcut)
            logger.debug('[AdService] Ads disabled — granting reward directly.');
            onRewarded();
            return;
        }

        if (!this.isAdReady()) {
            logger.warn('[AdService] Rewarded ad not ready — skipping.');
            onSkipped();
            return;
        }

        logger.info('[AdService] Showing rewarded ad...');

        aiptag.adplayer.showReward(
            // Ad started callback
            () => { logger.debug('[AdService] Rewarded ad started.'); },

            // Completion callback: rewarded = true means user watched it fully
            (rewarded) => {
                if (rewarded) {
                    logger.info('[AdService] User completed rewarded ad — granting reward.');
                    onRewarded();
                } else {
                    logger.info('[AdService] User skipped rewarded ad.');
                    onSkipped();
                }
                // Pre-load the next ad
                this._adReady = false;
                this._preloadRewarded();
            },

            // Error / no-fill callback
            (error) => {
                logger.warn(`[AdService] Rewarded ad error: ${error}`);
                onSkipped();
                this._preloadRewarded();
            }
        );
    }
}

// Singleton instance — import { adService } from './AdService.js'
export const adService = new AdService();
```

---

### Step 4 — Create `src/ui/AdOverlay.js`

```js
/**
 * AdOverlay — "Watch a short ad?" prompt modal
 * Matches the existing dark-glass UI style from ui-style.css.
 */
import { adService } from '../services/AdService.js';
import { logger } from '../utils/logger.js';

export class AdOverlay {
    constructor() {
        this._el = null;
        this._build();
    }

    _build() {
        // Create overlay container
        this._el = document.createElement('div');
        this._el.id = 'ad-overlay';
        this._el.style.cssText = `
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 20, 0.85);
            backdrop-filter: blur(6px);
            z-index: 20000;
            align-items: center;
            justify-content: center;
        `;

        this._el.innerHTML = `
            <div id="ad-overlay-card" style="
                background: rgba(10, 10, 40, 0.95);
                border: 1px solid rgba(0, 212, 255, 0.3);
                border-radius: 16px;
                padding: 36px 40px;
                max-width: 400px;
                width: 90%;
                text-align: center;
                box-shadow: 0 0 40px rgba(0, 212, 255, 0.15);
                font-family: 'Courier New', monospace;
                color: #e0f0ff;
            ">
                <div style="font-size: 2.5rem; margin-bottom: 12px;">🎬</div>
                <h2 style="margin: 0 0 8px; font-size: 1.1rem; color: #00d4ff; letter-spacing: 2px; text-transform: uppercase;">
                    Support SpAIce
                </h2>
                <p style="margin: 0 0 28px; font-size: 0.85rem; color: #8ab0c8; line-height: 1.6;">
                    Watch a short ad to continue your cosmic journey.<br>
                    It keeps SpAIce free for everyone.
                </p>

                <div id="ad-status-msg" style="
                    font-size: 0.75rem; color: #00d4ff; margin-bottom: 16px;
                    min-height: 18px; letter-spacing: 1px;
                "></div>

                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="ad-watch-btn" style="
                        background: linear-gradient(135deg, #00d4ff, #0080ff);
                        border: none; border-radius: 8px;
                        padding: 12px 24px; cursor: pointer;
                        color: #fff; font-weight: bold;
                        font-size: 0.9rem; letter-spacing: 1px;
                        font-family: inherit;
                        transition: opacity 0.2s;
                    ">▶ Watch Ad</button>

                    <button id="ad-skip-btn" style="
                        background: transparent;
                        border: 1px solid rgba(0, 212, 255, 0.3);
                        border-radius: 8px; padding: 12px 24px;
                        cursor: pointer; color: #8ab0c8;
                        font-size: 0.85rem; font-family: inherit;
                        transition: opacity 0.2s;
                    ">No thanks</button>
                </div>
            </div>
        `;

        document.body.appendChild(this._el);
    }

    /**
     * Show the overlay. Calls onRewarded() if the user watches the full ad.
     * @param {Function} onRewarded
     * @param {Function} [onSkipped]
     */
    show(onRewarded, onSkipped = () => {}) {
        this._el.style.display = 'flex';
        const statusEl   = document.getElementById('ad-status-msg');
        const watchBtn   = document.getElementById('ad-watch-btn');
        const skipBtn    = document.getElementById('ad-skip-btn');

        const hide = () => { this._el.style.display = 'none'; };

        // Update status depending on readiness
        if (!adService.isAdReady()) {
            statusEl.textContent = 'Loading ad...';
            watchBtn.style.opacity = '0.5';
            watchBtn.disabled = true;
        } else {
            statusEl.textContent = '';
            watchBtn.style.opacity = '1';
            watchBtn.disabled = false;
        }

        // Clean up previous listeners
        const newWatch = watchBtn.cloneNode(true);
        const newSkip  = skipBtn.cloneNode(true);
        watchBtn.replaceWith(newWatch);
        skipBtn.replaceWith(newSkip);

        newWatch.addEventListener('click', () => {
            hide();
            adService.showRewardedAd(
                () => { logger.info('[AdOverlay] Reward granted.'); onRewarded(); },
                () => { logger.info('[AdOverlay] Ad skipped.');    onSkipped();  }
            );
        });

        newSkip.addEventListener('click', () => {
            hide();
            onSkipped();
        });
    }
}
```

---

### Step 5 — Add the teleport counter to `TeleportController.js`

#### [MODIFY] `src/utils/TeleportController.js`

**Constructor** — add counter and ad references:

```js
// Add to constructor parameters and body:
constructor(spacecraft, exoplanetField, adOverlay = null) {
    this.spacecraft     = spacecraft;
    this.exoplanetField = exoplanetField;
    this.adOverlay      = adOverlay;          // NEW
    this._teleportCount = 0;                  // NEW
}
```

**`teleportToPlanet()` method** — wrap the existing logic with the ad gate at the top:

```js
teleportToPlanet(planet) {
    if (!planet) return;

    this._teleportCount++;

    // Import CONFIG at the top of the file:
    // import { CONFIG } from '../config/config.js';
    const threshold = CONFIG.ads?.rewardedAfterTeleports ?? 5;

    if (
        CONFIG.ads?.enabled &&
        this.adOverlay &&
        this._teleportCount % threshold === 0
    ) {
        // Show ad prompt — teleport only after user watches (or skips) the ad
        this.adOverlay.show(
            () => this._doTeleport(planet),   // onRewarded: execute teleport
            () => this._doTeleport(planet)    // onSkipped: also allow teleport (POC: non-blocking)
        );
        return;
    }

    this._doTeleport(planet);
}
```

**Extract existing teleport body into `_doTeleport(planet)`** (rename the private body):

```js
_doTeleport(planet) {
    // ...existing teleportToPlanet() body (lines 10–62 in current file)...
}
```

---

### Step 6 — Wire everything in `main.js`

In the `App` class `init()` or equivalent startup sequence, add:

```js
// 1. Import at top
import { adService } from './src/services/AdService.js';
import { AdOverlay }  from './src/ui/AdOverlay.js';

// 2. In init() — before creating TeleportController
await adService.init();
const adOverlay = new AdOverlay();

// 3. Pass adOverlay to TeleportController
this.teleportController = new TeleportController(
    this.spacecraft,
    this.exoplanetField,
    adOverlay          // NEW third argument
);
```

---

## Testing the POC

### Manual test checklist

| Step | Expected result |
|---|---|
| Load app with `VITE_ADS_ENABLED=false` | No SDK network request, no ad prompt at any point |
| Load app with `VITE_ADS_ENABLED=true` and blank `VITE_AD_SITE_ID` | Warning logged, no script injected, teleport works normally |
| Load app with valid `VITE_AD_SITE_ID` | `aiptag` script loads, `[AdService] AdinPlay SDK loaded.` in console |
| Teleport 1–4 times | No ad prompt |
| Teleport 5th time | `AdOverlay` modal appears |
| Click "No thanks" | Modal closes, teleport happens normally |
| Click "▶ Watch Ad" (dev: no fill likely) | Ad error logged, `onSkipped` fires, teleport happens |
| Click "▶ Watch Ad" (prod with fill) | Rewarded video plays, teleport fires on completion |
| Teleport counter resets correctly | Ad prompt appears again on 10th, 15th, … teleport |

### Dev workaround — instant reward mode

When `VITE_ADS_ENABLED=false`, `AdService.showRewardedAd()` grants the reward immediately (see Step 3 implementation). This lets you test the full overlay → reward → teleport flow without a live ad network:

```env
# .env (local dev)
VITE_ADS_ENABLED=false   # mock mode: overlay shows, reward fires instantly
```

---

## Scope Explicitly **Excluded** from this POC

The following items from `improvements.md` Task 4 are **out of scope** for the POC and will be addressed in follow-up iterations:

| Excluded item | Task ref |
|---|---|
| GDPR / CCPA consent banner (`ConsentBanner.js`) | 4.10 |
| "Watch Ad" HUD button | 4.7 |
| Interstitial ad on loading screen | 4.8 |
| Ad-free premium mode (`VITE_AD_FREE_MODE`) | 4.9 |
| AI narration / science data unlock triggers | 4.6 |
| Unity Ads native wrapper (Capacitor) | 4.11 |

---

## File Summary

```
tasks/
└── adinplay-poc-implementation-plan.md   ← this file

Modified:
  index.html                              ← aiptag bootstrap block in <head>
  src/config/config.js                    ← CONFIG.ads block
  .env.example                            ← VITE_ADS_ENABLED, VITE_AD_SITE_ID, VITE_AD_REWARDED_AFTER_TELEPORTS
  src/utils/TeleportController.js         ← counter + adOverlay injection + _doTeleport()
  main.js                                 ← adService.init() + AdOverlay wiring

New:
  src/services/AdService.js               ← AdinPlay wrapper singleton
  src/ui/AdOverlay.js                     ← dark-glass "Watch ad?" modal
```

---

*Plan created: 2026-03-31*

# Task 4: Ads — Implementation Plan

> **Context:** Based on the analysis in `improvements.md` (section 4).
> Unity Ads has **no official web/browser SDK** — it is native-mobile only (iOS & Android).
> SpAIce is a browser-based Vite/Three.js app, so the strategy is:
> - **Web build** → use a web-compatible ad SDK (AdinPlay or AppLixir)
> - **Future native wrapper** (Capacitor/Cordova) → Unity Ads SDK for iOS/Android
> Both paths coexist, gated by feature flags in `src/config/config.js`.

---

## Relevant Files

| Type | File |
|---|---|
| Modify | `src/config/config.js` |
| Modify | `src/ui/HUDManager.js` |
| Modify | `src/ui/PlanetExplorationDialog.js` |
| Modify | `src/utils/TeleportController.js` |
| Modify | `src/utils/LoadingManager.js` |
| Modify | `main.js` |
| **New** | `src/services/AdService.js` |
| **New** | `src/ui/AdOverlay.js` |
| **New** | `src/ui/ConsentBanner.js` |

---

## Step 1 — Choose a Web Ad Provider (task 4.1)

> ⚠️ **This is the only step that requires a human decision before coding can begin.**

Unity Ads is **mobile-only** — it has no browser SDK and cannot be used directly in this Vite/Three.js app.

**Recommended choice: [AdinPlay](https://www.adinplay.com)**
- Specifically designed for browser games
- Supports both **rewarded video** (user-opt-in) and **display banners**
- Lightweight JS SDK via a `<script>` tag — no npm package needed
- Requires registering at `adinplay.com`, submitting the game URL, and getting a **Publisher ID + Game ID**

**Alternatives:**
- **AppLixir** — purpose-built for HTML5 rewarded video; easy drop-in script tag
- **Google AdSense for Games** — JS snippet, fewer rewarded-video options

> **Action needed:** Register at [adinplay.com](https://www.adinplay.com), submit the deployment URL, and obtain your `gameId` / publisher slug.
> Store the result as `VITE_AD_GAME_ID` in `.env`. A placeholder can be used for initial wiring.

---

## Step 2 — Extend `src/config/config.js` (task 4.2)

Add a new `ads` block, all driven by `VITE_*` env vars:

```js
// Ads Configuration
ads: {
    enabled: getEnvVar('VITE_ADS_ENABLED') === 'true',
    freeMode: getEnvVar('VITE_AD_FREE_MODE') === 'true',
    provider: getEnvVar('VITE_AD_PROVIDER') || 'adinplay', // 'adinplay' | 'applixir' | 'none'
    gameId: getEnvVar('VITE_AD_GAME_ID') || '',
    rewardedAfterTeleports: Number(getEnvVar('VITE_AD_REWARDED_AFTER_TELEPORTS')) || 5,
},
```

Add all keys to `.env.example` with comments:

```env
# Ads
VITE_ADS_ENABLED=false            # Set to true to enable ads
VITE_AD_FREE_MODE=false           # Set to true to suppress all ads (premium/self-hosted builds)
VITE_AD_PROVIDER=adinplay         # 'adinplay' | 'applixir' | 'none'
VITE_AD_GAME_ID=                  # Publisher/Game ID from your ad provider
VITE_AD_REWARDED_AFTER_TELEPORTS=5  # Show a rewarded ad every N teleports
```

---

## Step 3 — Create `src/services/AdService.js` (tasks 4.3 + 4.4)

**New file.** ES module class — singleton exported at the bottom.

```js
import { CONFIG } from '../config/config.js';
import { logger } from '../utils/logger.js';

export class AdService {
    constructor(config) {
        this.config = config.ads;
        this._adReady = false;
    }

    /** Dynamically injects provider SDK <script> into <head>. No-op if ads disabled. */
    async init() {
        if (!this.config.enabled || this.config.freeMode) {
            logger.info('[AdService] Ads disabled — SDK not loaded.');
            return;
        }
        switch (this.config.provider) {
            case 'adinplay': await this._initAdinPlay(); break;
            case 'applixir': await this._initAppLixir(); break;
            default: logger.warn(`[AdService] Unknown provider: ${this.config.provider}`);
        }
    }

    /** Preloads the next rewarded ad in the background. */
    async loadRewardedAd() { /* provider-specific preload call */ }

    /** Shows a rewarded ad; calls onRewarded() on completion. */
    async showRewardedAd(onRewarded) {
        if (!this.config.enabled || this.config.freeMode) { onRewarded?.(); return; }
        /* provider-specific show call */
    }

    /** Fire-and-forget interstitial (banner / mid-game break). */
    showInterstitial() {
        if (!this.config.enabled || this.config.freeMode) return;
        /* provider-specific interstitial call */
    }

    /** Returns true when a rewarded ad is buffered and ready to show. */
    isAdReady() { return this._adReady; }

    // --- Private provider initialisers ---

    _initAdinPlay() {
        return new Promise((resolve) => {
            window.adinplay_config = { gameId: this.config.gameId };
            const script = document.createElement('script');
            script.src = `https://api.adinplay.com/libs/aiptag/pub/<PUBLISHER_ID>/${window.location.hostname}/tag.min.js`;
            script.async = true;
            script.onload = () => { logger.info('[AdService] AdinPlay SDK loaded'); resolve(); };
            document.head.appendChild(script);
        });
    }

    _initAppLixir() {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.applixir.com/applixir.sdk3.0m.js';
            script.async = true;
            script.onload = () => { logger.info('[AdService] AppLixir SDK loaded'); resolve(); };
            document.head.appendChild(script);
        });
    }
}

export const adService = new AdService(CONFIG);
```

**Rules:**
- All methods are **no-ops** when `enabled = false` or `freeMode = true` (no SDK injected, no network calls)
- Use `logger.js` — never raw `console.log`
- Provider is swapped by changing `VITE_AD_PROVIDER` — zero code changes required

---

## Step 4 — Create `src/ui/ConsentBanner.js` (task 4.10)

**Must run before `AdService.init()`** — required for GDPR (EU) and CCPA (California) compliance.

```js
export class ConsentBanner {
    constructor(adService) {
        this.adService = adService;
        this.STORAGE_KEY = 'spaice_ad_consent';
    }

    /** Checks stored consent; if absent, shows the banner. Returns a Promise that resolves when decided. */
    async requestConsent() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored === 'granted') { await this.adService.init(); return; }
        if (stored === 'denied')  { return; }
        return this._showBanner();
    }

    _showBanner() {
        return new Promise((resolve) => {
            const banner = document.createElement('div');
            banner.id = 'consent-banner';
            banner.innerHTML = `
                <p>SpAIce uses ads to stay free.</p>
                <button id="consent-accept">Accept</button>
                <button id="consent-decline">Decline</button>
            `;
            // Style with existing dark-glass CSS tokens
            document.body.appendChild(banner);

            document.getElementById('consent-accept').onclick = async () => {
                localStorage.setItem(this.STORAGE_KEY, 'granted');
                banner.remove();
                await this.adService.init();
                resolve();
            };
            document.getElementById('consent-decline').onclick = () => {
                localStorage.setItem(this.STORAGE_KEY, 'denied');
                banner.remove();
                resolve();
            };
        });
    }
}
```

Style the banner in `ui-style.css` using the existing dark-glass design system — **no new CSS framework**.

---

## Step 5 — Create `src/ui/AdOverlay.js` (task 4.5)

**New file.** Minimal modal overlay for rewarded ad gates.

```js
import { adService } from '../services/AdService.js';

export class AdOverlay {
    constructor() {
        this._el = null;
        this._build();
    }

    _build() {
        this._el = document.createElement('div');
        this._el.id = 'ad-overlay';
        this._el.innerHTML = `
            <div id="ad-overlay-card">
                <h2>🚀 Unlock this feature</h2>
                <p>Watch a short ad to continue exploring SpAIce for free.</p>
                <div id="ad-spinner" hidden></div>
                <button id="ad-watch-btn">🎬 Watch Ad</button>
                <button id="ad-decline-btn">No thanks</button>
            </div>
        `;
        this._el.style.display = 'none';
        document.body.appendChild(this._el);

        document.getElementById('ad-decline-btn').onclick = () => this.hide();
        document.getElementById('ad-watch-btn').onclick = async () => {
            document.getElementById('ad-spinner').hidden = false;
            document.getElementById('ad-watch-btn').disabled = true;
            await adService.showRewardedAd(() => {
                this.hide();
                this._onRewarded?.();
            });
        };
    }

    /** Shows the overlay. onRewarded is called if the user completes the ad. */
    show(onRewarded) {
        this._onRewarded = onRewarded;
        this._el.style.display = 'flex';
    }

    hide() {
        this._el.style.display = 'none';
        document.getElementById('ad-spinner').hidden = true;
        document.getElementById('ad-watch-btn').disabled = false;
    }
}
```

Style in `ui-style.css` — dark glass card, centered, backdrop blur — consistent with existing UI.

---

## Step 6 — Wire Up Trigger Points (task 4.6)

### 6a. Every N teleports → `src/utils/TeleportController.js`

Add a `teleportCount` counter and check it after each teleport:

```js
constructor(spacecraft, exoplanetField, adOverlay) {
    // ...existing...
    this.adOverlay = adOverlay;
    this.teleportCount = 0;
}

teleportToPlanet(planet) {
    // ...existing logic...
    this.teleportCount++;
    const interval = CONFIG.ads.rewardedAfterTeleports;
    if (CONFIG.ads.enabled && this.teleportCount % interval === 0) {
        this.adOverlay.show(() => { /* no mechanical reward — UX gate only */ });
    }
}
```

### 6b. AI narration unlock → `src/ui/PlanetExplorationDialog.js`

Gate the narration play button:

```js
narrateBtn.onclick = () => {
    if (CONFIG.ads.enabled && !this._narrationUnlocked) {
        adOverlay.show(() => { this._narrationUnlocked = true; this._playNarration(); });
    } else {
        this._playNarration();
    }
};
```

### 6c. Detailed science data → `src/ui/PlanetExplorationDialog.js`

Gate the expanded data tab:

```js
detailTabBtn.onclick = () => {
    if (CONFIG.ads.enabled && !this._detailUnlocked) {
        adOverlay.show(() => { this._detailUnlocked = true; this._showDetailTab(); });
    } else {
        this._showDetailTab();
    }
};
```

### 6d. Long idle / tab return → `main.js`

```js
let lastActiveTime = Date.now();
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        const idleMs = Date.now() - lastActiveTime;
        if (CONFIG.ads.enabled && idleMs > 5 * 60 * 1000) { // 5 min idle
            adService.showInterstitial();
        }
    } else {
        lastActiveTime = Date.now();
    }
});
```

---

## Step 7 — Add "Watch Ad" Button to HUD (task 4.7)

In `src/ui/HUDManager.js`, add a pill-shaped button to the bottom bar:

```js
// In updateHUD() or init():
if (CONFIG.ads.enabled) {
    const btn = document.createElement('button');
    btn.id = 'hud-watch-ad-btn';
    btn.textContent = '🎬 Watch Ad';
    btn.style.display = 'none'; // hidden until ad is ready
    btn.onclick = () => adOverlay.show(() => { /* generic reward e.g. speed boost */ });
    document.getElementById('hud-bottom-bar').appendChild(btn);

    // Poll ad readiness
    setInterval(() => {
        btn.style.display = adService.isAdReady() ? 'inline-block' : 'none';
    }, 2000);
}
```

Add CSS animation to `ui-style.css`:

```css
@keyframes adPulse {
    0%, 100% { box-shadow: 0 0 6px rgba(0, 212, 255, 0.4); }
    50%       { box-shadow: 0 0 14px rgba(0, 212, 255, 0.9); }
}
#hud-watch-ad-btn {
    animation: adPulse 2.5s ease-in-out infinite;
}
```

---

## Step 8 — Interstitial Between Scene Loads (task 4.8)

In `src/utils/LoadingManager.js` (or `main.js`), after loading completes:

```js
async onLoadComplete() {
    if (CONFIG.ads.enabled && !sessionStorage.getItem('spaice_interstitial_shown')) {
        sessionStorage.setItem('spaice_interstitial_shown', 'true');
        adService.showInterstitial();
        await new Promise(r => setTimeout(r, 3000)); // brief pause before scene becomes interactive
    }
    this._makeSceneInteractive();
}
```

---

## Step 9 — Bootstrap Order in `main.js` (task integration)

```js
import { adService } from './src/services/AdService.js';
import { ConsentBanner } from './src/ui/ConsentBanner.js';
import { AdOverlay } from './src/ui/AdOverlay.js';

class App {
    async init() {
        // 1. Consent must come first — no SDK loaded without it
        const consentBanner = new ConsentBanner(adService);
        await consentBanner.requestConsent();

        // 2. Ad overlay — shared instance passed to all trigger points
        const adOverlay = new AdOverlay();

        // 3. Pass adOverlay to subsystems
        this.teleportController = new TeleportController(spacecraft, exoplanetField, adOverlay);
        this.hudManager = new HUDManager(/* ... */, adOverlay, adService);
        this.planetDialog = new PlanetExplorationDialog(/* ... */, adOverlay);

        // 4. Idle interstitial listener
        this._setupIdleAdListener();

        // ... rest of init
    }
}
```

---

## Dependency Order

```
config.js (ads block)
    └─> AdService.js
    └─> ConsentBanner.js ──> AdService.init()
            └─> AdOverlay.js
                    ├─> TeleportController.js  (teleport trigger)
                    ├─> PlanetExplorationDialog.js  (narration + data triggers)
                    └─> HUDManager.js  (Watch Ad button)
    └─> LoadingManager.js  (interstitial on load complete)
    └─> main.js  (idle interstitial + bootstrap order)
```

---

## Future: Unity Ads Native Wrapper (task 4.11)

> **Advisory only — no code in the web build.**

If SpAIce is later wrapped with **Capacitor** or **Cordova** for iOS/Android:
- Integrate the **Unity Ads SDK** via the Capacitor plugin for iOS/Android
- Extend `AdService.js` with a **native bridge adapter** so the interface (`.showRewardedAd()`, `.isAdReady()`) stays identical
- The trigger logic in `TeleportController`, `PlanetExplorationDialog`, etc. remains **unchanged**
- Add env vars: `VITE_AD_UNITY_GAME_ID` and separate placement IDs (rewarded / interstitial)

---

## Open Questions Before Coding

| # | Question | Impact |
|---|---|---|
| 1 | Which ad provider: **AdinPlay**, AppLixir, or Google AdSense for Games? | Determines SDK snippet in `AdService._init*()` |
| 2 | Full implementation all at once, or **foundation first** (Steps 2–5) then triggers? | Scopes the first PR |
| 3 | Is there an existing deployment URL to submit to the ad network? | Required for provider registration |

---

*Last updated: 2026-03-31*

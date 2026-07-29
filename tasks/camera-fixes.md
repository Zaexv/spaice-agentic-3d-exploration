# Task 1: Camera & Flight Controls — Fix & Improve

> **Source:** `tasks/improvements.md` — Section 1 (Camera Improvements)
> **Goal:** Fix existing bugs in flight controls and camera, then add missing camera modes and configurable options.
> **Priority:** High — these are user-facing bugs and blocked UX features.

---

## Relevant Files

| Status | File | Purpose |
|---|---|---|
| **MODIFY** | `src/controls/FlightControls.js` | Fix bugs (1A, 1B), add keyboard pitch (1F), make sensitivity configurable (1E) |
| **MODIFY** | `src/controls/CameraController.js` | Fix animation guard (1D), improve planet offset (1C), add camera modes (1G) |
| **MODIFY** | `src/config/config.js` | Add `controls` config block for mouse sensitivity + keyboard bindings |
| **MODIFY** | `.env.example` | Document new `VITE_MOUSE_SENSITIVITY` env var |

---

## Sub-tasks

Each sub-task below is **independent** and can be assigned to a separate agent. They are ordered by priority (critical bugs first, then features).

---

### 1A — Fix `slowMode` key-up event (BUG — Critical)

**File:** `src/controls/FlightControls.js`
**Lines:** 151–155

**Problem:** In the `onKeyUp()` switch statement, the `ShiftLeft` / `ShiftRight` case is missing entirely. The `this.keys.slowMode = false` line (line 154) is **unreachable** — it sits after the `break` of the `Space` case:

```js
// CURRENT (broken)
case 'Space':
    this.keys.boost = false;
    break;
    this.keys.slowMode = false;  // ← UNREACHABLE
    break;
```

**Fix:** Add explicit Shift cases:

```js
case 'Space':
    this.keys.boost = false;
    break;
case 'ShiftLeft':
case 'ShiftRight':
    this.keys.slowMode = false;
    break;
```

**Test:** Press Shift to enter slow mode, release Shift — verify `getControlInputs().slowMode` returns `false` after release. Without the fix, `slowMode` stays `true` forever once activated.

---

### 1B — Remove duplicate `boost` property in `getControlInputs()` (BUG)

**File:** `src/controls/FlightControls.js`
**Lines:** 255–265

**Problem:** The return object in `getControlInputs()` contains `boost` twice (lines 260–261):

```js
return {
    thrust,
    pitch,
    yaw,
    roll,
    boost,
    boost,        // ← DUPLICATE — silently overrides first
    slowMode,
    speedUp: this.keys.speedUp,
    speedDown: this.keys.speedDown
};
```

**Fix:** Remove the duplicate line:

```js
return {
    thrust,
    pitch,
    yaw,
    roll,
    boost,
    slowMode,
    speedUp: this.keys.speedUp,
    speedDown: this.keys.speedDown
};
```

**Test:** No runtime behaviour change, but this prevents future confusion and potential linting errors.

---

### 1C — Replace `console.log` calls with `logger` (Cleanup)

**File:** `src/controls/FlightControls.js`
**Lines:** 56, 75, 205, 207

**Changes:**
1. Add `import { logger } from '../utils/logger.js';` at top of file
2. Replace:
   - Line 56: `console.log('Flight controls enabled')` → `logger.info('Flight controls enabled')`
   - Line 75: `console.log('Flight controls disabled')` → `logger.info('Flight controls disabled')`
   - Line 205: `console.log('Mouse locked...')` → `logger.debug('Mouse locked — immersive flight mode')`
   - Line 207: `console.log('Mouse unlocked...')` → `logger.debug('Mouse unlocked — click canvas to re-lock')`

**Convention:** See `Agents.md` — all new code must use `src/utils/logger.js`, never raw `console.log`.

---

### 1D — Fix `isAnimating` guard in `returnToOverview()` (BUG)

**File:** `src/controls/CameraController.js`
**Lines:** 77–108

**Problem:** `returnToOverview()` creates **two** GSAP tweens (position + target), but only the position tween's `onComplete` resets `isAnimating`. If the `controls.target` tween finishes later (or if the position tween is interrupted), `isAnimating` can get stuck as `true`, permanently locking the camera.

**Fix:** Use a single completion guard that fires after **both** tweens finish:

```js
returnToOverview(duration = 2.0) {
    if (this.isAnimating) return;
    this.isAnimating = true;

    const overviewPosition = { x: 0, y: 50, z: 150 };
    const overviewTarget = { x: 0, y: 0, z: 0 };

    if (this.spacecraft) {
        this.spacecraft.clearNavigationTarget();
    }

    let completedCount = 0;
    const onTweenComplete = () => {
        completedCount++;
        if (completedCount >= 2) {
            this.isAnimating = false;
        }
    };

    gsap.to(this.camera.position, {
        ...overviewPosition,
        duration,
        ease: 'power2.inOut',
        onComplete: onTweenComplete
    });

    gsap.to(this.controls.target, {
        ...overviewTarget,
        duration,
        ease: 'power2.inOut',
        onComplete: onTweenComplete
    });
}
```

Also apply the same pattern to `travelToPlanet()` (lines 22–72) — its `controls.target` tween also lacks `onComplete`.

**Test:** Rapidly trigger `travelToPlanet()` → `returnToOverview()` → `travelToPlanet()`. Verify the camera never gets stuck.

---

### 1E — Make mouse sensitivity configurable via CONFIG

**Files:** `src/controls/FlightControls.js`, `src/config/config.js`, `.env.example`

**Problem:** `mouseSensitivity = 0.002` is hardcoded (line 26). Users with different mice / trackpads have no way to adjust it.

**Changes:**

1. **`src/config/config.js`** — Add a `controls` block:
   ```js
   controls: {
       mouseSensitivity: Number(getEnvVar('VITE_MOUSE_SENSITIVITY')) || 0.002,
   },
   ```

2. **`.env.example`** — Add:
   ```env
   # Controls
   VITE_MOUSE_SENSITIVITY=0.002    # Mouse sensitivity for flight mode (default: 0.002)
   ```

3. **`src/controls/FlightControls.js`** — Import CONFIG and use it:
   ```js
   import { CONFIG } from '../config/config.js';
   // ...
   this.mouseSensitivity = CONFIG.controls?.mouseSensitivity ?? 0.002;
   ```

**Test:** Set `VITE_MOUSE_SENSITIVITY=0.01` in `.env`, reload — mouse should be 5× more responsive in flight mode.

---

### 1F — Add keyboard pitch (I/K keys)

**File:** `src/controls/FlightControls.js`

**Problem:** Pitch is mouse-only. Keyboard users and accessibility users have no way to pitch the spacecraft up/down.

**Changes:**

1. Add `pitchUp` and `pitchDown` to the `keys` object:
   ```js
   pitchUp: false,    // I
   pitchDown: false,  // K
   ```

2. Add cases to `onKeyDown()`:
   ```js
   case 'KeyI':
       this.keys.pitchUp = true;
       break;
   case 'KeyK':
       this.keys.pitchDown = true;
       break;
   ```

3. Add cases to `onKeyUp()`:
   ```js
   case 'KeyI':
       this.keys.pitchUp = false;
       break;
   case 'KeyK':
       this.keys.pitchDown = false;
       break;
   ```

4. In `getControlInputs()`, combine keyboard pitch with mouse pitch:
   ```js
   let pitchKeys = 0;
   if (this.keys.pitchUp) pitchKeys -= 1;
   if (this.keys.pitchDown) pitchKeys += 1;
   const pitch = pitchKeys + this.mouseMovement.y;
   ```

**Test:** Press `I` to pitch up, `K` to pitch down. Combining with mouse movement should work additively.

---

### 1G — Improve `travelToPlanet()` camera offset logic

**File:** `src/controls/CameraController.js`
**Lines:** 34–39

**Problem:** The camera offset is a fixed `(0.8, 0.4, 0.8)` multiplier. This causes:
- Clipping into large planets (gas giants)
- Camera too far from tiny planets (small rocky exoplanets)
- Same viewing angle regardless of approach direction

**Fix:** Compute a smarter offset:

```js
travelToPlanet(planet, duration = 2.5) {
    if (this.isAnimating) return;
    this.isAnimating = true;

    const planetPosition = new THREE.Vector3();
    planet.mesh.getWorldPosition(planetPosition);

    const distance = planet.config.radius * 3.5;

    // Preserve current camera bearing relative to the planet
    const currentDir = new THREE.Vector3()
        .subVectors(this.camera.position, planetPosition)
        .normalize();

    // If the camera is already roughly pointing at the planet,
    // approach from a similar direction. Otherwise use default.
    const hasValidDir = currentDir.lengthSq() > 0.01;
    const approachDir = hasValidDir ? currentDir : new THREE.Vector3(0.8, 0.4, 0.8).normalize();

    // Scale distance inversely with planet radius to avoid clipping
    const safeDist = Math.max(distance, planet.config.radius * 2.5);
    const targetCameraPosition = planetPosition.clone().add(approachDir.multiplyScalar(safeDist));

    // ... rest of animation unchanged
}
```

**Test:** Travel to Jupiter (large), then to a small exoplanet. Camera should frame both well without clipping.

---

### 1H — Add chase / follow / cockpit camera modes (Feature — Future)

**File:** `src/controls/CameraController.js`

> ⚠️ **This is a larger feature.** Implement only after 1A–1G are merged.

Currently only `travelToPlanet()` and `returnToOverview()` exist. Add:

1. **Chase mode** — Camera trails behind the spacecraft at a configurable offset with smooth damping (`THREE.Vector3.lerp`).
2. **Orbit mode** — Camera orbits a selected planet at a fixed distance (separate from OrbitControls).
3. **Cockpit / first-person mode** — Camera is parented to the spacecraft mesh with zero offset.

Each mode should be activated via a method (`setCameraMode('chase' | 'orbit' | 'cockpit' | 'free')`) and driven from the `update()` loop.

**Dependencies:** Requires the `Spacecraft.js` instance to be passed to `CameraController` (already partially wired via constructor's `spacecraft` param).

---

## Dependency Order

```
1A (slowMode bug)      ──┐
1B (duplicate boost)   ──┤  Independent — can run in parallel
1C (logger migration)  ──┤
1D (isAnimating guard) ──┤
1E (mouse sensitivity) ──┤
1F (keyboard pitch)    ──┘
                          │
                          ▼
              1G (camera offset) ─── depends on 1D being merged
                          │
                          ▼
              1H (camera modes) ─── depends on 1D + 1G
```

Tasks **1A through 1F** are fully independent and can be done by 6 agents in parallel.
Task **1G** should wait for **1D** (both touch `CameraController.js`).
Task **1H** is a follow-up feature after all bug fixes are done.

---

## Verification Plan

### Automated
```bash
npm run build   # Ensure no import/syntax errors after changes
```

### Manual (Browser)
1. Load the app with `npm run dev`
2. Enter flight mode
3. Test Shift key → slow mode on/off (1A)
4. Check console for `logger.info` instead of `console.log` (1C)
5. Rapidly travel to a planet → return to overview → travel again (1D)
6. Fly near a large planet → camera doesn't clip (1G)
7. Press I/K for keyboard pitch control (1F)
8. Set `VITE_MOUSE_SENSITIVITY=0.01` → verify sensitivity changes (1E)

---

*Created: 2026-03-31*

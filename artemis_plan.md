# Artemis Mission Integration Plan

## Goal
Add NASA's Artemis program (I, II, III) as a visualized, flyable mission inside the existing 3D space explorer — including trajectory curves, mission phases, animated Orion/HLS spacecraft, and the NRHO orbit around the Moon.

---

## Step 0: Understand What Already Exists

| Capability | Status | Where |
|-----------|--------|-------|
| Earth & Moon positions (live ephemeris) | **Done** | `SolarSystemField.js` via `astronomy-engine` |
| AU → scene units scaling | **Done** | `SceneConstants.js` (`AU_TO_SCENE = 5000`) |
| Per-frame animation loop with deltaTime | **Done** | `main.js` |
| Line rendering (BufferGeometry + LineSegments) | **Done** | `PlanetTargetingSquare.js` |
| Custom shader materials | **Done** | `WarpTunnel.js` |
| Spacecraft autopilot toward a target point | **Done** | `Spacecraft.js` → `engageAutopilot()` |
| Simulation time with controllable speed | **Done** | `SimulationClock.js` |
| HUD overlay for real-time info | **Done** | `HUDManager.js` |
| Multiple spacecraft / NPC craft | **Not done** | — |
| Trajectory curve rendering | **Not done** | — |
| Mission phase state machine | **Not done** | — |
| NRHO orbit math | **Not done** | — |

**Conclusion:** The rendering and positioning infrastructure is solid. What's missing is structural — a mission system, trajectory curves, and NPC spacecraft.

---

## Step 1: Gather Trajectory Data

### 1a. Artemis I — Real Data (Completed Mission)

**Source:** NASA Horizons (`ssd.jpl.nasa.gov`)
- SPK ID: `-23` (ORION MPCV)
- Date range: `2022-11-16` to `2022-12-11`
- Query: Cartesian vectors, heliocentric or geocentric, J2000

**Action:** Write a Python script (`scripts/fetch_artemis_data.py`) that:
```python
from astroquery.jplhorizons import Horizons

obj = Horizons(id='-23', location='@399', epochs={'start':'2022-11-16', 'stop':'2022-12-11', 'step':'1h'})
vectors = obj.vectors()
# Export: time, x, y, z (km, geocentric) → convert to AU → save as JSON
```

**Output:** `nasa_data/missions/artemis_i_trajectory.json`

```json
{
  "mission": "Artemis I",
  "reference_frame": "geocentric_j2000",
  "units": "AU",
  "waypoints": [
    { "t": 0, "x": 0.0, "y": 0.0, "z": 0.0, "phase": "launch", "label": "KSC Launch" },
    { "t": 3600, "x": 0.00012, "y": 0.00008, "z": 0.00003, "phase": "parking_orbit" },
    ...
  ]
}
```

### 1b. Artemis II & III — Approximated Data

These missions haven't flown yet, so no Horizons data exists. Use NASA fact sheets + patched-conic approximation.

**Key waypoints to define manually (geocentric, AU):**

#### Artemis II (Free-Return Flyby, ~10 days)
| Phase | Time (hours) | Description |
|-------|-------------|-------------|
| Launch | T+0 | LEO parking orbit (185 km) |
| TLI | T+2 | Trans-Lunar Injection burn |
| Midcourse | T+36 | Coast, halfway to Moon |
| Lunar Flyby | T+72 | Closest approach ~8,900 km above surface |
| Free Return | T+73 | Gravity assist, heading home |
| Midcourse 2 | T+144 | Coast back to Earth |
| Reentry | T+240 | Earth atmosphere entry |

#### Artemis III (NRHO + Landing, ~30 days)
| Phase | Time (hours) | Description |
|-------|-------------|-------------|
| Launch | T+0 | LEO parking orbit |
| TLI | T+2 | Trans-Lunar Injection |
| Coast | T+36 | Midpoint Earth-Moon |
| LOI | T+72 | Lunar Orbit Insertion → NRHO |
| NRHO Ops | T+72–168 | Orbit stabilization, rendezvous with HLS |
| HLS Undock | T+168 | Starship HLS descends to surface |
| Landing | T+180 | South Pole landing |
| Surface Ops | T+180–240 | EVAs on lunar surface |
| Ascent | T+240 | HLS ascends back to NRHO |
| Orion Depart | T+312 | TEI burn, leave NRHO |
| Coast Home | T+312–540 | Return trajectory |
| Reentry | T+600 | Earth atmosphere entry |

**Action:** Create `nasa_data/missions/artemis_ii_waypoints.json` and `artemis_iii_waypoints.json` with ~20-30 waypoints each, positioned relative to Earth (geocentric AU). Use `astronomy-engine` to get Moon position at each timestamp, then place waypoints relative to Moon for lunar-vicinity phases.

---

## Step 2: Create the Mission Data Schema

### File: `nasa_data/missions/mission_schema.json`

```typescript
interface ArtemisMission {
  id: string;                    // "artemis_i" | "artemis_ii" | "artemis_iii"
  name: string;                  // "Artemis I"
  description: string;           // Brief mission summary
  startDate: string;             // ISO 8601 date
  durationDays: number;
  spacecraft: SpacecraftConfig[];
  phases: MissionPhase[];
  trajectory: TrajectoryPoint[];
}

interface SpacecraftConfig {
  id: string;                    // "orion" | "hls_starship" | "sls"
  name: string;                  // "Orion MPCV"
  activePhases: string[];        // Phase IDs where this craft is visible
  model: "capsule" | "lander" | "rocket";  // Determines 3D geometry
  scale: number;                 // Relative size
  color: string;                 // Hex color for the mesh
}

interface MissionPhase {
  id: string;                    // "launch" | "tli" | "coast" | "nrho" | "landing" ...
  name: string;                  // "Trans-Lunar Injection"
  startTime: number;             // Hours from mission start
  endTime: number;               // Hours from mission start
  description: string;
  trajectoryColor: string;       // Hex color for this segment of the curve
  referenceBody: "earth" | "moon";  // Which body the waypoints are relative to
}

interface TrajectoryPoint {
  t: number;                     // Hours from mission start
  x: number;                     // AU (geocentric or selenocentric per phase)
  y: number;                     // AU
  z: number;                     // AU
  phase: string;                 // Phase ID
  label?: string;                // Optional label ("TLI Burn", "Lunar Flyby")
  event?: string;                // Optional event trigger ("camera_shake", "show_dialog")
}
```

---

## Step 3: Build the Trajectory Renderer

### New file: `src/objects/MissionTrajectory.js`

**What it does:** Renders the full mission path as a colored 3D curve in the scene, with phase-colored segments and animated progress marker.

**Implementation approach:**

```
1. Load mission JSON
2. For each phase:
   a. Collect waypoints belonging to that phase
   b. Convert from geocentric AU to scene units:
      - Get Earth position from astronomy-engine at mission startDate
      - scenePos = (earthPos + waypointAU) × AU_TO_SCENE
   c. Create THREE.CatmullRomCurve3 through the waypoints
   d. Sample curve at 200+ points for smooth rendering
   e. Create THREE.BufferGeometry + THREE.LineBasicMaterial
      with phase color and transparency
   f. Add to a THREE.Group
3. Add a glowing sphere ("progress marker") that moves along the curve
   based on simulation time
```

**Key Three.js classes to use:**
- `THREE.CatmullRomCurve3` — smooth interpolation through waypoints
- `THREE.BufferGeometry` + `THREE.Line` — curve rendering
- `THREE.TubeGeometry` — optional: thicker tube for the trajectory
- `THREE.ShaderMaterial` — animated dashed line or glow effect

**Scale consideration:**
Earth-Moon distance = 384,400 km = 0.00257 AU.
At `AU_TO_SCENE = 5000`: Earth-Moon = **12.85 scene units**.
This is very small compared to interstellar distances but perfectly visible when zoomed into the solar system. The trajectory will be a tiny thread near Earth — which is accurate.

### Phase Color Scheme

| Phase | Color | Hex |
|-------|-------|-----|
| Launch / LEO | White | `#ffffff` |
| TLI Burn | Cyan | `#00ffff` |
| Coast to Moon | Blue | `#4488ff` |
| NRHO Orbit | Gold | `#ffaa00` |
| HLS Descent/Ascent | Green | `#00ff88` |
| Surface Ops | Red | `#ff4444` |
| Return Coast | Blue | `#4488ff` |
| Reentry | Orange | `#ff6600` |

---

## Step 4: Model the NRHO Orbit

The Near-Rectilinear Halo Orbit is the most visually striking element. It's a tall, thin loop around the Moon.

### Parameters
| Property | Value |
|----------|-------|
| Periapsis | ~1,600 km above lunar south pole |
| Apoapsis | ~70,000 km above lunar north pole |
| Period | ~6.5 days |
| Orientation | Nearly polar, tilted ~90° to Moon's equator |

### In AU
- Periapsis: 1,600 km = **1.07e-5 AU**
- Apoapsis: 70,000 km = **4.68e-4 AU**
- Moon radius: 1,737 km = **1.16e-5 AU**

### In Scene Units (× AU_TO_SCENE = 5000)
- Periapsis: **0.053 units** from Moon surface
- Apoapsis: **2.34 units** from Moon center
- Moon radius: **0.058 units**

### Parametric Approximation

The NRHO can be approximated as a tilted, eccentric ellipse in the Moon's frame:

```javascript
function getNRHOPoint(t, moonPos) {
  // t in [0, 1] = one full orbit
  const angle = t * Math.PI * 2;
  
  // Semi-axes in AU
  const a = 4.68e-4;  // semi-major (apoapsis distance)  
  const b = 3.0e-5;   // semi-minor (lateral extent)
  
  // Parametric ellipse, nearly polar orientation
  const x = b * Math.cos(angle);                    // lateral
  const y = a * Math.sin(angle) * 0.5 + a * 0.5;   // "vertical" (south pole to north pole)
  const z = b * Math.sin(angle) * 0.3;              // depth
  
  // Rotate to align with Moon's pole, then translate to Moon position
  return new THREE.Vector3(
    moonPos.x + x * AU_TO_SCENE,
    moonPos.y + y * AU_TO_SCENE,
    moonPos.z + z * AU_TO_SCENE
  );
}
```

> For higher fidelity: precompute NRHO points using GMAT (open-source NASA tool) and store as JSON waypoints.

---

## Step 5: Create NPC Spacecraft Objects

### New file: `src/objects/MissionSpacecraft.js`

**What it does:** Renders the Orion capsule, HLS Starship, and SLS as simple 3D meshes that follow the trajectory curve over time.

**Geometry approach (simple, no GLTF models needed):**

```javascript
// Orion Capsule — cone + cylinder
function createOrionMesh() {
  const group = new THREE.Group();
  
  // Capsule body (cone)
  const capsule = new THREE.Mesh(
    new THREE.ConeGeometry(0.02, 0.04, 8),
    new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 })
  );
  
  // Service module (cylinder)
  const service = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6 })
  );
  service.position.y = -0.045;
  
  // Solar panels (thin boxes)
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.001, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x1144aa })
  );
  panel.position.y = -0.03;
  
  group.add(capsule, service, panel);
  return group;
}

// HLS Starship — tall cylinder + nose cone
function createHLSMesh() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.15, 8),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.7 })
  );
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.015, 0.03, 8),
    new THREE.MeshStandardMaterial({ color: 0xdddddd })
  );
  nose.position.y = 0.09;
  group.add(body, nose);
  return group;
}
```

**Per-frame update logic:**
```javascript
update(simulationTime) {
  const missionElapsed = simulationTime - this.mission.startDate;
  const t = missionElapsed / this.mission.totalDuration;  // 0..1
  
  // Get position along trajectory curve
  const pos = this.trajectoryCurve.getPointAt(clamp(t, 0, 1));
  this.mesh.position.copy(pos);
  
  // Orient spacecraft along trajectory tangent
  const tangent = this.trajectoryCurve.getTangentAt(clamp(t, 0, 1));
  this.mesh.lookAt(pos.clone().add(tangent));
}
```

---

## Step 6: Build the Mission Controller (State Machine)

### New file: `src/services/MissionController.js`

This orchestrates the entire mission visualization.

```
States:
  IDLE → no mission active, normal exploration
  LOADING → loading mission JSON data
  PREVIEW → trajectory visible, user hasn't started playback
  PLAYING → simulation advancing, spacecraft moving along path
  PAUSED → simulation frozen, user can look around
  PHASE_TRANSITION → brief pause + UI event between phases
  COMPLETE → mission finished, trajectory remains visible
```

**Responsibilities:**
1. Load mission data from JSON
2. Instantiate `MissionTrajectory` (curve) and `MissionSpacecraft` (mesh)
3. Track current phase based on simulation time
4. Fire events on phase transitions (UI dialogs, camera movements)
5. Provide time controls (play, pause, speed up, rewind)
6. Coordinate with `SimulationClock.js` for time advancement

**State transitions:**
```
User clicks "Launch Artemis III" in UI
  → LOADING: fetch JSON
  → PREVIEW: render trajectory curve, position spacecraft at start
  → User presses Play
  → PLAYING: advance time, move spacecraft, update phase
     → On phase boundary → PHASE_TRANSITION: show info dialog
     → User presses Pause → PAUSED
     → Mission time reaches end → COMPLETE
```

---

## Step 7: Add Mission UI

### Modify: `src/ui/HUDManager.js`

Add a mission panel (bottom-left or top-right) showing:

```
┌─────────────────────────────────────────┐
│ 🚀 ARTEMIS III                         │
│ Phase: NRHO Orbit (Day 5/30)           │
│ ━━━━━━━━━━━━━━━━▪━━━━━━━━━  17%       │
│ Altitude: 42,300 km from Moon          │
│ Speed: 1.2 km/s                        │
│ ◀◀  ▶  ▶▶  1x  2x  10x  100x         │
└─────────────────────────────────────────┘
```

**Elements:**
- Mission name + current phase name
- Timeline progress bar (colored by phase)
- Distance to reference body (Earth or Moon)
- Speed readout
- Playback controls (play/pause/speed)

### New: Mission selector in `PlanetNavigator.js`

Add a "Missions" tab alongside the planet list:
```
[ Planets ] [ Missions ]
  • Artemis I (2022) — Completed
  • Artemis II (2025) — Flyby
  • Artemis III (2027) — Landing
```

Clicking a mission → loads it → teleports player to Earth vicinity → enters PREVIEW state.

---

## Step 8: Camera Integration

### Modify: `src/controls/CameraController.js`

Add mission-specific camera modes:

| Mode | Behavior |
|------|----------|
| **Follow Orion** | Chase cam locked behind Orion capsule |
| **Earth View** | Fixed at Earth, watching Orion depart |
| **Moon View** | Fixed at Moon, watching arrival/NRHO |
| **Free Cam** | Normal exploration (default) |
| **Cinematic** | Auto-switching: Earth view → follow → Moon view based on phase |

**Implementation:** Reuse the existing chase cam logic from `Spacecraft.js` but target the `MissionSpacecraft` mesh instead of the player ship.

---

## Step 9: Connect Trajectory to Live Ephemeris

The trajectory waypoints are stored relative to Earth (geocentric). But Earth moves in the scene (via `astronomy-engine`). The trajectory must move with Earth.

**Approach:**
```javascript
// In MissionTrajectory.update():
const earthScenePos = solarSystemField.getBodyPosition('Earth');
this.trajectoryGroup.position.copy(earthScenePos);

// For lunar-vicinity phases (NRHO, landing):
const moonScenePos = solarSystemField.getBodyPosition('Moon');
// Waypoints in these phases are selenocentric, so:
this.lunarPhaseGroup.position.copy(moonScenePos);
```

This way the trajectory "rides" with Earth/Moon as they orbit, and the user can zoom in from any angle.

---

## Step 10: File Structure Summary

```
src/
├── objects/
│   ├── MissionTrajectory.js      ← NEW: curve rendering
│   └── MissionSpacecraft.js      ← NEW: Orion/HLS meshes
├── services/
│   ├── MissionController.js      ← NEW: state machine + orchestration
│   └── MissionDataService.js     ← NEW: load/parse mission JSON
├── ui/
│   ├── MissionHUD.js             ← NEW: timeline, phase info, controls
│   └── HUDManager.js             ← MODIFY: integrate MissionHUD
├── controls/
│   └── CameraController.js       ← MODIFY: add follow-Orion mode
└── config/
    └── missions.js               ← NEW: mission registry/config

nasa_data/
└── missions/
    ├── artemis_i_trajectory.json  ← NEW: real Horizons data
    ├── artemis_ii_waypoints.json  ← NEW: approximated waypoints
    └── artemis_iii_waypoints.json ← NEW: approximated waypoints

scripts/
└── fetch_artemis_data.py         ← NEW: Horizons data fetcher
```

---

## Implementation Order

| Order | Task | Depends On | Effort |
|-------|------|-----------|--------|
| 1 | Create mission JSON files (waypoints) | Nothing | Data entry |
| 2 | `MissionDataService.js` — load + parse | Step 1 | Small |
| 3 | `MissionTrajectory.js` — render curves | Step 2 | Medium |
| 4 | `MissionSpacecraft.js` — Orion mesh + path following | Step 3 | Medium |
| 5 | `MissionController.js` — state machine | Steps 2-4 | Medium |
| 6 | `MissionHUD.js` — timeline + controls UI | Step 5 | Medium |
| 7 | Camera follow modes | Steps 4-5 | Small |
| 8 | NRHO parametric orbit | Step 3 | Small |
| 9 | Phase transition events + dialogs | Steps 5-6 | Small |
| 10 | Artemis I real data via Horizons script | Independent | Small |

**Start with Steps 1-4** to get a visible trajectory + moving Orion on screen. Everything else layers on top.

---

## Scale Reality Check

At the project's solar system scale (`AU_TO_SCENE = 5000`):

| Real Distance | Scene Units | Visual Size |
|--------------|-------------|-------------|
| Earth-Moon (384,400 km) | 12.85 | Comfortable viewing distance |
| LEO altitude (185 km) | 0.006 | Sub-pixel — don't render LEO phase geometrically |
| NRHO apoapsis (70,000 km) | 2.34 | Visible near Moon |
| NRHO periapsis (1,600 km) | 0.053 | Very close to Moon surface |
| Orion capsule (5m) | 1.67e-10 | Invisible — use exaggerated scale (0.02-0.05 units) |

**Key insight:** The spacecraft meshes must be **massively exaggerated** (millions of times real scale) to be visible. This is standard practice in space visualization tools. Scale them to ~0.02-0.05 scene units so they're visible when the camera is near Earth/Moon.

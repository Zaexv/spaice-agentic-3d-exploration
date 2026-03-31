# UI Components

## Overview
UI components for the 3D Space Exploration application.

## Files
```
src/ui/
├── PlanetExplorationDialog.js   # AI-powered planet info dialog
├── NarratorDialog.js            # Chat and narration UI
├── PlanetTargetingSquare.js     # Planet targeting visual overlay
└── PartyLoadingScene.js         # Loading screen with effects
```

## PlanetExplorationDialog
Tabbed dialog showing planet overview, characteristics, and AI-generated descriptions with optional TTS narration.

```javascript
import { PlanetExplorationDialog } from './src/ui/PlanetExplorationDialog.js';

const dialog = new PlanetExplorationDialog(openAIService, null);
dialog.show(planetData, (planet) => {
    console.log('Teleporting to:', planet.pl_name);
});
```

Works without AI services - shows basic planet information only.

## Configuration
AI services are configured in `/src/config/config.js`.

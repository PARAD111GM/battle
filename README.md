# RIVETFALL

An original, fast 2D arena brawler with a deterministic headless simulation and a Phaser 3 renderer. Built in strict TypeScript with Vite and Vitest. All art is generated locally; no external assets are needed.

## Run

Requires Node.js 22.12+ (validated on Node 24).

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run test:browser # Chromium must be installed; uses /usr/bin/chromium by default
```

If the default npm cache is not writable in a cloud environment, use `npm ci --cache /workspace/.cache/npm`.

## Movement sandbox controls

| Action | Keyboard |
| --- | --- |
| Move / climb | A D / W S |
| Jump / short hop | Space / release Space early |
| Fast fall / drop from ledge | S |
| Dodge roll | Left Shift |
| Hang / climb ledge | Move toward an edge while falling / W or Space |
| Pause | Escape |
| Collision debugging | F1 |

## Architecture

- `src/sim`: pure TypeScript; no Phaser, DOM, or browser globals. Seeded RNG; a fixed 60 Hz step consumes `InputCommand` values.
- `src/render`: Phaser scenes read simulation state. Runtime-generated textures are behind an asset library for future replacement.
- `src/input`: keyboard, mouse, and gamepad adapters.
- `src/data`: tuning and JSON arena/content definitions.
- `src/ui`: browser menus, HUD, and styling.
- `tests`: headless simulation checks.

All movement tuning lives in `src/data/tuning.ts`. Arena JSON defines grid dimensions, flat material tile array, spawn positions, prop rectangles, weapon spawns, and presentation metadata. Add an arena file in `src/data/arenas` and register it in `src/data/arenas.ts`.

See [DECISIONS.md](DECISIONS.md) for scope choices and milestone evidence.

## Combat controls

| Action | Player 1 | Player 2 (split keyboard) | Standard gamepad |
| --- | --- | --- | --- |
| Move / climb | WASD | Arrow keys | Left stick / D-pad |
| Aim | Mouse / eight-direction movement | Arrow keys | Right stick |
| Jump | Space | Enter | A / Cross |
| Melee / throw grabbed fighter | J / right mouse | Comma | X / Square |
| Fire | K / left mouse | Period | Right trigger |
| Cook / release grenade | Hold / release G | Slash | Right bumper |
| Roll | Left Shift | Right Shift | B / Circle |
| Block | L | Quote | Left trigger |
| Pick up / grab | E | Backslash | Left bumper |
| Cycle weapon | R; 1/2/3 select slots | Right bracket | Left stick click |
| Special (later milestone) | Q | Semicolon | Y / Triangle |

Player 2 uses the first connected gamepad, or the split keyboard if no pad is connected. Press a pad button to make it visible to the browser. Gamepad adapter tests use an emulated standard Gamepad API; physical controllers require device testing. Releasing jump early makes a short hop. Up + melee uppercuts; down + melee in the air dive-kicks. Tap melee in sequence for a three-hit combo. Interact near an enemy grabs them; melee throws the grabbed fighter. Bullets bypass block. Empty magazines reload automatically when firing.

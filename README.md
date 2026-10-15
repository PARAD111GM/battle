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

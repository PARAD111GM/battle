# RIVETFALL

An original browser arena brawler: four fighters, four destructible arenas, six guns, four melee weapons, five throwables, four specials, and up to eight local players/bots. Strict TypeScript, Phaser 3 rendering, and a separate deterministic 60 Hz simulation. Current in-game art and sound use no external assets.

For ongoing 3D character work, start with the [character model handoff](docs/art-direction/CHARACTER-MODEL-HANDOFF.md). The repository includes separate character prototypes; the current direction is to replace their bodies with user-selected models, preserving the selected proportions and sharing animations.

## Install and run on your computer

You need [Node.js](https://nodejs.org/) 22.12 or newer, including npm; **Node.js 24 is recommended and tested**. Use a modern desktop browser. The first dependency installation needs an internet connection. You do not need API keys, a database, or a separate game server.

If Git is installed, open Terminal, PowerShell, or Command Prompt and run:

```sh
git clone https://github.com/PARAD111GM/battle.git
cd battle
npm ci
npm run dev
```

Alternatively, choose **Code → Download ZIP** on GitHub, extract the ZIP, and open a terminal in the extracted folder containing `package.json`. Run `npm ci`, then `npm run dev`.

Keep the terminal open and open the address printed by Vite in your browser, normally `http://localhost:5173` on your own computer. Click **Enter the Arena → Quick Match** to play against three bots. Press **Ctrl+C** in the terminal to stop the server. After the first installation, start it again with `npm run dev` from the same folder.

To update an existing Git clone, stop the server, then run these commands from the `battle` folder:

```sh
git pull --ff-only origin main
npm ci
npm run dev
```

If you play the standalone HTML, run `npm run bundle:standalone` after updating and open the newly generated file. Browser settings and named control schemes are retained.

### Build a single file for offline play

After installing dependencies, run:

```sh
npm run bundle:standalone
```

This creates **`dist/rivetfall.html`** with the game engine, JavaScript, styles, and procedural assets embedded. Open that file in a desktop browser, or copy it to another computer. Once generated, it needs no Node.js installation, running server, or internet connection. Click or press a key in the game to enable browser audio.

Generated builds and `node_modules` are not committed to GitHub; the repository contains the source, lockfile, tests, build scripts, and validation reports needed to recreate them.

### Preview a production build

```sh
npm run build
npm run preview
```

Open the preview address printed in the terminal, normally port **4173**. This serves the standard `dist/` build. Use `dist/rivetfall.html` from the standalone command if you want a file you can open directly.

### Run in the Codex cloud environment

The full project path is **`/workspace/battle`**. To install, build, test, and create the standalone file:

```sh
cd /workspace/battle
npm run cloud:install
npm run cloud:start
```

If setup has already completed, only `npm run cloud:start` is needed. It starts or reuses the server on port **5173**, bound to all interfaces. Use the workspace's forwarded-port browser view if available. The cloud environment configuration screen itself is not a game preview, and your own computer's localhost address does not point to the cloud machine.

Cloud scripts are specific to the Linux workspace path above and require Bash, curl, and ripgrep. For your own computer, use the ordinary `npm ci` and `npm run dev` commands instead.

### Common setup problems

- **`node` or `npm` is not recognized:** install Node.js, reopen the terminal, and check `node --version` and `npm --version`.
- **`package.json` cannot be found:** change into the extracted or cloned `battle` folder before running npm commands.
- **Port 5173 is busy:** use the alternative address printed by Vite, or run `npm run dev -- --port 5174`. The cloud startup script deliberately requires port 5173.
- **The page stops working when the terminal closes:** keep `npm run dev` running, or generate and open the standalone HTML.
- **No sound:** click inside the game and check the master, SFX, and music settings.

Browser automation is optional for playing the game. It expects a running development server and a separately installed Chromium executable at `/usr/bin/chromium`; override `TEST_URL` and `CHROMIUM_PATH` if needed. `npm ci` installs the test libraries, but does not install Chromium.

## Play

Enter the arena, choose **Quick Match** for one human versus three Normal bots, or **Play** to configure the arena, 2–8 fighters, controllers, difficulty, teams, characters, damage mode, stocks, timer, and weapon set. Deathmatch counts individual knockouts, Team Battle counts team knockouts, and Last Fighter Standing eliminates players when their stocks run out. Health mode ends a life at zero HP; percent mode increases knockback until a fighter leaves the blast zone. Friendly fire is on by default.

Ironworks has warehouse catwalks and explosive cover. Skyline has rooftop gaps, glass, and fire escapes. Deepcore is a vertical mine with layered tunnels and ropes. Highbeam has concrete platforms and moving machinery.

| Action | Keyboard + mouse | Second keyboard | Standard gamepad |
| --- | --- | --- | --- |
| Move / climb | WASD | Arrows | Left stick / D-pad |
| Aim | Mouse / movement direction | Arrows | Right stick |
| Jump | Space | Enter | A / Cross |
| Melee / throw grabbed fighter | J / right mouse | Comma | X / Square |
| Fire | K / left mouse | Period | RT / R2 |
| Cook / release throwable | Hold / release G | Slash | RB / R1 |
| Special | Q | Semicolon | Y / Triangle |
| Sprint · 2× movement speed | Double-tap A or D, then hold | Double-tap ← or →, then hold | Double-tap left/right, then hold |
| Dodge roll | S + A or D | ↓ + ← or → | Down + left/right |
| Drop through platform | Double-tap S | Double-tap ↓ | Double-tap down |
| Block | L | Quote | LT / L2 |
| Pick up / grab / reload | E | Backslash | LB / L1 |
| Cycle weapon | R; 1/2/3 select slots | Right bracket; 7/8/9 slots | Left stick click |
| Throw held weapon | E + G | Backslash + Slash | LB + RB |
| Pause | Escape | | |
| Collision / bot debug | F1 / F2 | | |

Release jump early for a short hop; hold down in the air for fast fall. Climb with up/down; jump or move away to detach. Catch a ledge, then press up to pull over. Chain melee taps for a three-hit combo; up + melee uppercuts, down + melee in the air dive-kicks. Grab a nearby rival with interact, then melee to throw. Block stops melee until the guard breaks, but bullets bypass it. Fire with an empty magazine to reload automatically.

Sprint starts on the second left/right press and lasts while that direction stays held. Releasing it or changing direction ends the sprint. Duck while moving to roll; double-tapping down takes priority when dropping is available. Drop-through works on platform props and one-tile-thick catwalks with clear space below; thick floors and bedrock remain solid. Existing saved key bindings are kept, so a previously bound roll key still works alongside the new gesture.

Pickups require interact. Nearby pickups take priority over props. E lifts crates/barrels; attack or throw launches them. Grenades bounce and can be cooked; molotovs spread fire through combustible tiles, mines stick and arm, flashbangs blind, and smoke obstructs bot vision. Full special meter unlocks Rivet's Ground Slam, Flux's Bullet Time, Cinder's Air Strike, or Wisp's Shield Wall.

Assign each local player a distinct controller in setup. Connect gamepads and press a button so the browser detects them. The second keyboard is optional. `?lab` opens the two-human test sandbox, with player two using the first gamepad when available; `?quick` immediately starts the default bot match. Emulated Gamepad API checks cover the adapter; physical controllers need testing on the playing computer.

## Architecture and content

- `src/sim`: pure TypeScript, with no Phaser, DOM, browser clock, or browser globals. Seeded RNG and fixed steps consume `InputCommand` values.
- `src/render`: Phaser scenes, generated sprite assets, cached 32 × 32 terrain chunks, and bounded effects.
- `src/input`: keyboard, mouse, and gamepad adapters.
- `src/data`: tuning and JSON content definitions.
- `src/ui`: menus, HUD, and browser tools.
- `tests`: headless simulation tests; `scripts`: browser checks and packaging.

Navigation uses deterministic A* over physical walk, jump, drop, ledge, ladder, and rope edges. Changed terrain repairs the affected region. Bots use the same input commands as humans, with separate seeded decision randomness and difficulty-dependent reaction, aim, and defensive behavior. F2 shows their perception targets, goals, and paths.

Materials define durability, colors, and fire behavior. Explosions break terrain and chain barrels. Budgeted support flood-fill converts unsupported tiles to falling chunks; destroying ladder/rope anchors drops them. Doors, elevators, moving platforms, hanging lights, and bounded ragdolls use custom physics.

### Add a gun

1. Add a unique entry to `src/data/weapons.json`, copying an existing gun. Set its name, slot (`primary` or `sidearm`), damage, magazine/reserve, cooldown/reload ticks, range, pellets, spread, recoil, terrain power, knockback, and fire mode.
2. Hitscan guns need no new code. Projectile guns also set projectile speed, gravity, lifetime, and optional explosion radius. See the grenade launcher for the supported fields. Ricochet is optional per gun.
3. Add `{ "weapon": "your-id", "weight": 2 }` to an arena's `spawnTable`. Custom match selection picks up definitions automatically.
4. Optionally add a visual in `src/render/WeaponArt.ts`; unknown guns already receive a generic shape. Run the tests and build, then try it in a custom weapon match.

### Add an arena

1. Create JSON in `src/data/arenas` with `id`, `name`, `subtitle`, `background`, `width`, `height`, `tileSize`, and a row-major `tiles` array exactly `width * height` long. Materials: 0 air, 1 dirt, 2 wood, 3 concrete, 4 metal, 5 glass, 6 bedrock.
2. Add clear fighter-center `spawns`, weapon-center `weaponSpawns`, weighted `spawnTable`, and top-left prop rectangles. Use at least eight clear spawn positions for full matches. Ladder/rope props can specify `anchorCol`/`anchorRow`; support props must intersect supported tiles.
3. Moving-platform/elevator props accept `travelX`, `travelY`, and `periodTicks`. Keep structures connected to bedrock or explicit support props if they should survive collapse checks.
4. Import/register the JSON in `src/data/arenas.ts`; setup previews use the actual tile data. Run `npm test` to validate spawn clearance and navigation, and test movement/destruction in play.

See [DECISIONS.md](DECISIONS.md) for milestone evidence and scope choices. Optional online multiplayer is outside the six required milestones.

## Editor, settings, and replays

Open **Arena Editor** from the main menu to copy a built-in arena or start a blank layout. Paint or erase tiles with a 1/3/5-cell brush, place props and spawn markers, and use undo/redo while experimenting. Moving props expose their travel distance. **Save JSON** downloads a validated arena; **Load JSON** imports one. **Test Arena** starts a match on a copy, so destruction does not alter the editable layout. Return to the editor from the test match to keep working. Imports reject oversized files, unknown materials, invalid geometry, blocked spawns, and unsafe prop values.

Open **Controls → Customize Controls** from the main menu or pause menu to change bindings for both keyboard players, mouse buttons, and gamepad buttons/axes/deadzone. Select an action and press its new key; Escape cancels.

Under **Movement gestures**, enable or disable double-tap sprint, duck + direction roll, and double-tap down drop-through. Adjust the **Double-tap window** from 100 to 500 ms (250 ms by default); a longer window allows slower taps. These options apply to both keyboards and all gamepads, including D-pad and movement-stick input. You can also assign dedicated sprint, roll, and drop-through buttons in the bindings list. Hold a dedicated sprint button while moving to sprint.

Name your layout under **Saved control schemes** and choose **Save New**. Select a saved scheme to apply it, use **Save Changes** to update it after editing bindings, or **Rename** / **Delete** to manage it. Up to 16 named schemes are stored in this browser. Schemes include both keyboards, mouse bindings, gamepad controls, and movement gestures; audio and visual preferences stay independent. Current edits apply immediately and persist separately, so modifying controls does not overwrite a saved scheme until you save it. Resetting defaults keeps your saved schemes.

**Settings** also provides these controls along with screen shake, hitstop, and separate master/SFX/music volume. Rebinding a used control swaps bindings. Settings use guarded localStorage; the game still works when browser storage is unavailable. Short action taps are buffered through hitstop. All audio is synthesized locally; click or press a key to unlock browser audio.

Save a replay from pause or results and load it from the main menu. Replay files contain the arena, seed, initial fighters/settings, and compressed external input frames; deterministic bots make the same decisions on playback. Replays are versioned and validated, with bounded file size and duration. They are intended for the same game build; changing simulation rules can change old replay outcomes.

All global movement, combat phases/hitboxes, specials, AI difficulty, world-system budgets, camera, and visual feel settings live in `src/data/tuning.ts`. Per-item weapon/throwable/material definitions remain data driven.

## Validation and cloud setup

```sh
npm test                    # Headless rules, physics, AI, editor, input, audio, replay tests
npm run soak                # 50 seeded eight-bot matches; writes test-results/soak.json
npm run test:ui             # Full menu and match flow; server must be running
npm run test:bots           # Default one-human/three-bot browser smoke
npm run test:editor         # Paint, props, JSON import/export, and disposable playtest
npm run test:input          # Rebinding, short taps, and emulated gamepad input
npm run test:controls       # Named schemes, reload persistence, and Controls/pause navigation
npm run test:audio          # Synthesized sound, music, mute, and resource limits
npm run test:polish         # Hitstop, effects, replay hooks, and rendering stress
npm run test:standalone     # Build bundle first; blocks all external browser requests
npm run cloud:start        # Starts/reuses the cloud dev server on port 5173
```

`bash scripts/cloud-install.sh` installs the lockfile dependencies, builds, runs unit tests, and packages the standalone HTML. `bash scripts/cloud-start.sh` checks the app before starting it, records its process ID in `/tmp/rivetfall-vite.pid`, and logs startup to `/tmp/rivetfall-vite.log`. Install and startup are separate so dependency setup never blocks on a development server.

F1 reports render/simulation timing, pool usage, and chunk rebuilds. Simulation ticks exceeding 4 ms produce a rate-limited warning. The soak report records average, percentile, and maximum tick timing, genuine match endings, finite state, pool bounds, and an independent ten-second bot-progress monitor. Software-rendered cloud browser FPS is not a measurement of a mid-range laptop GPU; verify the 60 FPS target and physical gamepads on the playing hardware.

See [VALIDATION.md](VALIDATION.md) for the release checks and measured limitations.

# RIVETFALL

An original browser arena brawler: four fighters, four destructible arenas, six guns, four melee weapons, five throwables, four specials, and up to eight local players/bots. Strict TypeScript, Phaser 3 rendering, and a separate deterministic 60 Hz simulation. Art and sound use no external assets.

## Run

Requires Node.js 22.12+ (validated on Node 24).

```sh
cd /workspace/battle
npm ci --cache /workspace/.cache/npm
npm run dev
```

On your own computer, extract the source archive, open its folder in a terminal, and run `npm ci` then `npm run dev`. Open the address printed by Vite. The server binds port 5173 on all interfaces. In a cloud workspace, use the platform's forwarded-port browser view if it offers one; the cloud environment configuration screen itself is not a game preview.

```sh
npm test
npm run build
npm run preview
npm run test:browser
npm run bundle:standalone
```

Browser checks expect a running development server and Chromium at `/usr/bin/chromium`; override `TEST_URL` and `CHROMIUM_PATH` if needed. Standalone packaging creates `dist/rivetfall.html`, with its JavaScript and CSS embedded for offline use.

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
| Dodge roll | Left Shift | Right Shift | B / Circle |
| Block | L | Quote | LT / L2 |
| Pick up / grab / reload | E | Backslash | LB / L1 |
| Cycle weapon | R; 1/2/3 select slots | Right bracket | Left stick click |
| Throw held weapon | E + G | Backslash + Slash | LB + RB |
| Pause | Escape | | |
| Collision / bot debug | F1 / F2 | | |

Release jump early for a short hop; hold down in the air for fast fall. Climb with up/down; jump or move away to detach. Catch a ledge, then press up to pull over. Chain melee taps for a three-hit combo; up + melee uppercuts, down + melee in the air dive-kicks. Grab a nearby rival with interact, then melee to throw. Block stops melee until the guard breaks, but bullets bypass it. Fire with an empty magazine to reload automatically.

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

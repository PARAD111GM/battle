# Rivetfall — implementation decisions

- Build the six required milestones in order, with a tested, playable commit at each boundary. Online multiplayer is optional milestone 7 and is deferred until the local game is complete.
- Original identity: **Rivetfall**, an industrial arena brawler. Art is generated from shapes and pixel textures; no external characters, audio, fonts, or art are used.
- Simulation uses center-positioned fighter AABBs, top-left prop rectangles, pixels and seconds, and exactly 60 ticks per second. Phaser has no physics authority.
- The brief's references to numbered Sections 4/5 do not correspond to headings in the supplied text. The listed movement and combat features are the source of truth.
- Milestone 1 provides running, jump buffering, coyote time, short hops, fast fall, dodge rolls, ladder/rope climbs, and ledge hangs/climbs. No double jump or wall jump is added because neither was requested.
- Tile size is 24 pixels. Arena dimensions vary by layout; all exceed a single typical viewport. Warehouse sandbox is 112 × 44 tiles.
- Use local keyboard/mouse first, then gamepads and optional split keyboard. Gamepad mappings follow the standard browser Gamepad API.
- Cloud tasks already provide isolation. Work in the existing `/workspace/battle` checkout; do not create worktrees unless requested.

## Milestone log

Validation evidence is recorded when each milestone is completed.

### Milestone 1 — movement sandbox

Implemented and validated: fixed-step headless simulation, swept AABB terrain collision, responsive locomotion, roll immunity, coyote/buffer/variable jumps, fast fall, ladder/rope climbs, ledge hangs/climbs/drops, original procedural factory art, follow camera, F1 collision display, and pause.

Validation: 15 Vitest tests passed, strict TypeScript and Vite production build passed, Chromium input smoke passed with no page errors. Actual authored climb routes are tested. Software-rendered headless browser timing is unsuitable for a hardware FPS claim; smoke checks wait for simulation progress. Try A/D, Space tap/hold, Shift, and W/S at ladders. Combat is deliberately absent at this checkpoint.

### Milestone 2 — combat core

Implemented: phased unarmed combo/uppercut/divekick, guard break, grab/throw, pistol/SMG/shotgun, data-driven hitscan guns, finite magazines/reserves, automatic and interact reload, pickup switching, cooked bouncing grenades, knockback, health/KO/respawn, persistent match stats, local keyboard/gamepad adapters, and combat HUD/feedback.

Validation: 37 simulation tests passed (including 22 combat cases), strict build passed, Chromium movement/fire-damage/emulated-gamepad checks passed without page errors. Fixed a double roll-timer update caught by the retained movement tests. Physical gamepads have not been connected to the cloud machine. Terrain is intentionally solid until milestone 3.

### Milestone 3 — destruction v1

Implemented distinct dirt/wood/concrete/metal/glass/bedrock durability; bullets, melee, and explosions damage terrain. Crates stop bullets and can contain one-shot loot; barrels chain-react exactly once. Players can lift and throw physical props; swept chunks hurt fighters and expire within a bounded pool. Tile rendering uses 32 × 32 cached chunks and material damage cracks.

Validation: all 63 tests passed; production build and Chromium movement/fire-through-cover/gamepad/tile-break smoke passed without page errors. Independent review regressions fixed: pickup while reloading, melee using the normal trigger, and punches through intact walls. Collapse and fire are reserved for milestone 5.

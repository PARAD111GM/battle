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

### Milestone 4 — navigation and Normal bots

Implemented deterministic A*, physical walk/jump/drop/ledge/ladder/rope navigation, local terrain repair, bounded line-of-sight perception, weapon seeking, patrol/attack/cover/flee/hazard decisions, aim error, grenade use, and shared-command bot control. Default sandbox is one human versus three bots. F2 displays graph/path/goal/target data. Extended the central catwalk four tiles after physical route validation found an unreachable gap.

Validation: all 88 tests passed. All Warehouse spawn pairs have routes; all six pickup routes succeeded in108–216ticks. A1human/3bot1000tick diagnostic had all bots moving/firing with no persistent stall (~178ms headless total). Browser checks passed for three bots and F2 with no page errors. Fixed a ladder-top replanning oscillation using an actual climb-route regression. Added optional standalone HTML packaging; the bundled game booted with all external requests blocked.

### Milestone 5 — full content and match flow

Implemented all six guns, four durable melee weapons, five throwables, four character specials/archetypes, four arenas, four bot difficulties, health/percent damage, deathmatch/team/stocks rules, weighted filtered pickups, structural collapse, fire, interactive world props, full setup/character/results flow, and eight fighter/controller slots. Slot colors distinguish repeated archetypes. Friendly fire defaults on; accuracy counts a damaging grenade-launcher shot once. Percent-mode health pickups reduce damage percent.

Validation: all 186 tests and the production build pass. Coverage includes headless combat/content/rules tests, clear spawn/all-pair navigation checks, full Chromium menu flow and local input checks, and arena restart/texture cleanup checks. Four five-minute headless matches produced 588 knockouts/ringouts over 72,000 ticks with no nonfinite positions or terrain penetration. Structural work stayed within its 160-cell budget and falling chunks within the 96-body pool. Independent review caught and fixed premature airborne bot replanning, failed pickup interactions, incomplete Slam/Bullet Time semantics, and moving-platform collision/grounding. The mine elevator now has a clear shaft. Browser checks use emulated gamepad input; physical controller and hardware FPS verification remain for the playing machine.

Try Play → choose any arena and character, or Quick Match; experiment with custom throwables, team friendly fire, and percentage stocks. Q uses a full special meter. Destroy supports, burn catwalks, and ride the elevators. Optional online play remains deferred.

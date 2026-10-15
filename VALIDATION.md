# Release validation

Validated in the cloud workspace on 2026-10-15 with Node 24, npm 11, and Chromium 154. Milestones 1–5 each have a separate tested, playable commit; the final milestone includes the checks below.

## Automated checks

- The exact cloud installation script completes a clean lockfile install, strict TypeScript check, production build, all 242 headless tests across 17 files, and standalone HTML packaging.
- Browser UI checks cover setup, six-player matches, settings and rebinding, pause/results, replay download/import with exact simulation-state equality, and returning from replay to a live match.
- Editor checks cover materials and all prop types, clear spawn placement, undo/redo, validated JSON roundtrips and rejection, playtest return paths, and narrow screens.
- Input checks cover short taps, persistence, and emulated Gamepad API input. Audio checks cover gesture startup, distinct synthesized waveforms, music, exact silence when muted, voice limits, and disposal.
- Rendering checks cover 2–6-frame hitstop, input retained through the freeze, live effect toggles, unique replay event delivery, bounded effects, and texture cleanup on restart.
- The standalone document starts one human versus three bots with every external browser request blocked. The cloud browser prohibits direct `file://` navigation, so this check loads the exact HTML document inline; it does not claim a direct local-file navigation test.
- Fresh cloud startup and reuse both pass, with the development server still responding from a subsequent terminal command. Startup logs go to `/tmp/rivetfall-vite.log`.

All completed browser checks report zero page or console errors. Reproducible commands are listed in README and `package.json`.

## Fifty-match soak

The final isolated run passed **50/50** real eight-bot matches across all four arenas, all modes, both damage systems, and all bot difficulties. It simulated 320,763 ticks (89.1 minutes of match time) in 101.3 seconds. Thirty matches ended by score, sixteen by stocks, and four by timer; seventeen included heavy explosives.

There were no crashes, nonfinite states, pool violations, or bot inactivity intervals exceeding ten seconds. The longest observed interval was 9.783 seconds. The monitor requires 96 pixels of real horizontal travel, grounded/climbing vertical travel, or actual combat damage; firing misses and jumping in place do not count. It does not move bots or force match endings. These are results for the recorded seeds, not a guarantee for every custom arena.

The full per-match results are in [docs/validation-soak.json](docs/validation-soak.json). The run included 17,432 tile breaks, 6,648 collapsed tiles, and 7,307 explosions. Reproduce with `npm run soak`.

## Performance and practical limits

Headless simulation tick timing was average **0.285 ms**, p95 **1.403 ms**, p99 **2.133 ms**, and maximum **43.995 ms**. There were 208 ticks above 4 ms (0.065%), which the harness reports as warnings. The strict per-tick budget is therefore not universally met in this environment; elapsed timing includes host scheduling and garbage collection.

The rendering stress case uses eight bots and heavy terrain destruction. This cloud browser reports the SwiftShader software renderer, 11.2 FPS, and render CPU p95 of 2.8 ms. Its simulation-frame timing can include several fixed ticks. The complete rendering check is archived in [docs/validation-render.json](docs/validation-render.json). These measurements do **not** verify the requested 60 FPS on a mid-range laptop GPU; that remains a hardware check.

Physical gamepads have not been connected to this cloud machine. Test the actual controllers on the playing computer. Optional online multiplayer is outside the six required milestones and is not implemented.

Replays reproduce the same simulation build. They are not guaranteed to remain compatible after changes to game rules or bot behavior.

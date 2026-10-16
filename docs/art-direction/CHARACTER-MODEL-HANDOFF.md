# Character model handoff

Updated 2026-10-16. Repository: `PARAD111GM/battle`, branch `main`.

## Current direction

The next task is to replace the adapted prototype bodies with three high-quality humanoid models selected by the user for their exact proportions. This decision supersedes the older art documents' suggestion to keep refining the existing procedural body shapes.

Use clean, stylized 3D characters and a reusable animation workflow. Fluid, believable motion and good deformation matter more than producing more still-image concepts. The vector and generated sequential-sprite experiments are historical studies, not the current direction.

Start with the selected female model. Import and inspect it without reshaping its silhouette, then show clear front, side, and three-quarter views plus a short deformation/motion test. Establish a good base before building costumes or the full animation library. Preserve the existing prototypes as a reference and fallback.

## Characters and proportions

| Body profile | Character | Direction |
| --- | --- | --- |
| Small female | Katnip Neverdo | Original Katniss-inspired archer parody; natural proportions, straight upper arms, smooth waist-to-hip contours. |
| Medium male | Mr. Midnight | Original suited-assassin parody; lean/average male build. |
| Large muscular male | Brick Barrage | Original commando parody; broad, muscular build. |

The broader roster should use recognizable action-hero references with original parody names and designs, not literal movie characters. The user explicitly chose this approach.

The user wants three body profiles sharing an animation library, with proportion adjustments where necessary. Preserve selected models' anatomy; animation reuse does not require forcing all meshes onto an identical rest skeleton. Assess retargeting, compatible deformation rigs, and separate animator controls as appropriate. The prototype's 62-bone count is not a requirement for the final assets.

Earlier prototype targets were roughly 95% / 100% / 105% core body height. Avoid a drastically smaller female hitbox or an exaggerated height gap. Gameplay collision dimensions are independent of mesh bounds; the current fighter box is 20 x 38. Selected model proportions take priority over old procedural measurements.

Earlier feedback specifically rejected exaggerated female hips, shoulders broader than the medium male's, a sharp upper-hip shelf, and curved/distorted upper arms. The user then chose to supply suitable finished base models instead of continuing those contour edits. Do not restart that editing loop.

## Selected asset and missing inputs

- Female candidate: [BlendSwap 30428](https://blendswap.com/blend/30428), described by the user as a newer version of [BlendSwap 24462](https://blendswap.com/blend/24462).
- The user also supplied a Google Drive archive link. The kickoff prompt carries that link; it is not republished here.
- Neither BlendSwap listing nor the Drive archive was successfully retrieved in the previous session. No selected model was downloaded, opened, appended, rigged, or integrated. Author, license, actual file format, archive contents, rig quality, and whether the Drive file matches the listing remain unverified.
- The medium and large replacement models have not been selected. Do not silently choose final replacements for the user.
- The user supplied front/side female references and stylized male references in the earlier conversation. Those source reference images are not stored in this repository. Existing rendered studies are outputs of the prototype work, not copies of the reference images.

For marketplace downloads, report author, license, file format, and credit cost before downloading, as requested by the user. Obtain approval before spending credits. For the already supplied Drive file, proceed with the authorized download when access works. Record provenance and confirm redistribution terms before adding downloaded assets to GitHub. Never put API keys in repository files or prompts.

Prefer a well-rigged model, but a clean humanoid mesh in a suitable rest pose can be rigged and weight-painted if needed. If a selected source is Maya-only, use an appropriate Maya export such as FBX with skinning and baked animation; do not claim Blender directly imports `.ma` or `.mb` or preserves every custom control automatically.

## Existing repository state

The last model-edit commit before this handoff is `083e433e76ddef6e32f17dc8fcf54c4733ae6821` (`art: smooth Katnip hips and refine medium body proportions`). It was verified on GitHub `main` with a clean local worktree before adding this document.

The playable game remains a TypeScript/Phaser browser arena brawler. The newer 3D character studies are isolated previews and have not replaced the in-game art. Preserve the gameplay, saved control schemes, configurable gestures, and movement behavior while working on character assets.

| File or directory | Purpose |
| --- | --- |
| [shared-rig/README.md](shared-rig/README.md) | Existing preview, animation limitations, and rebuild instructions. |
| [Editable Blender scene](../../art/characters/shared-rig/shared-rig.blend) | Current three-character prototype scene. |
| [Animated GLB](shared-rig/shared-rig.glb) | Current shared run demonstration. |
| [Viewer](shared-rig/viewer.html) | Local interactive orbit, front/side view, pause, scrub, speed, and skeleton controls. |
| [Source credits](../../art/characters/shared-rig/SOURCES.md) | Quaternius CC0 provenance and source hashes. |
| [Source models](../../art/characters/shared-rig/sources) | Four unmodified, tracked source GLBs and their license notice. |
| [Verification report](../../art/characters/shared-rig/verification.json) | Recorded checks for the current prototype. |
| [Preview metadata](shared-rig/metadata.json) | Exported body profiles and animation metadata. |
| [Build script](../../scripts/build-shared-rig.py) | Recreates the old prototype from vendored source GLBs. |
| [Source normalization](../../scripts/normalize-shared-rig-source.py) | Converts the existing female source rest pose into the prototype's common coordinates. |
| [Proportion script](../../scripts/shared-rig-proportions.py) | Existing profile definitions and rebasing. |
| [Styling scripts](../../scripts/shared-rig-style.py) / [Katnip styling](../../scripts/shared-rig-kat.py) | Existing prototype mesh/material/costume generation. |
| [Viewer source](../../scripts/shared-rig-viewer.mjs) | Three.js viewer source; the compiled browser bundle is tracked. |
| [Preview exporter](../../scripts/render-shared-rig-preview.mjs) | Captures and checks the prototype's GIF/MP4 output. |

The editable scene, original source models, license, GLB, viewer bundle, preview images, GIFs, and video are committed. `node_modules`, `dist`, temporary render frames, and Blender backup files are intentionally ignored and can be regenerated. This handoff does not imply that missing replacement models have been backed up.

## Prototype constraints to avoid carrying forward blindly

- `build-shared-rig.py` resets Blender to an empty scene, imports the four old source GLBs, and overwrites the existing prototype `.blend`, `.glb`, metadata, and previews. It will not preserve a manually imported replacement model. Use a separate working scene/path until the replacement pipeline is deliberate.
- The existing viewer/export checks assume `SmallRig`, `MidnightRig`, and `BrickRig`, three skins, and one shared `Run` clip. Adapt those checks for a new pipeline; do not distort a selected model to satisfy old hardcoded names or counts.
- Only one 0.8-second run cycle has been reviewed in this prototype. The source packs contain additional clips, but they are not a finished or approved game animation library. Idle, walk, sprint, crouch, roll, drop-through, jump, fall, landing, attacks, weapon handling, reactions, and defeat still need work.
- The old source rig has animated feet parented independently to the root. Changing leg-to-torso length ratios without retargeting foot translation breaks ground contact. This is a constraint of that source rig, not of every possible replacement.
- The previous upper-arm distortion was fixed by comparing armature-space `tail_local - head_local` directions in source normalization. Do not restore the older comparison of parent-relative `Bone.y_axis` values across different rest rolls.
- Katnip's old strap/zipper follows the jacket surface with interpolated nearby skin weights. A standing-pose fit alone does not establish that accessories remain attached during movement.
- Numerical loop closure, matching bone names, and a passing export do not establish good-looking animation. Inspect foot planting/sliding, alternating stride, knee direction, hip/shoulder deformation, hand grips, clipping, and the silhouette in motion.

## Starting on another machine

The previous cloud checkout is `/workspace/battle`. That is a path on the cloud machine, not the user's desktop. Locate or clone the repository on the new machine, and use its actual local path.

```sh
git clone https://github.com/PARAD111GM/battle.git
cd battle
npm ci
npm run dev
```

For an existing checkout, inspect `git status` first and preserve local work before updating with `git pull --ff-only origin main`. Do not reset or overwrite user changes.

Node.js 24 is the previously tested version; the README specifies Node 22.12 or newer. To view the old 3D prototype, open the Vite server at `/docs/art-direction/shared-rig/viewer.html`, normally `http://localhost:5173/docs/art-direction/shared-rig/viewer.html` on a local machine.

Blender 4.3.2 was used previously. The old preview exporter also needs Chromium, FFmpeg, and ffprobe; set `CHROMIUM_PATH` to the local browser executable when necessary. These dependencies and running processes do not transfer merely by cloning GitHub. The old exporter uses a `/tmp` path, so review portability before running it on Windows. No rebuild is necessary just to inspect the committed scene and previews.

## Tools and first milestone

Verify which tools the new session can actually call: Blender control or a local Blender executable, file/network access, and any connected Google Drive or BlendSwap tools. Connected apps appeared in the previous account's UI but were absent from that session's callable tools. Do not assume that limitation persists in a new session, and do not diagnose an account setup failure merely from a missing tool.

The previous cloud session saved allowed-domain entries for `drive.google.com`, `drive.usercontent.google.com`, and `blendswap.com`; direct requests still received proxy `CONNECT 403` after the user reported publishing. Saved configuration did not establish live access. No file was downloaded. Do not repeat a long connector setup loop: test actual access once, identify the precise blocker if any, and use a supported local-file route when available. Keys are not included in this handoff.

First deliverable:

1. Obtain the selected female file and report its actual contents, provenance, mesh/rig state, textures, and dependencies.
2. Import it into a separate editable review scene, preserving the supplied proportions and keeping automatic script execution disabled unless trusted scripts are specifically needed.
3. Show front, side, and three-quarter views at consistent scale, then a short motion/deformation test from the actual model.
4. Recommend the rig/retargeting approach needed to share animations with the future medium and large models. State what still needs selection or review.
5. Save source/editable assets and reproducible exports as permitted by their licenses, with concise documentation. Keep this work isolated from gameplay until the models and motion are reviewed.

Proceed with reversible inspection and preparation without repeatedly asking permission. Ask only for genuinely missing files, consequential model choices, or paid actions. Report what was actually inspected and tested; do not label generated renders as functioning rigs or call a model approved without user review.

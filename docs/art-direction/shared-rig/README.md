# Shared animation: three body templates

Three compatible humanoid rig templates reuse one run animation. From left to right:

| Template | Test character | Body and costume |
|---|---|---|
| Small female | **Katnip Neverdo** | Woodland archer with balanced hip and shoulder widths and a slightly shorter body; dark braid, olive jacket, bow, and quiver. An original Katniss-inspired parody. |
| Medium male | **Mr. Midnight** | Average build, dark suit, long hair, and beard. |
| Large muscular male | **Brick Barrage** | Slightly taller body with broad shoulders and muscular arms, tactical trousers, and bandolier. |

This is an isolated animation and proportion test; these models are not integrated into the game.

![Small, medium, and large characters using the same run animation](shared-rig-run.gif)

- [60 fps video](shared-rig-run.mp4) — six repetitions of the 0.8-second cycle. Download the raw file if GitHub does not play it inline.
- [Side-view GIF](shared-rig-run-side.gif) — inspect the alternating legs and footfalls.
- [Still image](shared-rig-run.png).
- [Standing proportion comparison](shared-rig-proportions.png) — straight-on orthographic view with arms lowered to compare hip/shoulder widths and height.
- Katnip's reference-guided silhouette: [front](katnip-proportions-front.png) and [side](katnip-proportions-side.png), at the same camera scale.
- [Front run pose](shared-rig-front.png).
- [Interactive 3D viewer](viewer.html) — orbit the models, switch front/side views, pause, scrub, change speed, and display the skeletons. GitHub shows the HTML source; run it locally using the instructions below.
- [Animated GLB](shared-rig.glb) — import into Blender or another glTF-compatible tool.
- [Editable Blender scene](../../../art/characters/shared-rig/shared-rig.blend).

## What this verifies

The Blender scene contains **three compatible 62-bone armatures** and the **same Run Action**. Each template has its own rest proportions, while bone names, hierarchy, and local axes remain compatible. Upper-body joint offsets and bone lengths change with the template; mesh vertices and weighted accessories are rebased to match. The whole-character scales are approximately 0.9455, 1.00, and 1.0256 before the additional proportion changes. The viewer preserves those relative sizes.

The small body's visible hip and shoulder widths sit near the **midpoint between the medium body's hip and shoulder widths**. With arms lowered, the medium hips measure 0.3621 and shoulders 0.4136 scene units; Katnip measures 0.3879 at the shoulders and 0.3868 at the hips. This makes her shoulders about 6% narrower and hips about 7% wider than Midnight's. The reference-guided contour pass preserves her waist width and raises the widest thigh section from roughly 41% to 48% of body height. Core head-to-sole body heights remain approximately **95%, 100%, and 105%**. Separate hair and archery equipment do not set the body-height measurement.

Gameplay collision dimensions are configured independently of these preview meshes. The current game uses a common 20×38 fighter body box; integrating the art should retain deliberate collision tuning rather than deriving hitboxes from hair, weapons, or mesh bounds.

These rigs share local animation transforms rather than identical final joint positions. The GLB contains one 0.8-second `Run` clip controlling all three independently placed characters, with a separate skin and bind matrices for each. Video frames are sampled directly from the rigged 3D scene at 60 fps; the GIF uses separate evenly spaced samples at 50 fps.

The build checks each rig for fixed bone lengths and exact loop closure, and compares local animation transforms across templates. Independent validation also checks skin weights, alternating foot motion, and model/foot bounds.

The original authored run approached its starting pose without including a duplicate closing pose. The build preserves every authored key value, appends that closing pose one source-frame interval later, and uniformly retimes the completed cycle to 0.8 seconds. The source GLBs remain unchanged. See [metadata.json](metadata.json) and [the editable asset's verification report](../../../art/characters/shared-rig/verification.json).

## Art status

These are **adapted prototype models**, based on Quaternius's CC0 modular characters. They demonstrate the shared animation workflow before final character modeling. Kat uses a female source mesh normalized to the compatible rig, with archer costume details. Her silhouette follows the supplied front and side proportion references: a defined waist, fuller upper thighs, and more natural chest and pelvis contours under the jacket and trousers. Midnight combines the suit with customized hair and beard. Brick has broader arms/chest, tactical trousers and boots, and a bandolier.

New characters can use one of the three templates, replacing meshes, materials, hair, and accessories while preserving its binding conventions. The female source has a different native rest pose; the build converts its meshes to the common rest coordinates before applying the small profile. This conversion aligns bone directions in armature coordinates and verifies limb endpoints, keeping the upper arms aligned from shoulder to elbow. Its native animation is not mixed into the shared run.

Katnip's strap and zipper are sampled along the jacket surface and inherit the nearby cloth's skin weights. This keeps the details attached through shoulder and torso motion instead of fitting only the standing pose.

## Animation and proportion limits

Only the **run cycle** is reviewed in this prototype. The rest of the gameplay animation set still needs implementation and review across all three templates: idle/walk/sprint, crouch/roll/drop-through, jump/fall/land, attacks and weapon handling, reactions, and defeat. Final character art should follow those motion checks.

The source rig animates feet as independent children of the root. This pass preserves leg-length ratios and scales leg lengths, stride, and foot translation together. Katnip's wider hip spacing also moves the corresponding leg and foot origins laterally, with ankle alignment checked through the run. Independent leg-to-torso length changes require retargeting the foot tracks and checking floor contact. Weapon grips, reach, and costume collisions also need checks when the corresponding clips are added.

[Asset provenance, licenses, and source hashes](../../../art/characters/shared-rig/SOURCES.md). Three.js is included locally under its [MIT license](THREE-LICENSE.txt); the viewer makes no CDN requests.

## Open the viewer

From the repository root:

```sh
npm install
npm run dev
```

Open the Vite server at `/docs/art-direction/shared-rig/viewer.html` (normally `http://localhost:5173/docs/art-direction/shared-rig/viewer.html`). In the cloud environment, use the forwarded Vite port with that same path. The preview requires WebGL.

## Rebuild

With Blender 4.3 or later installed:

```sh
blender -b --python scripts/build-shared-rig.py -- --preview
```

This rebuilds the editable scene, animated GLB, metadata, poster, quarter-cycle poses, standing proportion comparison, and Katnip's front/side silhouette views. The review poses are temporary and leave the shared run unchanged. It uses EEVEE with 16 samples by default. `--render` additionally writes 48 PNG frames under `art/characters/shared-rig/renders/`; those intermediate frames are ignored by Git. Cycles CPU is available with `--engine CYCLES --samples 32`; denoising is disabled for compatibility with this cloud build.

To capture the interactive 3D scene into GIF/video previews, install FFmpeg (including `ffprobe`) and Chromium, then run:

```sh
node scripts/render-shared-rig-preview.mjs
```

The capture script starts its own local HTTP server and verifies the model and exported media. Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`.

The template definitions and mesh rebasing are in `scripts/shared-rig-proportions.py`. Source normalization is in `scripts/normalize-shared-rig-source.py`; costume and appearance logic is in `scripts/shared-rig-style.py` and `scripts/shared-rig-kat.py`. The viewer source is `scripts/shared-rig-viewer.mjs`; its header documents rebuilding the local Three.js bundle without changing game dependencies.

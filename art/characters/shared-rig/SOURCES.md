# Shared humanoid rig — source assets

Original models and animations: **Quaternius, Ultimate Modular Males / Ultimate Modular Characters**, released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The original author notice is preserved in [sources/LICENSE-Quaternius.txt](sources/LICENSE-Quaternius.txt).

Original pack page: https://quaternius.com/packs/ultimatemodularcharacters.html

The four unmodified source GLBs are vendored from [Ducz.CharacterCreator at revision fcd215b58eec5c9ed97d0ba5f696d0e7dc085e08](https://github.com/LuanDucate/Ducz.CharacterCreator/tree/fcd215b58eec5c9ed97d0ba5f696d0e7dc085e08/public/models). That repository preserves Quaternius's CC0 notice for the modular character assets and converts the original embedded-buffer glTF files to GLB. The shared notice retains its original “Ultimate Modular Males” heading; the female model is from the same CC0 modular character pack.

| Local file | Original filename | SHA-256 |
|---|---|---|
| `sources/suit.glb` | `Suit.glb` | `500ae95582c31288606934f6d28a8d2c5122e1e96a5b99a776da36197250de12` |
| `sources/casual.glb` | `Casual_2.glb` | `caaed4ea0846b6c40471830ed13a9067eeb375e942b3986ea9b6175af6cee6d1` |
| `sources/swat.glb` | `Swat.glb` | `61631bafc8b3a5c2b591c4641ec4249162795bb3c3191a1aa1693b25b4dd560c` |
| `sources/female.glb` | [`Female/Casual.glb`](https://github.com/LuanDucate/Ducz.CharacterCreator/blob/fcd215b58eec5c9ed97d0ba5f696d0e7dc085e08/public/models/Female/Casual.glb) | `bc2d84fba249ebaa0629cb9d133ad37234196e4b8004aa205a6397abed04e05c` |

All four sources have the same ordered 62-joint names and hierarchy. The three male sources have byte-identical inverse bind matrices and `Run` channels when matched by bone name and property. The female source has different rest matrices, proportions, and animation values. Its meshes are normalized into the common bind coordinates before the small profile is applied. Only the male source's 0.8-second run supplies the shared Action. The sources retain their full collection of 24 clips for later work.

## Prototype adaptations

Mr. Midnight combines the suit body, trousers and shoes with the casual character's head. Brick combines the casual body, suited character's head and tactical trousers/boots. Katnip Neverdo uses the female casual body, head, trousers, and shoes, with an archer costume and accessories. The style scripts change materials and mesh shape, add hair/costume details, and smooth coincident mesh seams.

Katnip's torso and leg contours and Mr. Midnight's lean medium build are refined using the user's proportion references. These are mesh edits to the CC0 sources, preserving the shared skeleton and animation. Local subdivisions round the hip and calf contours, with new vertices inheriting normalized interpolated skin weights. Katnip's jacket strap and zipper use additional weighted samples to follow the cloth surface. The reference images are visual guidance and are not included in the asset package.

These are adapted prototype characters for testing compatible skeletons and shared animation. They are not final bespoke models matching the original illustrated style sheet. More refined character meshes can use the same templates and binding conventions later.

The proportion script creates small, medium, and large skeleton data blocks with compatible local axes and distinct upper-body dimensions. Katnip retains balanced exterior shoulder and hip widths. Core body heights remain near 95%, 100%, and 105%. The script rebases meshes and applies uniform scales. All three instances share one unchanged prepared Run Action. Leg-length ratios are preserved because the feet use separate root-space animation tracks; uniform scale changes those tracks with the legs, while stance adjustments shift paired leg and foot origins together. The source files remain unchanged so the build stays reproducible.

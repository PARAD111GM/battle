# Shared humanoid rig — source assets

Original models and animations: **Quaternius, Ultimate Modular Males / Ultimate Modular Characters**, released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The original author notice is preserved in [sources/LICENSE-Quaternius.txt](sources/LICENSE-Quaternius.txt).

Original pack page: https://quaternius.com/packs/ultimatemodularcharacters.html

The three unmodified source GLBs are vendored from [Ducz.CharacterCreator at revision fcd215b58eec5c9ed97d0ba5f696d0e7dc085e08](https://github.com/LuanDucate/Ducz.CharacterCreator/tree/fcd215b58eec5c9ed97d0ba5f696d0e7dc085e08/public/models/Male). That repository preserves Quaternius's license and converts the original embedded-buffer glTF files to GLB.

| Local file | Original filename | SHA-256 |
|---|---|---|
| `sources/suit.glb` | `Suit.glb` | `500ae95582c31288606934f6d28a8d2c5122e1e96a5b99a776da36197250de12` |
| `sources/casual.glb` | `Casual_2.glb` | `caaed4ea0846b6c40471830ed13a9067eeb375e942b3986ea9b6175af6cee6d1` |
| `sources/swat.glb` | `Swat.glb` | `61631bafc8b3a5c2b591c4641ec4249162795bb3c3191a1aa1693b25b4dd560c` |

All three source files contain the same ordered 62-joint skeleton and byte-identical inverse bind matrices. Their `Run` animation channels are also identical when matched by bone name and property. The run lasts 0.8 seconds. The sources retain their full collection of 24 animation clips for later work.

## Prototype adaptations

Mr. Midnight combines the suit body, trousers and shoes with the casual character's head. Brick combines the casual body, suited character's head and tactical trousers/boots. The style script changes materials and mesh proportions, adds hair/beard and costume details, and smooths coincident mesh seams. It leaves the skeleton's rest transforms unchanged.

These are adapted prototype characters for testing a shared skeleton and animation workflow. They are not final bespoke models matching the original illustrated style sheet. The shared rig can later accept more refined character meshes while retaining compatible weights and joint proportions.

The editable scene uses one shared skeleton data block and one run action across the two character instances. The source meshes and authored animation are retained in the files above so the build remains reproducible.

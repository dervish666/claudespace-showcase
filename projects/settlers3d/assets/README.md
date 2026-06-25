# Building models (optional)

Drop low-poly **`.glb`** building models in this folder and Settlers 3D will use them
in place of its built-in procedural meshes. With no models here, the game falls back
to the procedural buildings — everything still works.

## How to wire one up

1. Put the file here, e.g. `assets/house.glb`.
2. Add an entry to the `MODELS` map near the top of the renderer section in
   [`../index.html`](../index.html):

   ```js
   const MODELS = {
     house: { url: 'assets/house.glb', scale: 1.0, yaw: 0, y: 0 },
   };
   ```

   - **`scale`** is multiplied by the building's footprint size (see table), so a value
     near `1.0` is a good start; tweak until it fills its tiles.
   - **`yaw`** (radians) rotates the model — orient it so the **front/door faces +Z**.
   - **`y`** nudges vertical position if the model's origin isn't at its base.

3. Reload. Models load at boot; if one fails it logs a warning and that type stays procedural.

## Building types and footprint sizes

Match `scale` to the footprint (in tiles):

| size 3 | size 2 | size 1 |
|---|---|---|
| `hq` | `sawmill` `mill` `bakery` `farm` `smelter` `toolmaker` `mint` `house` | `woodcutter` `forester` `quarry` `fisher` `well` `hunter` `guard` `cottage` `tavern` `ironmine` `coalmine` `goldmine` |

## Where to get cohesive CC0 kits

This is a **public** repo, so only add **CC0** (or clearly-compatible) assets and credit them
in the "Attributions" section below even though CC0 doesn't strictly require it.

- **Kenney** — <https://kenney.nl/assets> (Castle Kit, City Kit, etc.) — all CC0.
- **KayKit / Kay Lousberg** — <https://kaylousberg.itch.io> (Medieval Builder Pack) — CC0, ideal low-poly medieval look.
- **Quaternius** — <https://quaternius.com> — CC0 low-poly packs.
- **Poly Pizza** — <https://poly.pizza> (filter by CC0) — individual props.

A single kit from one artist keeps the style cohesive — much better than mixing sources.

## Authoring / exporting

- **Blender** → `File ▸ Export ▸ glTF 2.0`, format **glTF Binary (.glb)**. Apply transforms,
  +Y up, keep the poly count low to match the style and stay fast (there can be 14–40 buildings).
- **ComfyUI** → image-to-3D (Hunyuan3D-2 / TripoSR / InstantMesh) exports `.glb`; also great for baking textures.
- **Do not** use Draco or KTX2 compression — the vendored loader has no decoders for them. Export plain `.glb`.

## Attributions

_(none yet — add lines here as models are added, e.g. "house.glb — Kenney, CC0")_

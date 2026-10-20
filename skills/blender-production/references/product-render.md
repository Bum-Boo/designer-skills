# Product scene workflow

The bundled model is a rounded portrait device with independent body, glass, procedural screen, text and controls, plus three area lights, camera and studio floor. Start with `assets/example-product.json`; the values are meters. Its geometry and labels are editable after opening the scene.

## Choose an appropriate starting point

The template supports portrait-device proportions and a limited set of colors, dimensions, Latin labels, camera focal length, render size and samples. It validates its exact JSON fields, finite values and supported proportions. For a bottle, chair or a detailed manufactured object, build new geometry from the brief instead of stretching the device into an unrelated shape.

For reference work, identify the visible silhouette, major parts and known dimensions first. Check large forms before small details. Record uncertain hidden geometry. Set materials by part and adjust lighting in the render camera so reflections reveal the intended form. Use a low-cost frame to resolve these decisions before the final render.

## Edit a specification

Copy the example JSON into the working project. Keep its complete field set. For a second valid variation, try `width_m: 0.18`, a different `body_color`, and a short `label`. The built-in font accepts printable ASCII. Other scripts need an appropriate licensed font and an asset inclusion check.

Run the two commands in SKILL.md, pointing `--spec` at the copied JSON. Output includes `product.blend`, optional `product.png` and `build.json`. The fresh inspection writes `inspection.json` and, with `--render-check`, `reopened.png`.

## Acceptance

- Saved file reopens and the expected editable parts, camera, materials and lights are present.
- Requested size matches the actual PNG dimensions; inspect render percentage as well as scene resolution.
- Actual image has the intended framing, readable labels, coherent reflections and no missing assets.
- For reference matching, compare silhouette and visible details with that reference. A successful template render is evidence for the template only.

Keep the specification and generation script beside the delivered scene. The saved render path is relative (`//product.png`). Pack required assets or deliver a complete dependency folder.

For Blender API details consult the installed version and the [official Python API](https://docs.blender.org/api/current/), [Cycles manual](https://docs.blender.org/manual/en/latest/render/cycles/index.html) and [external data documentation](https://docs.blender.org/manual/en/latest/files/blend/packed_data.html).

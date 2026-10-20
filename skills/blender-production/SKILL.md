---
name: blender-production
description: Create or revise an editable Blender product scene from a brief, dimensions or references, then save, reopen and inspect an actual render. Includes a configurable portrait-device starter scene. Use for product visualization and .blend handoff.
license: MIT
compatibility: Targets Blender 5.2.2 with Python scripting and Cycles. CPU is the default; CUDA or OptiX require compatible hardware. No MCP server required. Check a small scene before using another version.
---

# Blender production

Deliver an editable `.blend`, the requested image, and enough source to reproduce changes. Work in a new output directory so an existing project stays recoverable.

## Establish the scene

Check the installed Blender version and executable. Record the requested dimensions, units, materials, camera, resolution and deliverables. Treat dimensions inferred from a picture as assumptions. Keep the body, glass, controls, text and studio separately editable.

Use [the starter workflow](references/product-render.md) for the bundled portrait-device model. For another object, author appropriate geometry; this template does not recover arbitrary geometry from a photograph. AI mesh repair, toon shading and animation automation are outside the bundled implementation.

## Build and inspect

1. Copy and edit `assets/example-product.json`. The supported fields are validated by the builder; labels use printable ASCII with the built-in font. Read [runtime limits](references/runtime.md) before changing version, GPU backend or language.
2. Generate a small test render before increasing resolution or samples. Check the image itself for silhouette, cropping, reflections, typography and missing textures. Object counts alone do not establish visual quality.
3. Save and open the `.blend` in a fresh background process. Run the inspector and render again. The inspector checks FILE images; check linked libraries, caches and sequences separately when present.
4. Compare the actual output size, image and saved scene against the brief. Report any remaining mismatch. Deliver the `.blend`, PNG, copied JSON and generation script, plus Blender version and the location of common edits.

Replace `BLENDER`, `SKILL_DIR` and output placeholders with actual paths; quote paths containing spaces. Use new processes, separate from a user's live unsaved scene.

```bash
BLENDER -b --factory-startup --python-exit-code 1 --python SKILL_DIR/scripts/product_scene.py -- --spec SKILL_DIR/assets/example-product.json --out NEW_OUTPUT --render --device CPU
BLENDER -b --factory-startup --disable-autoexec NEW_OUTPUT/product.blend --python-exit-code 1 --python SKILL_DIR/scripts/inspect_scene.py -- --out NEW_INSPECTION --render-check --device CPU
```

The builder refuses existing output files. `--device CUDA` or `OPTIX` fails explicitly when unavailable; use CPU or report the missing dependency. Global Blender preferences are not saved. Blender path/date stamps are disabled in exported images. JSON receipts contain absolute local paths; review them before sharing.

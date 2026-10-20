---
name: reference-to-web-toy
description: Recreate an interactive toy from a video, screenshot, or live reference, or compare an existing app against its reference to restore missing controls and behavior.
license: MIT
---

# Reference to web toy

Turn visible behavior into a runnable, editable web app. Start from the user's reference and existing project instructions/toolchain. No particular model, MCP service, framework, or sibling skill is required. You need reference access and a browser inspection/input tool; frame extraction helps with video. Use only assets the user may reuse. Reference access does not authorize publishing someone else's assets or code.

1. Read [reference analysis](references/reference-analysis.md). Inspect real frames and before/after states. Inventory objects, motion, every visible control, mode-specific options, collapsed content, and outputs outside the panel. Give each requirement evidence, expected input/result, and confidence. Mark unreadable or inferred details.
2. Implement one representative interaction before expanding the scene. Keep the existing framework when practical. For a new 3D toy, a browser renderer such as Three.js and procedural geometry may fit the brief. Time motion independently of rendered frame count and handle release/cancel events. Connect controls to real scene state.
3. Match the complete interaction inventory, including reset/pause, statistics, help, and options that change by mode. Preserve working behavior when changing layout. Do not infer exact physics, hidden features, or engine identity from appearance.
4. Read [runtime and delivery](references/runtime-and-delivery.md). In an actual browser, exercise each in-scope input and compare its resulting scene with the reference. Record source/build version, URL, viewport, input, and observed result. Inspect screenshots for clipping and motion over time for timing. Recheck affected behavior after changes; a counter alone is insufficient.
5. Deliver editable source, dependencies and license notices, launch instructions, tested interactions, and remaining approximations. External publication/transfer must stay within the user's authorized scope. Temporary local URLs need a reproducible restart method.

For static apps, the bundled verifier compares declared files, a loopback HTTP entry, and ZIP bytes. Requires Python 3.10+ with standard library only. Its PASS establishes file identity, not appearance or behavior. Declare runtime dependencies yourself; the helper does not discover them.

Run from the user's working project. Replace `SKILL_DIR` with the installed skill directory and quote paths containing spaces. Keep source assets and receipts in the working project.

```sh
python -X utf8 SKILL_DIR/scripts/verify_static_artifact.py --root ./toy-app --asset vendor/renderer.js --asset vendor/LICENSE.txt --url http://127.0.0.1:8000/ --zip ./toy-app.zip --out ./evidence/static-v1.json
python -B -X utf8 SKILL_DIR/scripts/test_verify_static_artifact.py -v
```

Replace assets and port with actual values. Create the receipt's parent and use a new receipt path. The helper reads local source/ZIP files, requests only loopback URLs without redirects or proxies, and writes only an explicitly requested new receipt. PASS without `--url` or `--zip` establishes neither comparison. It does not start a server or perform browser interactions.

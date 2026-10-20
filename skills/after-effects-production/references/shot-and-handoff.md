# Shot and handoff templates

Use these fields only where they matter to the request. Capture the answers in the working project's brief, not in a separate tool configuration.

## Shot plan

| Field | Record |
|---|---|
| Source range | Reference timestamps and available frames |
| Output range | Start/end frame at the requested FPS |
| Subject | Visible elements, order and movement direction |
| Camera | Framing, angle, translation, rotation or focal-length change |
| Type | Exact copy, line breaks, reveal timing and editable layer |
| Transition | Last state of this shot and first state of the next |
| AE controls | Composition, layers, properties, effects and expressions |
| Acceptance | Matching moments plus actual playback to inspect |
| Assumptions | What the reference does not establish |

For a 2D layout, position/scale/rotation may be sufficient. For parallax or a moving 3D camera, establish actual depth and camera behavior. Choose the method for the visible requirement rather than an assumed effect recipe.

## Editing guide

```text
Open: project.aep — tested AE version:
Start here: master composition:
Change copy: composition / layer:
Replace footage: project item / composition:
Change timing: shot markers and precomp ranges:
Global controls: controller / property / purpose:
Reveal helpers: disable Hide Shy Layers:
Dependencies: included media / fonts / plugins:
Preview: file / dimensions / FPS / duration:
Checked: reopened project / actual playback / audio:
Remaining differences:
```

Consult the current [Adobe After Effects documentation](https://helpx.adobe.com/after-effects/user-guide.html) for version-specific features. A documented AE capability does not establish support in a particular MCP bridge; test the actual route before relying on it.

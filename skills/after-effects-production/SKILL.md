---
name: after-effects-production
description: Build or revise motion graphics as an editable After Effects project with native text, clear composition structure, preview playback and a short editing guide. Use when a designer needs an .aep they can continue editing, or needs a video reference translated into an AE shot plan.
license: MIT
compatibility: Licensed Adobe After Effects and an authorized JSX, scripting or MCP execution route. Optional Designer Tools MCP and CEP companion are installed separately from the skill. Video frame extraction may use ffmpeg and ffprobe.
---

# After Effects production

Deliver an editable `.aep`, a playable preview and a short editing guide. Start from the user's actual project or brief. Keep the original and save a separate version before structural changes.

## Check the execution route

Confirm the installed AE version, open project and available scripting/bridge capability. Use the existing authorized adapter or AE's script execution workflow. The optional [Designer Tools MCP and CEP companion](https://github.com/Bum-Boo/designer-skills/blob/main/docs/mcp.md) can expose `ae_status`, `comp_list` and explicitly enabled `run_jsx`. Installing this skill alone does not install or register that connection. Check status before scripts; use native AE controls for project lifecycle and rendering. After uncertain execution, inspect AE and retained job evidence before retrying. If execution is unavailable, prepare a shot plan and source script, state that `.aep` generation is pending, and give the exact missing dependency.

## Turn a brief into editable controls

For a reference, use [the shot and handoff template](references/shot-and-handoff.md). Separate observed subject movement from camera movement; distinguish a zoom from camera translation. Identify shot boundaries, text changes, masks, audio events and the transition into the next shot. Mark inferred details.

Build one clear master composition. Group layers into precomps when they share an edit, repeated object or independent effect/matte boundary. Keep frequently changed text and media easy to reach. Use native text, shapes, properties and keyframes for the requested editable content. A single flattened movie inside an AEP does not satisfy editability.

Name compositions and layers by role. Put shot markers on the master timeline. Use Shy for technical helper layers and tell the recipient how to reveal them. Add controller layers only when they reduce repeated edits; document their targets. Comp count is not a quality metric.

## Work through a real preview

1. Implement a characteristic shot including its entry, principal change, settling and connection to the next cut.
2. Save and render a small preview. Compare matching moments with the reference and watch playback at the intended speed. Check direction, timing, type readability, masking and continuity across the cut.
3. Resolve observed differences before extending the technique to the whole sequence. Preserve source connections and expressions while simplifying the project.
4. Reopen the saved project in AE. Check the master comp, media links, expression errors, frame rate, duration, output settings and the actual text/media editing targets.
5. Render the requested preview; inspect first/last frames, cut boundaries and the densest text. Watch the entire preview and check audio when present. Report a partial review as partial.

Keep render job identifiers when an adapter supplies them. After a timeout, inspect the existing job and output before submitting another render. An accepted job is not a finished file.

## Handoff

Supply `.aep`, preview, required source assets and an editing guide with the master comp, text/media locations, controllers, Shy behavior, fonts/plugins and tested AE version. Keep licensed fonts/plugins as declared dependencies; do not redistribute them without permission. Collect or include permitted media so the recipient can reopen the project.

If only a plan, JSX or MP4 was produced, name that result accurately and leave native project acceptance open. This public skill is an integration-dependent workflow; it has no bundled end-to-end AE runtime test.

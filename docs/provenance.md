# Provenance

The public package adapts the repository owner's production workflows into standalone, machine-neutral skills. It includes original Blender and delivery helpers; private project records, source media and environment configuration are not distributed.

| Component | Public relationship |
|---|---|
| Blender production | Owner-authored synthetic scene builder and inspector with a rewritten, self-contained product workflow. No tutorial video, transcript, image or archive is bundled. |
| After Effects production | Rewritten production and editable-handoff instructions plus the owner-authored AE host adapted from their local bridge. A new narrow connection/panel is included; no Adobe SDK JavaScript, binaries, plugins or book excerpts are vendored. |
| Reference to web toy | Adapted from the owner's [existing MIT project](https://github.com/Bum-Boo/reference-to-web-toy); its copyright notice is retained. |
| Asset delivery | Owner-authored read-only inventory helper with a narrowed public handoff workflow. Private document cases and cloud/account configuration are excluded. |

The [Agent Skills format](https://agentskills.io/specification) and [Skills CLI](https://github.com/vercel-labs/skills) supply the packaging and installation conventions. This repository does not vendor the installer or represent itself as an official Adobe, Blender, OpenAI, Anthropic or Nous Research product.

General software and production concepts are described in the public instructions; no claim is made to inventing those concepts. Keep any included copyright notices when redistributing. Dependencies and assets supplied by users retain their own licenses.

The MCP runtime and companion use npm dependencies declared in `package.json` and locked in `package-lock.json`: MCP TypeScript SDK, ws and Zod. They remain separately licensed dependencies; their upstream copyright notices are distributed by npm. The CEP panel calls the host-provided API and does not bundle Adobe CSInterface.js.

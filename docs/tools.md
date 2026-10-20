# Bundled tools

Small production helpers travel with their skill directory. A skill describes the work and acceptance criteria; its tools perform repeatable operations. Installing a skill copies the included scripts and references together.

| Tool | What it does | Runtime |
|---|---|---|
| [Product scene builder](../skills/blender-production/scripts/product_scene.py) | Build an editable synthetic device from a JSON specification; save a scene and optionally render | Blender; tested 5.2.2 |
| [Saved scene inspector](../skills/blender-production/scripts/inspect_scene.py) | Check a freshly reopened scene and optionally render it again | Blender; tested 5.2.2 |
| [Delivery manifest](../skills/asset-delivery/scripts/delivery_manifest.py) | Read folder or ZIP contents, check hashes/CRC and compare a baseline | Python 3.12+ |
| [Static artifact verifier](../skills/reference-to-web-toy/scripts/verify_static_artifact.py) | Compare declared local files with a loopback-served entry and ZIP | Python 3.10+ |

Read each tool's skill before running it; that document specifies inputs, output paths and what a PASS does and does not establish. Python helpers use the standard library. No credential, hosted generation service or paid API is needed for these four tools. Blender itself must be installed separately.

The repository also has a maintainer package validator and tests. These support package checks rather than creative production, and are not installed as a separate user skill.

## Larger integrations

AE bridges, ComfyUI connections and other application services should have their own versioned installation and compatibility documentation. A future skill can depend on one, but should name the actual tool, check its connection and explain what remains possible without it. This collection currently bundles no AE bridge or ComfyUI connector. Application licenses, authentication and service installation remain separate from skill installation.

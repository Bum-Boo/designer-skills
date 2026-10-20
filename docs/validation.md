# Validation and limits

Public candidate: `0.1.0-alpha.1`, checked on 2026-10-21. This is a preview package. A tool test, a successful installation and a successful creative task are separate observations.

## Observed locally

| Area | Actual check | Result and scope |
|---|---|---|
| Package discovery | Skills CLI 1.7.4, local source, `--list` | Four skill directories discovered and their descriptions parsed |
| Single installation | `--skill blender-production -a codex --copy -y`, isolated project | One selected package installed; no global skill replacement |
| Collection installation | `--skill '*' -a codex claude-code hermes-agent --copy -y`, isolated project | Four packages copied to each selected agent's project destination |
| Installed bytes | All four packages at all three destinations, plus single-selection directory | 12 package comparisons matched; the single installation contained only the chosen skill |
| Blender input checks | Blender 5.2.2, bundled `validate_specs.py` | 17 invalid specifications rejected |
| Blender default example | RTX 4060 / OptiX, 1280 × 1024, 48 samples | Scene built, saved, reopened in a new process and rendered again; inspector passed |
| Blender variation | CPU, 180 mm width, changed color/labels, 640 × 512, 8 samples | Scene built, rendered and reopened; inspector passed |
| Existing-output boundary | Builder run against the existing output | Nonzero refusal and unchanged `.blend` SHA-256 |
| Blender pixels | Actual default and variation PNGs viewed by a separate image reviewer | Whole devices in frame, distinct controls, readable main labels, coherent highlights/shadows, no obvious missing-texture pink. Tiny variant sublabel was not reliably readable |
| Asset helper | `scripts/test_delivery_manifest.py` | Seven tests passed, one skipped: identity, changes, invalid/corrupt DEFLATE archives, unsafe names and UTF-16 baseline with Unicode. Host permissions prevented the actual directory-symlink case |
| Static artifact helper | `scripts/test_verify_static_artifact.py` | Ten tests passed: local/HTTP/ZIP identity, stale content, changes, path/loopback boundaries and invalid DEFLATE failure receipts |
| PNG privacy regression | Original Blender PNG flagged, builder stamps disabled, new default render and fresh-process render | Public PNG contains no File/Date/Time stamp. Four metadata tests passed, including compressed/international text and corrupt chunks. The regenerated image is reviewed separately because its pixels differ from the first render |

Python helper tests ran on Windows with Python 3.13.3. Skills CLI ran with a temporary Node.js 22.20.0 tool environment; the machine's default Node.js installation was not changed. Linux CI is supplied but was not executed on GitHub during local preparation. macOS runtime and the actual symlink-ancestor case remain untested; the helper resolves ancestor aliases and rejects linked targets/entries by design.

## Separate checks

- `python scripts/validate.py` checks the catalog, simple frontmatter constraints, Python syntax, local Markdown links, bundled license files, language links, version and command-block parity, and common private-path/credential patterns in text and PNG text chunks. It is not a full security or legal audit.
- Installer destinations are checked against the source package. File installation does not prove that every target agent loads or follows the instructions.
- Natural description-based selection requires a fresh agent conversation and observed reads of the installed SKILL.md. Installation alone is not counted as selection.

## Description-based selection

Twelve fresh Codex CLI 0.159.0-alpha.9 intake conversations exercised two relevant requests and one nearby out-of-scope request per skill. All eight relevant requests read the local installed candidate SKILL.md; all four negative cases avoided their local target. Examples included editable Blender/AE projects versus writing marketing copy or MP4-only trimming, interactive-reference recreation versus video summarization, and asset comparison versus deleting Downloads.

These are selection checks, not production-task checks. Related global skills were also read in some AE/reference cases, so strict isolation is not established. The recorded versions precede subsequent command-path and privacy edits; the four descriptions are unchanged. The requested model was `gpt-6.1-sol` with medium reasoning; the resolved model identifier was not exposed in the observed event stream. No automatic-selection claim is made for Claude Code or Hermes.

## Not established by these checks

The public AE workflow has not produced and reopened a new AEP in this validation session. It requires the recipient's authorized execution route. The web workflow's helper tests do not establish the quality of a newly recreated toy. A delivery manifest does not establish visual quality, rights to assets or recipient access. Third-party agent runtimes, cloud services, other GPUs and other Blender versions remain integration-dependent.

The Blender template does not reconstruct an arbitrary photographed product, and this package does not include verified AI mesh cleanup, toon shading or animation automation. Confirm a new production task against its actual reference and output.

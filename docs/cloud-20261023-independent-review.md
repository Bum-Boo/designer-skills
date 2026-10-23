# Independent review: bundled helpers and MCP adapters (cloud, 2026-10-23)

Scope: one bounded review from a new user's perspective. No production script, skill instruction, approval/security policy, installed skill, MCP configuration, Blender/Adobe setting or deployment was changed. Only this document and the synthetic harnesses under `review/` were added.

## Source and environment

- Source HEAD reviewed: `30a2bbfc2eecc7857711b69b283b54ceb9c5572a` ("Mark MCP launcher executable on POSIX"), identical to `origin/main` at review time.
- Linux container, Node v22.22.0 (CI pins 22.20.0), Python 3.13.16. `npm ci --ignore-scripts` from the lockfile.
- **Not available:** Blender, After Effects, CEP, Windows/macOS. Every Blender/AE result below comes from a missing executable, a `/bin/sh` stub or mock WebSockets. Nothing here verifies native AE/Blender execution, panel loading, UI or visual quality.

## Existing tests (all passed)

```sh
npm ci --ignore-scripts
npm test                                                        # 16/16 pass
python3 scripts/validate.py                                     # passed, 0 errors
python3 scripts/test_validate.py                                # 4 OK
python3 skills/asset-delivery/scripts/test_delivery_manifest.py -v      # 8 OK (directory-symlink case ran on Linux)
python3 skills/reference-to-web-toy/scripts/test_verify_static_artifact.py  # 10 OK
```

Packaging: `npm pack --dry-run` lists 53 files including `mcp/server.mjs`, the four panel files and the tests; `review/` is outside `files` and is not packed. `install-panel.mjs` dry-run printed the target, refused with no `--destination` on Linux (exit 1), and refused a second `--apply` into an existing target (exit 1).

## Synthetic reproductions

All three harnesses create a fresh temporary directory, call only documented tools or the documented bridge API, and delete it afterward. Each prints one JSON line per case (`id`, `observed`, `expectation`).

```sh
node review/repro_mcp_boundaries.mjs     # real stdio MCP server; ~27 s (includes a 20 s timeout case)
python3 -I review/repro_python_helpers.py
node review/repro_ae_protocol.mjs        # mock CEP sockets only
```

## Findings

### Verified bugs

1. **Process timeout is not enforced when the executable is a wrapper that leaves a grandchild holding stdout/stderr; the grandchild also survives timeout, cancellation and server close.**
   `Runtime.run` stops with a single `child.kill()` (SIGTERM to the direct child, `mcp/runtime.mjs:56`) and only settles on the child's `close` event (`mcp/runtime.mjs:67`), which waits for all stdio pipes to close. `Runtime.close` also signals only direct children (`mcp/runtime.mjs:151`). No process group kill and no SIGKILL escalation exist.
   Measured (`status-probe-timeout-with-grandchild`): `--python` pointed at a `/bin/sh` script that runs a 20 s child without `exec`. `designer_tools_status` has a 15 s probe timeout (`mcp/runtime.mjs:83`). The call returned after **20.0 s**, i.e. only when the grandchild finished. The "timed out" message was correct but late. After an aborted call and after `client.close()`, the grandchild was **still running** (`sleepersAfterAbort: 1`, `sleepersAfterServerClose: 1`).
   Impact: with a launcher that forks rather than execs (for example some Flatpak/py-launcher style wrappers; not tested here), a hung Blender job could exceed the documented 10-minute bound without limit and keep running after `docs/mcp.md` says "closing the server terminates its owned background children". The same applies to a direct child that ignores SIGTERM. With a direct `blender`/`python` executable, the existing test shows the timeout works.

2. **`verify_static_artifact.py --baseline-receipt` crashes on a JSON value that is not an object.** `baseline.get(...)` (`skills/reference-to-web-toy/scripts/verify_static_artifact.py:134`) raises `AttributeError`, which is not in the caught list at `:150`. Measured for `[]`, `"PASS"` and `1`: Python traceback, exit 1, empty stdout, and **no receipt written** even with `--out`. It does not report success, but it breaks the "always returns a FAIL receipt" pattern for malformed input. CLI only: the MCP `verify_web_artifact` tool does not expose this option.

### Hardening gaps / incorrect-success risks with a contrived precondition

3. **Blender availability and success are inferred from exit code 0 only.** `status()` reports `available: true` for any executable that exits 0 on `--version`, even with empty version text (`mcp/runtime.mjs:84`). Measured: `status-exit0-stub-counts-as-blender` → `{"available":true,"version":""}`. `buildProduct`/`inspectBlend` then trust exit 0 plus whatever `build.json`/`inspection.json` exists in the output directory (`mcp/runtime.mjs:134-135`, `:146-147`). Measured: with a stub `--blender` that exits 0 and an output directory that already contains an old `build.json`, `blender_create_product` returned **isError=false with the stale receipt** (`create-product-stub-returns-stale-receipt`). The real builder refuses non-empty directories (`product_scene.py:145`, `inspect_scene.py:20`) and real Blender returns 1 on script exceptions via `--python-exit-code 1`, so this needs a wrong or broken executable. Node does not check that the directory is new/empty, or that the receipt's `blender_version` is present, before reporting success.

### Reporting semantics a caller must handle (intended or documented, measured)

4. `asset_compare` returns **isError=false on a mismatch**. The result carries `comparison.match: false` (`server.mjs:183` only maps `ok===false` or `status==='FAIL'`). In contrast, a `verify_web_artifact` FAIL is isError=true. An agent that only reads isError would treat a mismatch as success. The description says it "Returns match/missing/extra/changed", so this is a documented result, not a failed call.
5. `ae_status` without a connected panel returns `{ok:true, native:null, bridge:{connected:false}}` (`mcp/ae/bridge.mjs:154`), so MCP isError=false. The tool description says "Read connected After Effects host/project status", but the response only shows bridge state. `comp_list` without a panel correctly fails with `AE_NOT_CONNECTED`.
6. A native status result is only checked for `ok: boolean` (`bridge.mjs:91`). A bare `{ok:true}` file is reported as a successful status with no `version`/`project` (`status-minimal-native-result`). The real host always writes those fields (`aebridge.jsx:126-142`), so this only matters for a non-standard host.
7. `--baseline-receipt` differences are descriptive: script/asset/entry changes still give `status: PASS` and exit 0 (`verify-baseline-differs-still-pass`). This matches the receipt's `meaning` field and the Korean reference doc.
8. Folder↔ZIP comparison is by content only: `archive_sha256`, `kind` and empty directories are not compared (`compare-zip-vs-folder-content-only` → match=true).

### Path/workspace boundary (measured, behaved as documented)

Via MCP: `../outside`, an absolute outside path, an in-workspace symlink to outside (directory and child file), and a dangling outside symlink (and a path under it) were all refused. Note that the dangling case is refused with a raw `ENOENT ... realpath` message, not the "escapes" message. A web asset symlink that resolves outside `root` produced a FAIL receipt.

Static limitations:
- An in-workspace **hard link** to an outside file is read and hashed (`inventory-hardlink-to-outside-file`). Paths cannot detect this, and `delivery_manifest.py` does not check `st_nlink`.
- Checks are TOCTOU: Node resolves the path, then Python/Blender reopen it. The docs already say the path checks are not a sandbox.
- The comment at `mcp/runtime.mjs:107` says the verifier "rejects child links". It actually accepts in-root symlinks and rejects only links that resolve outside root (`verify-asset-symlink-inside-root` → PASS). The behavior is reasonable; only the comment is inaccurate.

### Archive / baseline mismatch detection (measured)

`delivery_manifest.py` refused every malformed baseline tried with exit 2 / `status:error`: non-object, boolean `bytes`, inconsistent count, case-duplicate paths and traversal. It also refused a case-colliding ZIP and a CRC-corrupted stored ZIP. The verifier gave FAIL for the CRC-corrupted ZIP. No baseline/archive mismatch was reported as a match.

### AE bridge protocol (mock only)

Handshake: the first valid token → `connected`, a second valid panel → close 4009, a wrong token → close 4003. During pending work, each of these quarantined the bridge, wrote `quarantine.json`, blocked the next call with `BRIDGE_QUARANTINED`, and **never reported success**: non-JSON, an oversized frame (>64 KiB), a wrong reply id followed by silence, `ok:true` with no result file, and a result file that is not an object. AE disconnects during work are therefore reported as failures.

Static limitations, not reproducible without AE:
- A `run_jsx` that throws returns `JSX_ERROR` without quarantine. The host closes the Undo Group in `finally` (`aebridge.jsx:937-946`), but edits made before the throw stay applied. A failure result does not mean "no change".
- The panel sends the token to whatever listens on `127.0.0.1:<port>` (`connection.js:204-205`), and the server never proves its identity. The host executes any `run_jsx` job it receives (`aebridge.jsx:959`): the `--allow-ae-scripts` gate exists only in the Node server. A local process that binds the port first would receive the token and could drive native scripts. This is within the local-user threat model, but worth stating.
- An existing job directory is accepted with its current mode. Measured: 0777 was accepted (`existing-job-directory-mode`); mode 0700 applies only when the bridge creates the directory (`bridge.mjs:15`). The host `eval`s argument files (`aebridge.jsx:52`), so a shared-writable job directory matters.
- The MCP server does not forward request cancellation to Blender, Python or AE. This is documented in `docs/mcp.md`; the cancellation case above confirms it for a child process.

## Remaining actual-app checks (not done here)

- Real Blender 4.5+/5.x: create/inspect via MCP, the non-empty output refusal, timeout/close with the user's actual launcher (direct binary vs wrapper), and whether that launcher forks.
- Real AE + CEP panel: loading under the declared AEFT25+/CSXS12, handshake, `ae_status`/`comp_list`, `run_jsx` with a throw after a partial edit (check the project state and the Undo history), and a disconnect mid-call followed by inspection of the quarantine evidence.
- Windows/macOS behavior of the timeout/close path (no POSIX process groups on Windows; py launcher).
- Visual quality of any render or web toy. Nothing here inspected pixels or browser interaction.

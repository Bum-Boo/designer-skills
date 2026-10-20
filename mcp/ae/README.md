# Local AE companion

This directory supplies a local connection, not a renderer or an AI provider. Node 22+ and the repository's `ws` dependency are required. Licensed After Effects with CEP and script file/network access is a separate prerequisite. No Adobe SDK JavaScript is vendored; the panel uses the host's ambient `window.__adobe_cep__.evalScript`.

`createAeBridge({port, token, jobDirectory, allowScripts})` is asynchronous and returns `status()`, `call(method,args)`, and asynchronous `close()`. `port` defaults to 47620; zero selects a free port. `status()` reports the actual loopback port and connection/queue state, never the token. Supply a random session token of at least 32 characters and an absolute, private job directory. Keep this token local; it grants access to the bridge. The caller owns server startup and cleanup.

Methods are `ae_status` and `comp_list` with empty arguments, and `run_jsx` with `{code,args?,undoLabel?}`. Scripts require `allowScripts:true`; they execute with AE's permissions and are not sandboxed. Code is an ExtendScript function body, such as `return app.version;`. The existing native host wraps it in an Undo Group; do not use that call to open/close projects or render. Use native AE lifecycle controls separately.

Calls are serialized. A native timeout, disconnect during work, invalid result or uncertain dispatch quarantines the bridge and keeps evidence under the job directory. Later calls are blocked, including after recreation with that directory. Unmatched argument files from an interrupted prior process also block fresh native calls. A timeout does not cancel AE. Inspect AE and argument/result files, resolve any late execution, close the bridge, then deliberately archive the quarantine directory and use a fresh job directory. Never automatically retry an uncertain script.

Install from the repository root:

```sh
node mcp/ae/install-panel.mjs
node mcp/ae/install-panel.mjs --destination ./panel-install-fixture
node mcp/ae/install-panel.mjs --apply
```

Default is dry-run. `--destination` names an extensions parent directory; the installer creates `org.bumboo.designerskills.ae` beneath it and refuses overwrite. Platform defaults are the user's Windows/macOS CEP extensions directories. Installation copies files only: it does not change unsigned CEP/developer settings, AE preferences, or MCP registration. An unsigned developer panel requires an explicitly configured developer environment or signing; this installer does not make an unsigned panel load automatically.

Open the **Designer skills AE** extension in AE and enter the actual local port/session token. The panel does not persist the token or reconnect automatically. Manifest host/runtime declarations are AEFT25+ and CSXS12; these are declarations, not a tested compatibility range.

```sh
node --test mcp/ae/*.test.mjs
```

Tests use mock CEP sockets and temporary job files. They verify transport/authentication/serialization/quarantine/installation behavior, not actual native AE execution. The bundled owned host implements additional commands internally; this adapter and connection page expose only the three documented methods. No media, Premiere, canvas, provider integration, or global configuration is included.

# Designer Tools MCP

The repository includes a local stdio MCP server and an optional After Effects CEP connection. Skills describe the production workflow; the MCP server exposes the bundled tools to an agent. Installing skills alone does not register this server.

## Install the server

Requires Node.js 22.20+ and Git. Python 3.12+ is needed for file checks; Blender 4.5+ with Cycles is needed for the Blender tools. Neither application is installed by npm. Choose the executables explicitly if they are not on your MCP client's PATH.

```bash
git clone https://github.com/Bum-Boo/designer-skills.git
cd designer-skills
npm ci --ignore-scripts
node mcp/server.mjs --help
```

Register the following **command and arguments** in your client's local stdio MCP configuration. Replace both paths with absolute paths on your machine. Use forward slashes in Windows JSON, for example `D:/design/project`. This example grants access only to the selected working project; use a separate server entry for another project.

```json
{
  "mcpServers": {
    "designer-tools": {
      "command": "node",
      "args": ["/absolute/designer-skills/mcp/server.mjs", "--workspace", "/absolute/working-project"]
    }
  }
}
```

This is the common Claude-style JSON shape. [JSON example](../examples/mcp.json) and [Codex TOML example](../examples/codex.toml) are templates, not changes to existing settings. For Hermes, enter the same command and args in its stdio MCP configuration; its registration and live skill discovery have not been tested here. Restart your MCP client and ask for `designer_tools_status`. Python/Blender being absent is reported individually and does not prevent file-independent tools from being listed.

An optional Git-package launcher avoids maintaining a clone for the basic server:

```bash
npx --yes --package=git+https://github.com/Bum-Boo/designer-skills.git designer-tools-mcp --workspace /absolute/working-project
```

In JSON, use `command: "npx"` and each argument as a separate array element. On Windows, prefer the clone plus `node` route: clients that cannot launch npm shims need `npx.cmd` or their documented command-shell wrapper. Use a Git commit suffix (`.git#COMMIT`) to pin an approved version. The clone plus `npm ci` route uses the checked-in dependency lockfile and is preferred for reproducible installations. Git-package dependency resolution can change; there is no npm registry release. Use a clone for installing the optional AE panel. Windows tarball and public Git-package installs both passed real MCP initialization and inventory calls. The POSIX symlink and npm bin launcher passed [Ubuntu CI](https://github.com/Bum-Boo/designer-skills/actions/runs/39494334654).

## Tools

| Tool | Behavior |
|---|---|
| `designer_tools_status` | Probe Python/Blender versions and local AE bridge state |
| `asset_inventory` | Read a folder/ZIP and return counts and SHA-256 |
| `asset_compare` | Compare approved folder/ZIP with delivery; report missing/extra/changed |
| `verify_web_artifact` | Check declared files, optional loopback HTTP bytes and ZIP; browser interaction needs separate testing |
| `blender_create_product` | Generate the synthetic device example as editable `.blend`; optional PNG |
| `blender_inspect_scene` | Open a saved scene in a fresh background process; structural check and optional render |
| `ae_status` | Optional: query the connected AE host/project |
| `comp_list` | Optional: list native AE compositions |
| `run_jsx` | Optional, explicit opt-in: execute an ExtendScript function body with AE's full privileges |

Paths in the first six tools are relative to `--workspace`, or absolute paths inside it. File operations reject traversal and resolved paths outside that root. Blender writes to a new empty output directory and runs serially, with automatic script execution disabled. A `.blend` may reference external media/libraries, and application processes retain OS permissions: the path checks are not an application sandbox. Use trusted `.blend` inputs. Receipts may contain absolute paths; review them before sharing.

For `blender_create_product.spec`, use all fields from [example-product.json](../skills/blender-production/assets/example-product.json). The template builds this specific synthetic device; it does not infer arbitrary geometry from images. Output directories must be empty. Blender operations allow up to 10 minutes; increase your client's tool timeout accordingly. File checks allow 2 minutes and capture at most 4 MiB of stdout. On failure or timeout, inspect partial output before choosing a new directory. Client cancellation alone does not promise native work has stopped. On timeout, output overflow or server close, POSIX launches terminate their owned process group and escalate to SIGKILL after 500 ms. A wrapper that creates a separate session can escape that group. Windows currently terminates only the direct process; descendant cleanup is not guaranteed. Forcibly killing the server (SIGKILL), including its process group, can leave tool processes running. Failed calls stop waiting for inherited pipes after the cleanup grace, so inspect partial output and native processes before retrying.

## Optional After Effects connection

The bundled companion requires licensed AE with CEP support, an unsigned developer-panel environment or signed panel, and AE script file/network access. The manifest declares AEFT25+/CSXS12; native compatibility is not yet verified. The installer does not enable developer mode or change AE preferences. Check your installed Adobe documentation/settings before enabling those options.

1. From the cloned repository, preview the destination with `node mcp/ae/install-panel.mjs`. Apply with `node mcp/ae/install-panel.mjs --apply`. The installer creates its own `org.bumboo.designerskills.ae` directory and refuses overwrite.
2. Generate a private token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it local. Add `--ae-port 47620 --ae-jobs /absolute/private/ae-jobs` to your MCP server arguments and set `DESIGNER_AE_TOKEN` in its environment to that token. Use an absolute private job directory; it stores script arguments and results. The server also accepts `--ae-token` for local diagnostics, but environment configuration avoids putting secrets in process arguments.
3. Open **Designer skills AE** in AE's extensions menu. Enter port 47620 and the same token, then connect. The panel does not persist the token. Confirm `designer_tools_status`, then `ae_status` and `comp_list`.
4. To author native layers, explicitly add `--allow-ae-scripts` to expose `run_jsx`. Its `code` is a function body, for example `return app.version;`. It can change the active project and read/write files with AE's permissions. The host wraps scripts in an Undo Group; opening/closing projects or rendering through this call is unsupported. Use native AE lifecycle/render controls and inspect saved outputs separately.

The AE WebSocket binds only to 127.0.0.1 and authenticates its first message. Native calls serialize. A timeout, interrupted process, disconnect during work or invalid result blocks later native calls and retains evidence; AE may still finish an already submitted call. Do not retry automatically. Inspect AE and the private job files, close the server, archive the resolved evidence deliberately and use a fresh job directory. [Companion details](../mcp/ae/README.md).

## Validation and removal

```bash
npm test
python scripts/validate.py
```

Tests cover actual MCP stdio initialization/tool calls, real Python helpers, path bounds, process failures and mock CEP authentication/serialization/recovery, plus installer fixtures. They do not certify an AE/CEP session, native rendering or every agent's registration UI. See [observed validation](validation.md).

Remove only the MCP entry you added, close that server and remove its dedicated panel directory if installed. Archive private AE job evidence before deleting it. Installing this package creates no background service and changes no global agent settings. The implementation uses the pinned [MCP TypeScript SDK v1 API](https://ts.sdk.modelcontextprotocol.io/server); stdout carries only MCP messages, as required by the [stdio transport specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/draft/basic/transports/stdio.mdx).

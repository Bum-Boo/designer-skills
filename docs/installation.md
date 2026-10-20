# Installation

Use the [Skills CLI installation reference](https://github.com/vercel-labs/skills/blob/main/docs/commands.md#skills-add) and [agent path reference](https://github.com/vercel-labs/skills/blob/main/docs/agents.md) for current options. CLI installation requires Node.js 22.20 or later. Python is needed only by the included Python tools, and Blender runs its scripts through its own Python.

```bash
# Browse without installing.
npx skills@latest add Bum-Boo/designer-skills --list

# Choose skills and agents.
npx skills@latest add Bum-Boo/designer-skills

# Install just one skill to a project.
npx skills@latest add Bum-Boo/designer-skills --skill blender-production -a codex

# Install this collection for a Hermes user.
npx skills@latest add Bum-Boo/designer-skills --skill '*' -a hermes-agent -g
```

For local candidate testing, replace `Bum-Boo/designer-skills` with the local repository path. Use space-separated `--skill NAME`, as shown. The Skills CLI installs skill files. Install the optional MCP server and AE panel separately; it does not install applications or credentials. Avoid overwriting a modified skill with the same name without reviewing the differences.

## Manual installation

Copy selected directories from `skills/` into the destination below. Include the whole directory, its references/scripts and bundled `LICENSE`. Global paths shown use `~` for your home; on Windows use the corresponding user folder. Agent-specific profile settings can override global defaults, especially for Hermes profiles.

| Agent | Project destination | User destination |
|---|---|---|
| Codex | `.agents/skills/` | `~/.agents/skills/` |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Hermes Agent | `.hermes/skills/` | `~/.hermes/skills/` |

Check your agent's own discovery behavior before assuming project-local or profile-specific files are loaded. CLI support for a path is separate from verifying that your running agent uses it.

Start a new conversation if your agent caches its skill list. Ask it to use the installed skill by name. If it cannot execute the required app, it should state the missing capability and deliver only the preparation it actually completed.

## Updating and removal

For CLI-managed installations, use the CLI's `skills check`, `skills update` and `skills remove` commands. For a manual copy, compare with the new source and keep local modifications before replacing or removing that copied directory. Installation does not change agent settings or create background services. Register the optional MCP command explicitly in your client.

## Optional MCP tools

The [MCP setup guide](mcp.md) includes clone/install commands, JSON and Codex TOML examples, executable selection, working-project paths, the optional AE panel and removal instructions. The server is distributed from this Git repository; no npm registry release is needed.

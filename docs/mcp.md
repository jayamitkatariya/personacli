# Persona MCP Server

Persona exposes a **Model Context Protocol (MCP)** server so any MCP client — Claude Code, Hermes Agent, Cursor, Windsurf, opencode, etc. — can read and write your workspace directly.

It reuses the same sandboxed tools Persona's own AI uses (`src/server/tools.ts`, `src/mcp/server.ts`), so every client sees the same 15 tools.

---

## Transports

| Transport | How | When to use |
|---|---|---|
| **stdio** (local) | `persona mcp` speaks JSON-RPC over stdin/stdout | **Recommended** for Claude Code, Hermes, Cursor, Windsurf, opencode, any local client |
| **Streamable HTTP** | `POST /mcp` / `POST /api/mcp` on the running Persona server (`http://127.0.0.1:4321/mcp`) | For remote or HTTP-only clients |

Both expose the same tools/resources/prompts. stdio needs no running server; HTTP needs `persona` running.

---

## Quick start

### 1. Ensure Persona is configured

Run `persona` once and pick a workspace (default `~/Persona`). The workspace path is stored in `~/.persona/config.json` — the MCP server reads it directly.

```sh
persona
persona doctor   # should show Workspace: /Users/you/Persona
```

### 2. Add Persona to your MCP client

**Claude Code:**

```sh
claude mcp add persona -- persona mcp
# or, without a global install:
claude mcp add persona -- npx -y persona mcp
```

Or in `.mcp.json` / `~/.claude.json`:

```json
{
  "mcpServers": {
    "persona": {
      "command": "persona",
      "args": ["mcp"]
    }
  }
}
```

Verify:

```sh
claude mcp list
claude mcp get persona
```

**Hermes / Cursor / Windsurf / opencode / generic MCP client:**

```json
{
  "mcpServers": {
    "persona": {
      "command": "persona",
      "args": ["mcp"]
    }
  }
}
```

Alternative via `npx` (no global install):

```json
{
  "mcpServers": {
    "persona": {
      "command": "npx",
      "args": ["-y", "persona", "mcp"]
    }
  }
}
```

Or direct binary (after `npm install -g .`):

```json
{
  "mcpServers": {
    "persona": {
      "command": "persona-mcp"
    }
  }
}
```

**HTTP (any client that supports Streamable HTTP):**

1. Start Persona: `persona` (server at `http://127.0.0.1:4321`)
2. Add:
```json
{
  "mcpServers": {
    "persona": {
      "type": "http",
      "url": "http://127.0.0.1:4321/mcp"
    }
  }
}
```
Alt URL: `http://127.0.0.1:4321/api/mcp` is identical.

Discovery without MCP handshake: `curl http://127.0.0.1:4321/api/mcp/info`

---

## Tools (15)

All file paths are **workspace-relative** (`Notes/Welcome.md`, `Projects/foo/PRD.md`) and sandboxed to the workspace root (no `..` escapes, no `.persona` writes).

| Tool | Description |
|---|---|
| `get_workspace_info` | Current workspace path + config |
| `list_folder` | List files/folders under a folder (flattened tree). Use `path=""` for workspace root |
| `read_note` | Read a note/text file |
| `create_note` | Create new Markdown note (fails if exists) |
| `write_note` | Overwrite or create a note |
| `append_note` | Append Markdown to a note (creates if missing) |
| `create_folder` | Create a folder |
| `move_file` | Move file/folder to another folder (`target=""` = workspace root) |
| `rename_file` | Rename file/folder |
| `delete_file` | Delete file/folder recursively |
| `list_tasks` | List every task with id/status/priority/due/project |
| `create_task` | Create task (natural-language due: `tomorrow`, `next week`) |
| `update_task` | Update task by id (status `todo`/`done`, etc.) |
| `delete_task` | Delete task by id |
| `search` | Fuzzy + content + semantic search across files and tasks |

Destructive tools (`write_note`, `move_file`, `rename_file`, `delete_file`, `update_task`, `delete_task`) are annotated `destructiveHint:true`; clients that respect it should confirm.

## Resources

- `persona://workspace` — file tree as JSON
- `persona://file/{+path}` — individual file content, e.g. `persona://file/Notes/Welcome.md`

## Prompts

- `triage-tasks` — review open tasks for wrong priorities, missing dues, stale/duplicates

---

## Security notes

- Same sandbox as the app: `resolveSafe()` prevents escapes (`src/server/fs.ts:34`), `.persona` metadata is blocked (`src/mcp/server.ts:50`).
- No auth — the MCP server is local-only (stdio) or bound to `127.0.0.1`. Don't expose `/mcp` publicly.
- API keys stay in `~/.persona/config.json` / macOS Keychain; MCP tools never expose them.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Workspace not configured` | Run `persona`, pick a workspace, or set `~/.persona/config.json` `workspace` |
| `persona mcp` hangs / no output | That's correct — MCP speaks over stdin/stdout. Check with `persona mcp --help` |
| `persona: command not found` in MCP client | Use full path: `which persona` or use `npx -y persona mcp` |
| Search returns no matches | Keyword index rebuilds on first MCP `search` call — retry after 1s |
| `Resource persona://file/... not found` | Ensure path is workspace-relative and file exists (`list_folder` first) |

Test directly:

```sh
persona mcp --help
HOME=$PWD/.testhome persona mcp   # uses throwaway workspace at $PWD/.testhome/.persona
```

E2E test:

```sh
npm run build
HOME=$PWD/.testhome node scripts/mcp-test.mjs
# or via HTTP (needs server):
HOME=$PWD/.testhome PORT=47832 node dist/server/index.js &
node scripts/mcp-http-test.mjs
```

---

## For Hermes contributors

Hermes already speaks MCP. Add Persona in `hermes.config.json`:

```json
{ "mcpServers": { "persona": { "command": "persona", "args": ["mcp"] } } }
```

Hermes will then be able to `read_note`, `search`, `create_task`, etc. to act on the user's local files without custom wiring. Use `list_folder` once (it returns the flattened tree) then `read_note`.

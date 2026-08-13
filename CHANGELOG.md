# Changelog

All notable changes to Persona are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-13

### Added

- **Sidebar modules** — Focus, Journal, Today's Stuff, and Agents can now be
  toggled on/off in **Settings → Modules**. Enabled modules appear in the
  sidebar; disabled ones stay reachable from ⌘K.
- **Journal module** — a quick-capture box in the sidebar appends a line to
  today's note (`Notes/YYYY-MM-DD.md`) without opening the editor.
- **Background agents** — run multi-step AI work without holding a chat open.
  New Agents view with queued/running/done/failed/cancelled states, live tool
  progress, and cancel/retry/delete. Runs persist to `.persona/agents/` as JSON.
- **Note importers** — import Obsidian, Bear, Roam, Notion, and plain folders
  from **Settings → Import**. Imports land under `Imported/<source>/` and never
  overwrite existing notes. Wiki-links, Bear tags, Roam JSON blocks, and Notion
  CSV/resources are converted on the way in.

### Changed

- The AI tool loop was extracted into a shared `runAgenticLoop` so interactive
  chat and background agents use the exact same tool execution path.

### Fixed

- Background agent runs left `running` by a server restart are now marked
  `failed` on next startup instead of staying stuck.

## [0.1.0] - 2026-08-12

Initial release.

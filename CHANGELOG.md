# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-06-01

### Added

- **Public extension registration for consumers.** `createMemorySystem` now takes
  an optional second argument, `{ extensions?: Extension[] }`, so a project that
  uses agent-memory as a dependency can register its own extensions alongside the
  built-in ones — same lifecycle (`install` / `uninstall` / `load` / `status`),
  no need to edit the library.
- **Public extension-authoring types** re-exported from the package entry point:
  `Extension`, `ExtensionTool`, `ExtensionColumn`, `ExtensionSchema`,
  `ExtensionKnowledgeType`, `ExtensionContext`, `ExtensionDB`, `MemoryAPI`,
  `Logger`, `SearchFilters`, `MemorySearchHit` — so consumers can define
  extensions and tool handlers in a fully typed way.
- `CreateMemoryOptions` interface for the new options argument.

### Changed

- `installExtensionByName` / `uninstallExtensionByName` now keep the in-process
  loaded-extension set in sync, so a freshly installed extension's tools are
  dispatchable immediately — no second `start()` required.

### Notes

- Built-in and consumer extensions are merged into one list; a **name collision
  throws** (a consumer cannot silently shadow a built-in extension).
- Consumer-defined extensions are available through the **library API only** —
  the `agent-memory` CLI builds the system without them (it has no way to know
  them). Their tools run in the consumer's process via the dispatch map.
- Backward compatible: calling `createMemorySystem(overrides)` without the second
  argument behaves exactly as in 0.2.0.

## [0.2.0] — 2026-06-01

### Added

- **Extension system** — a plugin layer that adds domain-specific data and tools
  without changing the core schema. Each extension gets:
  - its own SQLite table (`<name>_meta`, with `FOREIGN KEY (entry_id) REFERENCES
    knowledge(id) ON DELETE CASCADE`),
  - its own `ext.<name>` frontmatter namespace,
  - its own knowledge types (resolved through a runtime registry),
  - its own tools, dispatched from the CLI as `agent-memory <tool> --flags`.
- **Runtime knowledge-type registry** (`src/shared/knowledge-types.ts`) — extensions
  register their own `knowledge.type` values (directory, v1 mapping, ID prefix)
  at install/startup instead of being limited to the built-in closed set.
- **Extension CLI commands** — `extensions list | install <name> | uninstall <name>
  | status <name>`.
- **Core extension API** on `MemorySystem` — `setExtensionData` / `getExtensionData`
  (read/write an entry's `ext.<name>` block), plus `installExtensionByName`,
  `uninstallExtensionByName`, `listExtensions`, `extensionStatus`,
  `getLoadedExtensions`.
- **`searchIndex.extensionDb()`** — a scoped, synchronous DB accessor (run/get/all)
  over the project store's connection, so extension tables share `foreign_keys=ON`
  and CASCADE fires correctly.
- **Reference extension** (`src/extensions/examples/bookmark.ts`) validating the
  full install → use → forget (CASCADE) → uninstall lifecycle end to end.
- Documentation: extension system documented in `README.md` and `CLAUDE.md`.

### Changed

- `MemoryStoreInput.type` and `KnowledgeEntry.type` widened to
  `KnowledgeType | (string & {})` so extensions can use their own registered
  types while built-in types keep autocomplete. Backward compatible.
- Markdown parsing/serialization moved to `src/shared/markdown.ts` so every module
  can use it without a cross-module import; `src/memory/parser.ts` re-exports it
  for compatibility.

### Fixed

- `forget()` now removes the v2-lite `knowledge` row (and its tags/connections),
  not just the v1 `memories` row — so deleting an entry correctly cascades to any
  extension `<ext>_meta` table.
- `rebuild-index` no longer wipes extension tables: `resetAll()` suppresses foreign
  keys during the knowledge wipe, and `rebuildIndex` reconciles each extension
  table afterward (pruning only rows orphaned by a deleted Markdown file).

## [0.1.0]

### Added

- Core persistent memory system: Markdown files as the source of truth, SQLite as
  a derived index, Git for versioning.
- **Hybrid search** — FTS5 keyword matching + sqlite-vec vector similarity merged
  via Reciprocal Rank Fusion, with local embeddings (no API calls).
- **Knowledge graph** — structured knowledge types with sequential IDs,
  bidirectional connections, hierarchical namespace tags, and connection discovery.
- **Git versioning** via isomorphic-git with semantic commit messages.
- **Consolidation** of session notes into knowledge files (heuristic, no LLM).
- **Decay** — archive-candidate detection based on access patterns.
- **Migrations** — split-files, namespace-tags, discover-connections.
- CLI (`agent-memory`) and a programmatic API (`createMemorySystem()`).
- Per-project and optional global memory stores.

[0.3.0]: https://github.com/fitznerIO/agent-memory/releases/tag/v0.3.0
[0.2.0]: https://github.com/fitznerIO/agent-memory/releases/tag/v0.2.0
[0.1.0]: https://github.com/fitznerIO/agent-memory/releases/tag/v0.1.0

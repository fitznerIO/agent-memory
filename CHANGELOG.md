# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`--quiet` for `note`, `store`, `update` and `connect`** (#12): one line instead
  of JSON, e.g. `stored dec-012 semantic/decisions/dec-012-….md`. On a real store
  a plain `store` answers with about 400 lines, almost all of them
  `existing_tags`; an agent took such a successful call for a failure. A result
  with `success: false` is still printed in full, and `update` says when the
  search index was not updated.

### Fixed

- **No more `dtype not specified` warning on every call** (#12). The embedding
  pipeline is now created with `dtype: "auto"` — exactly what the library does
  without a dtype (the model's own setting, else fp32 on CPU), minus the warning.
  The vectors are identical (checked) and stored indexes stay valid.
- **`relevance` in `suggested_connections` is rounded to three decimals.**
- **Rare words are no longer buried by vector neighbours** (#7). An entry found by
  only one search channel got the length of the *other* channel's result list as
  its substitute rank; for a rare word full-text returns one row, so "missing from
  full-text" scored almost like a full-text rank 1 and most vector neighbours
  outranked the one exact match. Both channels now use `poolSize + 1`. On a copy of
  a real 503-entry store, words that stand in exactly one entry reached the top 5
  of the default search in 31 of 33 cases (before: 4); none of the measured
  queries got worse. It does not guarantee position 1.
- **Numeric CLI flags are validated** (#9). `--limit`, `--min-score` and
  `--depth` with a value out of range (`-1`, `0`, `abc`, `1.5`) now stop with
  `Invalid --limit: -1 (expected a whole number above 0)` instead of failing in
  SQLite with `k value in knn queries must be >= 0` or `datatype mismatch`.

### Documentation

- README and `MemorySearchOutput.score`: what the normalised score means (ordinal
  within one response, not a relevance measure), that `limit` is part of the
  ranking, the real default weights, model and `minScore`, and an RRF example that
  can actually occur (#9).

- **Search no longer crashes on hyphenated queries.** `sanitizeFtsQuery` used a
  split regex (`/\b(\w+)-(\w+)\b/g`) that missed chained hyphens and non-ASCII
  words, so `"2026-08-27"` and `"NEUSTART-ÜBERGABE"` reached FTS5 with a hyphen
  intact — which FTS5 reads as column-exclusion syntax and rejects with
  `no such column: <token>`. Sanitizing is now a whitelist (`\p{L}\p{N}_` plus
  whitespace, unicode-aware), so umlauts survive and no punctuation can leak
  through. Comma and semicolon were failing the same way and are covered too.
- **A rejected FTS query no longer takes down hybrid search.** `searchText` now
  returns an empty result and logs a warning when FTS5 refuses to parse the
  MATCH expression, so the vector half still runs and the caller gets fewer
  results rather than none. Only parse errors are swallowed — a missing table,
  a closed database or an I/O error still throws, because that is a bug in the
  index rather than bad user input.
- **`update --mode append` appends instead of replacing.** The mode was parsed by
  the CLI and then dropped, so an append silently overwrote the existing body.
  `MemoryUpdateInput` now carries `mode?: "replace" | "append"` (default
  `"replace"`, unchanged behaviour); append keeps the current body and adds the
  new content after a blank line. The reported diff quotes the length actually
  written, not the input length — that mismatch is why a shrinking file looked
  like a normal update.
- **An unknown `--mode` is rejected** instead of falling back to `replace`. The
  flag decides whether the existing body survives; a typo used to overwrite it
  without a word.

### Added

- **The CLI warns when it is about to create an empty store.** Running from the
  wrong working directory used to build a fresh, empty store in silence — every
  search then came back with nothing, indistinguishable from a store without a
  match. The warning goes to stderr, so stdout stays parseable JSON.

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

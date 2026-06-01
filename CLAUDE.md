# Agent Memory System

Persistent memory for a personal Claude agent. Markdown files are the source of truth,
SQLite provides derived search indexes, Git handles versioning with semantic commits.

## Architecture

Six modules + orchestrator. Each module has types in `types.ts` and implementation in a separate file.

| Module | Path | Responsibility |
|--------|------|----------------|
| Memory Store | `src/memory/` | CRUD for markdown files with YAML frontmatter |
| Search Index | `src/search/` | FTS5 + sqlite-vec hybrid search via bun:sqlite |
| Git Manager | `src/git/` | Versioning with isomorphic-git |
| Embedding Engine | `src/embedding/` | Local embeddings via @huggingface/transformers |
| Consolidation | `src/consolidation/` | Heuristic-based session note consolidation (no LLM) |
| Extensions | `src/extensions/` | Plugin runtime: own SQLite table + `ext.<name>` frontmatter per extension |
| Orchestrator | `src/index.ts` | Wires modules together via `createMemorySystem()` |

## Module Isolation

Modules may ONLY import from:
- `../shared/*` (shared types, errors, config)
- Their own directory

Cross-module imports are forbidden. The orchestrator in `src/index.ts` is the sole integration point.

## Extensions

Plugins that add their own data + tools without touching the core schema. Authoring rules:

- An extension is an `Extension` object (`src/extensions/types.ts`): `name`, `version`, `description`, `schema` (its `<name>_meta` table), `tools`, optional `knowledgeTypes`/`onInstall`/`onUninstall`/`onStartup`/`onMigrate`. Register it by adding ONE entry to `AVAILABLE_EXTENSIONS` in `src/extensions/registry.ts`.
- **Own table only.** The runtime creates `<name>_meta` with `entry_id TEXT PRIMARY KEY` + `FOREIGN KEY (entry_id) REFERENCES knowledge(id) ON DELETE CASCADE`. Never `ALTER` core tables.
- **Own frontmatter namespace.** Write extension data under `ext.<name>` via `ctx.memory.setExtensionData(id, name, data)` — never core fields directly.
- **Custom knowledge types** go through `knowledgeTypes` (the C1 runtime registry in `src/shared/knowledge-types.ts`), not the closed `KnowledgeType` union. IDs are sequential `{idPrefix}-NNN`.
- **Reach the core only via the `ctx.memory` facade** (`MemoryAPI`) and the scoped `ctx.db` (`ExtensionDB`, project store connection). Extensions bind to the **project store only** (no global store).
- Reference implementation: `src/extensions/examples/bookmark.ts`. CLI tools dispatch as `agent-memory <tool_name> --flags` (Variante A — no Agent-SDK host).

## Commands

```bash
bun test                  # Run all tests
bun test tests/memory/    # Run memory module tests
bun test tests/search/    # Run search module tests
bun test tests/git/       # Run git module tests
bun test tests/embedding/ # Run embedding module tests
bun test tests/consolidation/ # Run consolidation module tests
bun test tests/extensions/    # Run extension system tests
bun test tests/integration/   # Run integration tests
bun run test:benchmark    # Search quality benchmark (P@3, MRR, score analysis)
bun run typecheck         # TypeScript strict check
bun run lint              # Biome linter
bun run lint:fix          # Auto-fix lint issues
```

## CLI Commands

```bash
agent-memory rebuild-index                    # Rebuild search index from all markdown files (re-embeds)
agent-memory consolidate                      # Consolidate session notes into knowledge files
agent-memory consolidate --dry-run            # Preview consolidation plan without executing
agent-memory decay                            # Show archive candidates based on access patterns
agent-memory decay --max-age 30 --min-access 3  # Custom staleness thresholds

agent-memory extensions list                  # Available extensions + installed state
agent-memory extensions install <name>        # Install (creates <name>_meta table, registers types)
agent-memory extensions uninstall <name>      # Uninstall (drops table, cleans ext.<name> frontmatter)
agent-memory extensions status <name>         # Version, installed_at, table, row count, tools
```

## Bun Gotchas

- **macOS sqlite-vec**: Apple's system SQLite blocks extensions. Call `Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib")` BEFORE creating any `Database` instance.
- **Imports**: Use `.ts` extensions in all relative imports.
- **Module system**: tsconfig uses `"module": "Preserve"` — use `import type` for type-only imports.
- **bun:sqlite**: `db.query()` for cached prepared statements, `db.prepare()` for one-off. Float32Array maps to BLOB natively.
- **bun:test**: Use `test.todo()` for pending tests. `beforeAll`/`afterAll` for setup/teardown.

## Patterns

- Factory functions (`createX`), not classes
- Interfaces in `types.ts`, implementations in separate files
- All methods in stubs throw `new Error("Not implemented")` until implemented
- Config flows through `MemoryConfig` from `src/shared/config.ts`

## Testing

- Use `bun:test` — `describe`, `test`, `expect`
- Filesystem tests: use `createTempDir()` / `cleanupTempDir()` from `tests/helpers/fixtures.ts`
- Integration tests go in `tests/integration/`

## Custom Agents

- **search-specialist**: Implements `src/search/` module. Expert in FTS5, sqlite-vec, RRF hybrid scoring.
- **quality-gate**: Read-only reviewer. Validates implementations against type contracts, runs tests, reports issues. Has no Write/Edit access.

## Memory Store (Dogfooding)

This project uses its own memory system. Use `/memory` or `bun run cli --` to store and recall context across sessions.

## Tech Stack

Bun, TypeScript 5 (strict), bun:sqlite, sqlite-vec, isomorphic-git, @huggingface/transformers, yaml

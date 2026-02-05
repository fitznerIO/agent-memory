# Agent Memory System

Persistent memory for a personal Claude agent. Markdown files are the source of truth,
SQLite provides derived search indexes, Git handles versioning with semantic commits.

## Architecture

Four modules + orchestrator. Each module has types in `types.ts` and implementation in a separate file.

| Module | Path | Responsibility |
|--------|------|----------------|
| Memory Store | `src/memory/` | CRUD for markdown files with YAML frontmatter |
| Search Index | `src/search/` | FTS5 + sqlite-vec hybrid search via bun:sqlite |
| Git Manager | `src/git/` | Versioning with isomorphic-git |
| Embedding Engine | `src/embedding/` | Local embeddings via @huggingface/transformers |
| Orchestrator | `src/index.ts` | Wires modules together via `createMemorySystem()` |

## Module Isolation

Modules may ONLY import from:
- `@shared/*` (shared types, errors, config)
- Their own directory

Cross-module imports are forbidden. The orchestrator in `src/index.ts` is the sole integration point.

## Commands

```bash
bun test                  # Run all tests
bun test tests/memory/    # Run memory module tests
bun test tests/search/    # Run search module tests
bun test tests/git/       # Run git module tests
bun test tests/embedding/ # Run embedding module tests
bun run typecheck         # TypeScript strict check
bun run lint              # Biome linter
bun run lint:fix          # Auto-fix lint issues
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
- Search tests: use `createTestDb()` from `tests/helpers/db.ts` (in-memory SQLite)
- Integration tests go in `tests/integration/`

## Custom Agents

- **search-specialist**: Implements `src/search/` module. Expert in FTS5, sqlite-vec, RRF hybrid scoring.
- **quality-gate**: Read-only reviewer. Validates implementations against type contracts, runs tests, reports issues. Has no Write/Edit access.

## Tech Stack

Bun, TypeScript 5 (strict), bun:sqlite, sqlite-vec, isomorphic-git, @huggingface/transformers, remark, yaml

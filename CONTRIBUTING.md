# Contributing to Agent Memory

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/fitznerIO/agent-memory.git
cd agent-memory

# Install dependencies (requires Bun >= 1.0)
bun install

# macOS only: install SQLite with extension support
brew install sqlite

# Run all tests
bun test

# Type checking
bun run typecheck

# Linting
bun run lint
```

## Architecture

The project follows a strict **module isolation** pattern. There are five modules plus an orchestrator:

```
src/
├── index.ts         Orchestrator — the only file that wires modules together
├── memory/          File-based CRUD with YAML frontmatter
├── search/          FTS5 + sqlite-vec hybrid search
├── git/             Git versioning via isomorphic-git
├── embedding/       Local embeddings via @huggingface/transformers
├── consolidation/   Session note consolidation
└── shared/          Shared types, errors, config
```

**The key rule: modules never import from each other.** A module may only import from:
- Its own directory
- `../shared/*`

All cross-module wiring happens in `src/index.ts`.

## Type Contracts

Each module defines its public interface in `types.ts`:
- `src/memory/types.ts`
- `src/search/types.ts`
- `src/git/types.ts`
- `src/embedding/types.ts`

These are the coupling points. If you change an interface, check that the orchestrator and tests still align.

## Running Tests

```bash
bun test                     # All tests
bun test tests/memory/       # Memory module only
bun test tests/search/       # Search module only
bun test tests/git/          # Git module only
bun test tests/embedding/    # Embedding module only
bun test tests/consolidation/ # Consolidation module only
bun test tests/integration/  # Integration tests
bun run test:benchmark       # Search quality benchmark
```

## Code Style

- **Linter:** [Biome](https://biomejs.dev) — run `bun run lint:fix` before committing
- **TypeScript:** Strict mode enabled, no `any` unless absolutely necessary
- **Pattern:** Factory functions (`createX(config)`), not classes
- **Imports:** Use `.ts` extensions in all relative imports (Bun requirement)

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `bun test`, `bun run typecheck`, and `bun run lint` all pass
4. Write a clear PR description explaining the "why"
5. Keep PRs focused — one concern per PR

## Reporting Issues

Use [GitHub Issues](https://github.com/fitznerIO/agent-memory/issues) to report bugs or request features. Please include:
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Bun version and OS

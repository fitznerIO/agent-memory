# Agent Memory

Persistent memory for AI agents. Markdown files are the source of truth, SQLite provides fast hybrid search, Git handles versioning.

```
bun install && bun test
```

## How It Works

```
                        createMemorySystem()
                                │
                ┌───────────────┼───────────────┐
                │               │               │
          ┌───────────┐   ┌──────────┐   ┌────────────┐
          │  Tools    │   │Lifecycle │   │ Internals  │
          │  API      │   │          │   │            │
          ├───────────┤   ├──────────┤   ├────────────┤
          │ note      │   │ start    │   │ store      │
          │ search    │   │ stop     │   │ search     │
          │ read      │   └──────────┘   │ git        │
          │ update    │                  │ embedding  │
          │ forget    │                  └────────────┘
          │ commit    │
          └─────┬─────┘
                │
    ┌───────────┼───────────┬───────────┐
    │           │           │           │
┌────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐
│ Memory │ │ Search │ │   Git   │ │Embedding │
│ Store  │ │ Index  │ │ Manager │ │ Engine   │
├────────┤ ├────────┤ ├─────────┤ ├──────────┤
│ .md    │ │ FTS5   │ │isomor-  │ │MiniLM-L6 │
│ files  │ │sqlite- │ │phic-git │ │384 dims  │
│ YAML   │ │vec RRF │ │         │ │local     │
└────────┘ └────────┘ └─────────┘ └──────────┘
```

## Architecture

Four isolated modules plus an orchestrator. Modules never import from each other — the orchestrator in `src/index.ts` is the sole wiring point.

```
src/
├── index.ts              Orchestrator — createMemorySystem()
├── cli.ts                CLI entry point — agent-memory <command>
├── memory/
│   ├── store.ts          File-based CRUD with YAML frontmatter
│   ├── parser.ts         Markdown + YAML parsing/serialization
│   └── types.ts          MemoryStore interface
├── search/
│   ├── index.ts          FTS5 + sqlite-vec hybrid search
│   ├── schema.sql        SQLite table definitions
│   └── types.ts          SearchIndex interface
├── git/
│   ├── manager.ts        Git versioning via isomorphic-git
│   └── types.ts          GitManager interface
├── embedding/
│   ├── engine.ts         Local embeddings via @huggingface/transformers
│   └── types.ts          EmbeddingEngine interface
└── shared/
    ├── types.ts          Shared domain types (Memory, SearchResult, ...)
    ├── config.ts         MemoryConfig + defaults
    └── errors.ts         Custom error classes
```

## Modules

### Memory Store

Each memory is a Markdown file with YAML frontmatter, organized by type:

```
<project>/.agent-memory/
├── core/           System identity, persistent instructions
├── semantic/       Facts, knowledge, learned concepts
├── episodic/       Session logs, conversations, events
└── procedural/     How-tos, workflows, patterns
```

A memory file looks like this:

```markdown
---
id: a1b2c3d4-...
title: TypeScript Tips
type: semantic
tags: [typescript, programming]
importance: high
createdAt: 1706000000000
updatedAt: 1706000000000
lastAccessedAt: 1706000000000
source: agent-session
---
TypeScript generics allow you to write reusable, type-safe functions.
```

### Search Index

Hybrid search combining three signals via [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf):

```
                    Query: "TypeScript generics"
                              │
                ┌─────────────┴─────────────┐
                │                           │
          ┌───────────┐               ┌───────────┐
          │   FTS5    │               │sqlite-vec │
          │   BM25    │               │  cosine   │
          │  (text)   │               │(semantic) │
          └─────┬─────┘               └─────┬─────┘
                │                           │
                │  Rank 1: doc_a            │  Rank 1: doc_b
                │  Rank 2: doc_c            │  Rank 2: doc_a
                │  Rank 3: doc_b            │  Rank 3: doc_d
                │                           │
                └─────────────┬─────────────┘
                              │
                  Reciprocal Rank Fusion
                  score = w_fts / (k + rank_fts)
                       + w_vec / (k + rank_vec)
                       + w_rec * recency_factor
                              │
                    ┌─────────┴────────┐
                    │  Merged Results  │
                    ├──────────────────┤
                    │  1. doc_a  0.42  │
                    │  2. doc_b  0.38  │
                    │  3. doc_c  0.21  │
                    └──────────────────┘
```

Default weights: FTS 0.3 / Vector 0.5 / Recency 0.2 (configurable).

### Git Manager

Every change is versioned with semantic commit messages:

```
[semantic]    Add TypeScript tips
[episodic]    Record debugging session
[procedural]  Update deployment workflow
[consolidate] Session abc123: 5 notes captured
[archive]     Archive old episodic memories
```

Pure JavaScript git via `isomorphic-git` — no native git binary required.

### Embedding Engine

Local-only embeddings, no API calls:

| Property     | Value                    |
|-------------|--------------------------|
| Model       | `Xenova/all-MiniLM-L6-v2` |
| Dimensions  | 384                      |
| Pooling     | Mean                     |
| Normalization | L2                     |
| Runtime     | ONNX (via @huggingface/transformers) |

Lazy-loaded on first use. Subsequent calls are instant.

## CLI

All commands output JSON. Errors go to stderr with exit code 1.

```bash
# Save a note
bun run cli -- note --content "User prefers TypeScript" --type semantic --importance medium

# Search memories
bun run cli -- search --query "TypeScript preferences" --limit 5

# Read a specific memory
bun run cli -- read --path "semantic/abc123.md"

# Update a memory
bun run cli -- update --path "semantic/abc.md" --content "New content" --reason "Updated info"

# Forget a memory
bun run cli -- forget --query "outdated info" --scope entry --confirm

# Commit changes to git
bun run cli -- commit --message "Session notes" --type consolidate
```

Global flags:

```
--project-dir <path>  Project root (auto-detected from .git/package.json)
--global-dir <path>   Global memory directory (default: ~/.agent-memory)
--no-global           Disable global store
--global              Route writes to global store
```

### Example output

```json
{
  "results": [
    {
      "content": "User prefers TypeScript over JavaScript",
      "source": "semantic/abc123.md",
      "score": 0.42,
      "type": "semantic",
      "lastAccessed": "2025-01-15T10:30:00.000Z",
      "storeSource": "project"
    }
  ],
  "totalFound": 1
}
```

## Claude Code Skill

A built-in skill at `.claude/skills/memory/SKILL.md` teaches Claude when and how to use the memory system. Claude automatically:

- Saves user preferences and important facts
- Searches past memories when context would help
- Commits changes at the end of productive sessions

Use `/memory` in Claude Code to invoke it manually, or let Claude trigger it automatically.

## Per-Project Store

Memories are stored **per project** in `.agent-memory/` at the project root. The project root is auto-detected by walking up from `cwd` looking for `.git/` or `package.json`.

```
my-project/
├── .git/                     Project repo
├── .gitignore                .agent-memory/ auto-added on first use
├── src/
└── .agent-memory/            Project-specific memories
    ├── .git/                 Memory versioning (separate repo)
    ├── .index/search.sqlite  Search index
    ├── core/
    ├── semantic/
    ├── episodic/
    └── procedural/
```

A **global store** at `~/.agent-memory/` is also searched by default. Use it for cross-project knowledge (preferences, general patterns). Search results include `storeSource: "project" | "global"` so you know where each result came from.

- `.gitignore` is auto-managed: `.agent-memory/` is added to the project's `.gitignore` on first use
- Write operations default to the project store. Use `--global` to write to the global store
- Use `--no-global` to skip the global store in search

## Library API

### Installation

```bash
# From GitHub (no npm publish required)
bun add github:fitznerIO/agent-memory

# From npm (after publishing)
bun add agent-memory

# Local development
bun link          # in agent-memory/
bun link agent-memory  # in your project/
```

### Usage

```typescript
import { createMemorySystem } from "agent-memory";
import type { MemorySearchInput, MemoryConfig } from "agent-memory";

const memory = createMemorySystem({
  baseDir: "/path/to/memory",
});

await memory.start();

await memory.note({
  content: "User prefers TypeScript over JavaScript",
  type: "semantic",
  importance: "medium",
});

const results = await memory.search({
  query: "TypeScript preferences",
  limit: 5,
});

await memory.commit({
  message: "Capture user preferences",
  type: "semantic",
});

await memory.stop();
```

| Method | Input | Description |
|--------|-------|-------------|
| `note` | `{ content, type, importance }` | Save a session note |
| `search` | `{ query, type?, limit?, minScore? }` | Hybrid search across all memories |
| `read` | `{ path }` | Read a specific memory file |
| `update` | `{ path, content, reason }` | Update content + auto-reindex |
| `forget` | `{ query, scope, confirm }` | Delete matching memories |
| `commit` | `{ message, type }` | Git commit with semantic type |

### Exported Types

All public types are available from the package root:

```typescript
import type {
  MemorySystem,       // Main interface returned by createMemorySystem()
  MemoryConfig,       // Configuration options
  Memory,             // A memory document (metadata + content + filePath)
  MemoryMetadata,     // YAML frontmatter fields (id, title, type, tags, ...)
  MemoryType,         // "core" | "semantic" | "episodic" | "procedural"
  Importance,         // "high" | "medium" | "low"
  CommitType,         // "semantic" | "episodic" | "procedural" | "consolidate" | "archive"
  SearchResult,       // Search hit with score and match type
  MemoryNoteInput,    // Input/output types for each tool method
  MemoryNoteOutput,
  MemorySearchInput,
  MemorySearchOutput,
  MemoryReadInput,
  MemoryReadOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
  MemoryForgetInput,
  MemoryForgetOutput,
  MemoryCommitInput,
  MemoryCommitOutput,
} from "agent-memory";
```

## Data Flow

```
  Agent Session
       │
       │  note("User prefers TS")
       ▼
  ┌───────────────────┐    write     ┌──────────────────┐
  │ Memory Store      │────────────▶ │ semantic/abc.md  │
  │ (CRUD)            │              │ (YAML + content) │
  └────────┬──────────┘              └────────┬─────────┘
           │                                  │
           │ memory object                    │ read on search
           ▼                                  ▼
  ┌───────────────────┐  embed  ┌───────────────────┐
  │ Embedding Engine  │────────▶│ Search Index      │
  │ (MiniLM-L6)      │  384d   │ (SQLite)          │
  └───────────────────┘ vector  │  ├ memories table │
                                │  ├ FTS5 (text)    │
                                │  └ vec0 (vectors) │
                                └─────────┬─────────┘
                                          │
                                          │ hybrid search
                                          ▼
                                ┌───────────────────┐
                                │ RRF Merge         │
                                │ FTS + Vec + Time  │
                                └─────────┬─────────┘
                                          │
       ┌──────────────────────────────────┘
       │
       │  commit("capture preferences", "semantic")
       ▼
  ┌───────────────────┐
  │ Git Manager       │
  │ (isomorphic-git)  │
  │ [semantic] msg    │
  └───────────────────┘
```

## Commands

```bash
bun test                    # All tests (96)
bun run test:memory         # Memory store + parser (25)
bun run test:search         # Search index (17)
bun run test:git            # Git manager (22)
bun run test:embedding      # Embedding engine (14)
bun run test:integration    # End-to-end flows (17)
bun run typecheck           # TypeScript strict mode
bun run lint                # Biome linter
bun run lint:fix            # Auto-fix lint issues
```

## Configuration

All settings flow through `MemoryConfig`:

```typescript
{
  baseDir: "~/.agent-memory",           // Root directory for all files
  sqlitePath: "~/.agent-memory/.index/search.sqlite",
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
  embeddingDimensions: 384,
  hybridDefaults: {
    limit: 5,                           // Max results
    minScore: 0.3,                      // Minimum RRF score
    weightFts: 0.3,                     // BM25 weight
    weightVector: 0.5,                  // Cosine similarity weight
    weightRecency: 0.2,                 // Recency boost weight
    rrfK: 60,                           // RRF smoothing constant
  },
  maxCoreTokens: 4000,                  // Budget for core memories
}
```

Override any setting via `createMemorySystem({ baseDir: "/custom/path" })`.

## Tech Stack

| Tool | Purpose |
|------|---------|
| [Bun](https://bun.sh) | Runtime, test runner, bundler |
| [bun:sqlite](https://bun.sh/docs/api/sqlite) | SQLite driver with native Float32Array support |
| [sqlite-vec](https://github.com/asg017/sqlite-vec) | Vector similarity search extension |
| [isomorphic-git](https://isomorphic-git.org) | Pure JS git implementation |
| [@huggingface/transformers](https://huggingface.co/docs/transformers.js) | Local ONNX model inference |
| [TypeScript 5](https://www.typescriptlang.org) | Strict mode |
| [Biome](https://biomejs.dev) | Linter + formatter |

## Platform Notes

**macOS**: Apple's system SQLite blocks loading extensions. The search module automatically loads Homebrew's SQLite:

```typescript
Database.setCustomSQLite("/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib");
```

Install it with `brew install sqlite` if not already present.

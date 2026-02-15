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
          ┌───────────────┐┌──────────┐   ┌────────────┐
          │  Tools API    ││Lifecycle │   │ Internals  │
          │               ││          │   │            │
          ├───────────────┤├──────────┤   ├────────────┤
          │ note          ││ start    │   │ store      │
          │ search        ││ stop     │   │ search     │
          │ read          │└──────────┘   │ git        │
          │ update        │               │ embedding  │
          │ forget        │               └────────────┘
          │ commit        │
          │───────────────│
          │ memoryStore   │  v2-lite
          │ memoryConnect │  knowledge
          │ memoryTraverse│  graph
          └───────┬───────┘
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

Four isolated modules plus an orchestrator and migrations. Modules never import from each other — the orchestrator in `src/index.ts` is the sole wiring point.

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
│   ├── schema.sql        SQLite table definitions (memories, knowledge, connections, tags)
│   └── types.ts          SearchIndex interface
├── git/
│   ├── manager.ts        Git versioning via isomorphic-git
│   └── types.ts          GitManager interface
├── embedding/
│   ├── engine.ts         Local embeddings via @huggingface/transformers
│   └── types.ts          EmbeddingEngine interface
├── migration/
│   ├── split-files.ts    Split bulk .md into individual knowledge files
│   ├── namespace-tags.ts Convert flat tags to hierarchical namespaces
│   └── discover-connections.ts  Auto-discover related entries via search
└── shared/
    ├── types.ts          Shared domain types (Memory, SearchResult, ...)
    ├── config.ts         MemoryConfig + defaults
    ├── errors.ts         Custom error classes
    └── utils.ts          v2-lite helpers (slugify, parseV2LiteId, knowledgeTypeDir, ...)
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

### v2-lite: Knowledge Graph

v2-lite adds structured knowledge types, bidirectional connections, sequential IDs, and namespace tags on top of the base memory store.

#### Knowledge Types

| Type | Prefix | Directory | Description |
|------|--------|-----------|-------------|
| `decision` | `dec` | `semantic/decisions/` | Architectural and design decisions |
| `entity` | `entity` | `semantic/entities/` | People, tools, services, concepts |
| `note` | `note` | `semantic/notes/` | General knowledge and facts |
| `incident` | `inc` | `episodic/incidents/` | Bugs, outages, debugging sessions |
| `session` | `session` | `episodic/sessions/` | Work sessions and conversation logs |
| `pattern` | `pat` | `procedural/patterns/` | Recurring patterns and best practices |
| `workflow` | `wf` | `procedural/workflows/` | Step-by-step processes and how-tos |

#### Directory Structure

```
<project>/.agent-memory/
├── semantic/
│   ├── decisions/       dec-001-webhook-statt-polling.md
│   ├── entities/        entity-001-stenciljs.md
│   └── notes/           note-001-typescript-tips.md
├── episodic/
│   ├── incidents/       inc-001-api-timeout.md
│   └── sessions/        session-001-refactoring.md
└── procedural/
    ├── patterns/        pat-001-factory-pattern.md
    └── workflows/       wf-001-deploy-pipeline.md
```

#### v2-lite Frontmatter

```markdown
---
id: dec-001
title: Webhook statt Polling
type: decision
tags: [tech/api, patterns/integration]
created: "2025-06-15"
updated: "2025-06-15"
connections:
  - target: inc-001
    type: related
    note: Triggered by API timeout incident
  - target: pat-002
    type: builds_on
---
We switched from polling to webhooks because...
```

Key differences from v1: sequential IDs (`dec-001`), string dates (`YYYY-MM-DD`), hierarchical namespace tags (`tech/api`), and inline connections.

#### Connections

| Type | Inverse | Description |
|------|---------|-------------|
| `related` | `related` | General bidirectional relationship |
| `builds_on` | `extended_by` | Entry extends or refines another |
| `contradicts` | `contradicts` | Entries conflict or supersede reasoning |
| `part_of` | `contains` | Entry is a component of another |
| `supersedes` | `superseded_by` | Entry replaces an older one |

Connections are always **bidirectional** — creating `dec-001 --builds_on--> pat-002` automatically creates `pat-002 --extended_by--> dec-001`.

#### Connection Discovery

When you store a new entry, the system automatically searches for related existing entries using FTS5 + vector similarity and suggests connections. This keeps the knowledge graph growing organically.

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

# Search with v2-lite filters
bun run cli -- search --query "API integration" --tags "tech/api" --connected-to dec-001

# Read a specific memory
bun run cli -- read --path "semantic/abc123.md"

# Update a memory
bun run cli -- update --path "semantic/abc.md" --content "New content" --reason "Updated info"

# Forget a memory
bun run cli -- forget --query "outdated info" --scope entry --confirm

# Commit changes to git
bun run cli -- commit --message "Session notes" --type consolidate

# v2-lite: Store a knowledge entry
bun run cli -- store --title "Webhook statt Polling" --type decision \
  --content "We switched to webhooks because..." --tags "tech/api,patterns/integration"

# v2-lite: Connect two entries
bun run cli -- connect --source dec-001 --target inc-001 --type related --note "Related incident"

# v2-lite: Traverse the knowledge graph
bun run cli -- traverse --start dec-001 --direction both --depth 2

# v2-lite: Run a migration step
bun run cli -- migrate --step split-files
bun run cli -- migrate --step namespace-tags
bun run cli -- migrate --step discover-connections
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
    │   ├── decisions/        v2-lite knowledge files
    │   ├── entities/
    │   └── notes/
    ├── episodic/
    │   ├── incidents/
    │   └── sessions/
    └── procedural/
        ├── patterns/
        └── workflows/
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

// v1: Save a session note
await memory.note({
  content: "User prefers TypeScript over JavaScript",
  type: "semantic",
  importance: "medium",
});

// v1: Hybrid search
const results = await memory.search({
  query: "TypeScript preferences",
  limit: 5,
});

// v2-lite: Store a knowledge entry
const entry = await memory.memoryStore({
  title: "Webhook statt Polling",
  type: "decision",
  content: "We switched to webhooks because...",
  tags: ["tech/api", "patterns/integration"],
  connections: [{ target: "inc-001", type: "related" }],
});
// → { id: "dec-001", file_path: "semantic/decisions/dec-001-webhook-statt-polling.md",
//     suggested_connections: [...], existing_tags: [...] }

// v2-lite: Connect two entries
await memory.memoryConnect({
  source_id: "dec-001",
  target_id: "pat-002",
  type: "builds_on",
});
// → { success: true, inverse_type: "extended_by" }

// v2-lite: Traverse the knowledge graph
const graph = await memory.memoryTraverse({
  start_id: "dec-001",
  direction: "both",
  depth: 2,
});
// → { results: [{ id: "inc-001", title: "API Timeout", type: "incident",
//                  connection_type: "related", distance: 1 }, ...] }

// v2-lite: Search with tags and graph filters
const filtered = await memory.search({
  query: "API integration",
  tags: ["tech/api"],
  connected_to: "dec-001",
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
| `search` | `{ query, type?, limit?, minScore?, tags?, connected_to? }` | Hybrid search across all memories |
| `read` | `{ path }` | Read a specific memory file |
| `update` | `{ path, content, reason }` | Update content + auto-reindex |
| `forget` | `{ query, scope, confirm }` | Delete matching memories |
| `commit` | `{ message, type }` | Git commit with semantic type |
| `memoryStore` | `{ title, type, content, tags?, connections? }` | Store a v2-lite knowledge entry |
| `memoryConnect` | `{ source_id, target_id, type, note? }` | Create bidirectional connection |
| `memoryTraverse` | `{ start_id, direction, types?, depth? }` | BFS traversal of the knowledge graph |

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
  // v2-lite types
  KnowledgeType,      // "decision" | "incident" | "entity" | "pattern" | "workflow" | "note" | "session"
  ConnectionType,     // "related" | "builds_on" | "contradicts" | "part_of" | "supersedes"
  Connection,         // { target, type, note? }
  KnowledgeEntry,     // Knowledge node in the graph (id, title, type, tags, connections, ...)
  MemoryStoreInput,
  MemoryStoreOutput,
  MemoryConnectInput,
  MemoryConnectOutput,
  MemoryTraverseInput,
  MemoryTraverseOutput,
} from "agent-memory";
```

## Data Flow

```
  Agent Session
       │
       │  note("User prefers TS")           memoryStore({ title, type, content })
       ▼                                     ▼
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
                                │  ├ knowledge table│  v2-lite
                                │  ├ connections    │  v2-lite
                                │  ├ entry_tags     │  v2-lite
                                │  ├ FTS5 (text)    │
                                │  └ vec0 (vectors) │
                                └─────────┬─────────┘
                                          │
                                          │ hybrid search + graph traversal
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
bun test                    # All tests (234)
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

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

## License

[MIT](LICENSE)

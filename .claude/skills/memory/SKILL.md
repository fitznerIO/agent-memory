---
name: memory
description: >
  Persistent memory for the agent. Use to store, search, read, update
  and forget information across sessions. Trigger when context from past
  sessions would help, when the user shares preferences or important facts,
  or when information should be remembered for later.
allowed-tools: Bash(bunx agent-memory *), Bash(bun run */cli.ts *)
---

# Agent Memory

You have persistent memory. Use it proactively.

## Store Architecture

Memories are stored **per project** in `.agent-memory/` at the project root (auto-detected from `.git` or `package.json`). A **global store** at `~/.agent-memory/` is also searched automatically and contains cross-project knowledge.

- Write operations go to the **project store** by default.
- Use `--global` to write to the global store instead.
- Search queries both stores and merges results (project preferred).
- Use `--no-global` to skip the global store in search.

## When to Use

| Situation | Action |
|-----------|--------|
| User shares a preference or fact worth remembering | `note --type semantic` |
| Something noteworthy happens in the session | `note --type episodic` |
| User explains a workflow or process | `note --type procedural` |
| You need context from past sessions | `search` |
| You need to read a specific memory | `read` |
| Stored information is outdated | `update` or `forget` |
| End of a productive session | `commit` |

## Commands

All commands output JSON to stdout. Errors go to stderr.

```
bunx agent-memory <command> [flags]
```

### note — Save information

```bash
bunx agent-memory note --content "The information to remember" --type <type> --importance <level>
```

- `--content` (required): The text to save
- `--type`: `semantic` (facts/knowledge), `episodic` (events/sessions), `procedural` (how-tos) — default: semantic
- `--importance`: `high`, `medium`, `low` — default: medium
- `--global`: Save to global store instead of project store

### search — Find memories

```bash
bunx agent-memory search --query "what to find" [--limit 5] [--min-score 0.0]
```

- `--query` (required): Natural language search query
- `--limit`: Max results (default: 5)
- `--min-score`: Minimum relevance score 0.0-1.0 (default: 0.3, use 0.0 for broad search)
- `--no-global`: Only search project store

Returns `{ results: [...], totalFound: N }`. Each result includes `storeSource: "project" | "global"`.

### read — Read a specific memory

```bash
bunx agent-memory read --path "semantic/abc123.md"
```

- `--path` (required): Relative file path (from search results `source` field)

### update — Modify existing memory

```bash
bunx agent-memory update --path "semantic/abc.md" --content "New content" --reason "Why it changed"
```

- `--path` (required): File path of the memory to update
- `--content` (required): New content
- `--reason` (required): Why the update was made

### forget — Delete memories

```bash
bunx agent-memory forget --query "what to forget" --scope entry --confirm
```

- `--query` (required): What to forget
- `--scope`: `entry` (single best match) or `topic` (all related) — default: entry
- `--confirm` (required): Must be present to actually delete

### commit — Save to git

```bash
bunx agent-memory commit --message "Description of changes" --type <commit-type>
```

- `--message` (required): Commit message
- `--type`: `semantic`, `episodic`, `procedural`, `consolidate`, `archive` — default: consolidate

## Global flags

```
--project-dir <path>  Project root (auto-detected from .git/package.json)
--global-dir <path>   Global memory directory (default: ~/.agent-memory)
--global              Route writes to global store
--no-global           Disable global store for this command
```

## Memory Types

- **semantic**: Facts, knowledge, learned concepts. "TypeScript generics enable type-safe reusable code."
- **episodic**: Events, sessions, conversations. "Debugged a race condition in the payment service on 2024-01-15."
- **procedural**: Processes, workflows, how-tos. "To deploy: run tests, build, push to main, verify staging."

## Best Practices

- Save early, save often. It's better to have too many memories than too few.
- Use `search` at the start of sessions to recall relevant context.
- Set importance to `high` for user preferences and critical facts.
- Commit after making several notes to persist them in git history.
- Use descriptive content — future searches rely on text similarity.
- Store cross-project knowledge (preferences, general patterns) with `--global`.
- Don't store secrets, passwords, or API keys.

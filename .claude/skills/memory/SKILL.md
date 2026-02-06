---
name: memory
description: >
  Persistent memory for the agent. Use to store, search, read, update
  and forget information across sessions. Trigger when context from past
  sessions would help, when the user shares preferences or important facts,
  or when information should be remembered for later.
allowed-tools: Bash(bun run */cli.ts *)
---

# Agent Memory

You have persistent memory. Use it proactively.

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

The CLI lives at `src/cli.ts` in the project root. Run with:

```
bun run src/cli.ts <command> [flags]
```

### note — Save information

```bash
bun run src/cli.ts note --content "The information to remember" --type <type> --importance <level>
```

- `--content` (required): The text to save
- `--type`: `semantic` (facts/knowledge), `episodic` (events/sessions), `procedural` (how-tos) — default: semantic
- `--importance`: `high`, `medium`, `low` — default: medium

### search — Find memories

```bash
bun run src/cli.ts search --query "what to find" [--limit 5] [--min-score 0.0]
```

- `--query` (required): Natural language search query
- `--limit`: Max results (default: 5)
- `--min-score`: Minimum relevance score 0.0-1.0 (default: 0.3, use 0.0 for broad search)

Returns `{ results: [...], totalFound: N }`.

### read — Read a specific memory

```bash
bun run src/cli.ts read --path "semantic/abc123.md"
```

- `--path` (required): Relative file path (from search results `source` field)

### update — Modify existing memory

```bash
bun run src/cli.ts update --path "semantic/abc.md" --content "New content" --reason "Why it changed"
```

- `--path` (required): File path of the memory to update
- `--content` (required): New content
- `--reason` (required): Why the update was made

### forget — Delete memories

```bash
bun run src/cli.ts forget --query "what to forget" --scope entry --confirm
```

- `--query` (required): What to forget
- `--scope`: `entry` (single best match) or `topic` (all related) — default: entry
- `--confirm` (required): Must be present to actually delete

### commit — Save to git

```bash
bun run src/cli.ts commit --message "Description of changes" --type <commit-type>
```

- `--message` (required): Commit message
- `--type`: `semantic`, `episodic`, `procedural`, `consolidate`, `archive` — default: consolidate

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
- Don't store secrets, passwords, or API keys.

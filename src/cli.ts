#!/usr/bin/env bun
import { createMemorySystem } from "./index.ts";
import type { MemorySystem } from "./index.ts";

function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string>;
} {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = rest[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        flags[key] = value;
        i++;
      } else {
        // Boolean flag (e.g. --confirm)
        flags[key] = "true";
      }
    }
  }

  return { command: command ?? "", flags };
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value) {
    console.error(`Missing required flag: --${name}`);
    process.exit(1);
  }
  return value;
}

async function initSystem(
  flags: Record<string, string>,
): Promise<MemorySystem> {
  const overrides: Record<string, unknown> = {};
  if (flags["base-dir"]) overrides.baseDir = flags["base-dir"];
  if (flags["sqlite-path"]) overrides.sqlitePath = flags["sqlite-path"];

  const system = createMemorySystem(overrides);
  await system.start();
  return system;
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (!command || command === "help") {
    console.log(`agent-memory — Persistent memory for AI agents

Commands:
  note     Save a note to memory
  search   Hybrid search across all memories
  read     Read a specific memory file
  update   Update memory content
  forget   Delete matching memories
  commit   Git commit pending changes

Global flags:
  --base-dir <path>     Memory directory (default: ~/.agent-memory)
  --sqlite-path <path>  SQLite database path

Examples:
  agent-memory note --content "User prefers TypeScript" --type semantic --importance medium
  agent-memory search --query "TypeScript preferences" --limit 5
  agent-memory read --path "semantic/abc123.md"
  agent-memory commit --message "Session notes" --type consolidate`);
    process.exit(0);
  }

  let system: MemorySystem | null = null;

  try {
    system = await initSystem(flags);

    switch (command) {
      case "note": {
        const result = await system.note({
          content: requireFlag(flags, "content"),
          type: (flags.type ?? "semantic") as
            | "semantic"
            | "episodic"
            | "procedural",
          importance: (flags.importance ?? "medium") as
            | "high"
            | "medium"
            | "low",
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "search": {
        const result = await system.search({
          query: requireFlag(flags, "query"),
          limit: flags.limit ? Number.parseInt(flags.limit, 10) : undefined,
          minScore: flags["min-score"]
            ? Number.parseFloat(flags["min-score"])
            : undefined,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "read": {
        const result = await system.read({
          path: requireFlag(flags, "path"),
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "update": {
        const result = await system.update({
          path: requireFlag(flags, "path"),
          content: requireFlag(flags, "content"),
          reason: requireFlag(flags, "reason"),
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "forget": {
        const result = await system.forget({
          query: requireFlag(flags, "query"),
          scope: (flags.scope ?? "entry") as "entry" | "topic",
          confirm: flags.confirm === "true",
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "commit": {
        const result = await system.commit({
          message: requireFlag(flags, "message"),
          type: (flags.type ?? "consolidate") as
            | "semantic"
            | "episodic"
            | "procedural"
            | "consolidate"
            | "archive",
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.error(
          `Unknown command: ${command}. Run "agent-memory help" for usage.`,
        );
        process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    if (system) {
      system.searchIndex.close();
    }
  }
}

main();

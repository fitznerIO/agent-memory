#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { createMemorySystem } from "./index.ts";
import type { MemorySystem } from "./index.ts";
import { migrateDiscoverConnections } from "./migration/discover-connections.ts";
import { migrateNamespaceTags } from "./migration/namespace-tags.ts";
import { migrateSplitFiles } from "./migration/split-files.ts";
import { findProjectRoot } from "./shared/config.ts";

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
        // Boolean flag (e.g. --confirm, --global, --no-global)
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

  // Project store: explicit flag or auto-detect from cwd
  if (flags["project-dir"]) {
    overrides.baseDir = join(flags["project-dir"], ".agent-memory");
    overrides.sqlitePath = join(
      flags["project-dir"],
      ".agent-memory",
      ".index",
      "search.sqlite",
    );
  }

  // Legacy flag support
  if (flags["base-dir"]) overrides.baseDir = flags["base-dir"];
  if (flags["sqlite-path"]) overrides.sqlitePath = flags["sqlite-path"];

  // Global store: enabled by default, disabled with --no-global
  if (flags["no-global"] !== "true") {
    const globalDir = flags["global-dir"] ?? join(homedir(), ".agent-memory");
    overrides.globalDir = globalDir;
    overrides.globalSqlitePath = join(globalDir, ".index", "search.sqlite");
  }

  const system = createMemorySystem(overrides);
  await system.start();
  return system;
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (!command || command === "help") {
    console.log(`agent-memory — Persistent memory for AI agents

Commands:
  note       Save a note to memory
  search     Hybrid search across all memories
  read       Read a specific memory file
  update     Update memory content
  forget     Delete matching memories
  commit     Git commit pending changes
  store      Create individual knowledge file (v2-lite)
  connect    Create bidirectional connection (v2-lite)
  traverse   Navigate knowledge network (v2-lite)
  migrate    Run migrations (split-files)

Global flags:
  --project-dir <path>  Project root (auto-detected from .git/package.json)
  --global-dir <path>   Global memory directory (default: ~/.agent-memory)
  --no-global           Disable global store
  --global              Route writes to global store

Examples:
  agent-memory note --content "User prefers TypeScript" --type semantic --importance medium
  agent-memory search --query "TypeScript preferences" --limit 5
  agent-memory read --path "semantic/abc123.md"
  agent-memory store --title "Webhook statt Polling" --type decision --content "..."
  agent-memory connect --source dec-001 --target inc-001 --type related
  agent-memory traverse --start dec-001 --direction both
  agent-memory commit --message "Session notes" --type consolidate
  agent-memory migrate --step split-files
  agent-memory migrate --step namespace-tags
  agent-memory migrate --step discover-connections`);
    process.exit(0);
  }

  // Handle migrate command separately (no MemorySystem needed)
  if (command === "migrate") {
    const step = requireFlag(flags, "step");
    const projectDir = flags["project-dir"] ?? findProjectRoot(process.cwd());
    const baseDir = projectDir
      ? join(projectDir, ".agent-memory")
      : join(process.cwd(), ".agent-memory");

    switch (step) {
      case "split-files": {
        const results = migrateSplitFiles(baseDir);
        console.log(JSON.stringify(results, null, 2));
        break;
      }
      case "namespace-tags": {
        const results = migrateNamespaceTags(baseDir);
        console.log(JSON.stringify(results, null, 2));
        break;
      }
      case "discover-connections": {
        const results = await migrateDiscoverConnections(baseDir);
        console.log(JSON.stringify(results, null, 2));
        break;
      }
      default:
        console.error(
          `Unknown migration step: ${step}. Available: split-files, namespace-tags, discover-connections`,
        );
        process.exit(1);
    }
    process.exit(0);
  }

  let system: MemorySystem | null = null;

  try {
    system = await initSystem(flags);

    // Determine target store for write operations
    const useGlobal = flags.global === "true" && system.globalStore;

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

      case "store": {
        const result = await system.memoryStore({
          title: requireFlag(flags, "title"),
          type: (flags.type ?? "note") as
            | "decision"
            | "incident"
            | "entity"
            | "pattern"
            | "workflow"
            | "note",
          content: requireFlag(flags, "content"),
          tags: flags.tags ? flags.tags.split(",").map((t) => t.trim()) : undefined,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "connect": {
        const result = await system.memoryConnect({
          source_id: requireFlag(flags, "source"),
          target_id: requireFlag(flags, "target"),
          type: (flags.type ?? "related") as
            | "related"
            | "builds_on"
            | "contradicts"
            | "part_of"
            | "supersedes",
          note: flags.note,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "traverse": {
        const result = await system.memoryTraverse({
          start_id: requireFlag(flags, "start"),
          direction: (flags.direction ?? "both") as
            | "outgoing"
            | "incoming"
            | "both",
          depth: flags.depth
            ? Number.parseInt(flags.depth, 10)
            : undefined,
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
      if (system.globalSearchIndex) {
        system.globalSearchIndex.close();
      }
    }
  }
}

main();

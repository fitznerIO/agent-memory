/**
 * Migration: Convert flat tags to namespace tags.
 *
 * Reads all markdown files with frontmatter tags, attempts to map flat tags
 * to namespace paths, and updates the frontmatter.
 *
 * PRD 11.2 — agent-memory migrate namespace-tags
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseMarkdown, serializeMarkdown } from "../memory/parser.ts";

/** Common namespace mappings for known tool/technology tags. */
const KNOWN_MAPPINGS: Record<string, string> = {
  // AI
  "claude-sdk": "tech/ai/claude-sdk",
  claude: "tech/ai/claude",
  openai: "tech/ai/openai",
  llm: "tech/ai/llm",
  embeddings: "tech/ai/embeddings",
  // Web
  stenciljs: "tech/web/stenciljs",
  react: "tech/web/react",
  nextjs: "tech/web/nextjs",
  html: "tech/web/html",
  css: "tech/web/css",
  // Infrastructure
  docker: "tech/infrastructure/docker",
  nginx: "tech/infrastructure/nginx",
  ssl: "tech/infrastructure/ssl",
  dns: "tech/infrastructure/dns",
  // Automation
  n8n: "tech/automation/n8n",
  zapier: "tech/automation/zapier",
  // Languages
  typescript: "tech/lang/typescript",
  javascript: "tech/lang/javascript",
  python: "tech/lang/python",
  // Data
  sqlite: "tech/data/sqlite",
  postgres: "tech/data/postgres",
  redis: "tech/data/redis",
};

export interface TagMigrationResult {
  file: string;
  originalTags: string[];
  migratedTags: string[];
  unchanged: boolean;
}

/**
 * Attempt to map a flat tag to a namespace tag.
 * Returns the mapped tag, or prefixes with `_untagged/` if no mapping found.
 */
export function mapTag(tag: string): string {
  const normalized = tag.toLowerCase().trim();

  // Already has a namespace (contains /)
  if (normalized.includes("/")) return normalized;

  // Check known mappings
  const mapped = KNOWN_MAPPINGS[normalized];
  if (mapped) {
    return mapped;
  }

  // Prefix with _untagged/
  return `_untagged/${normalized}`;
}

/**
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip hidden directories like .index, .git
      if (!entry.startsWith(".")) {
        files.push(...findMarkdownFiles(fullPath));
      }
    } else if (entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Migrate tags in a single markdown file from flat to namespace format.
 */
export function migrateFileTags(absPath: string): TagMigrationResult {
  const raw = readFileSync(absPath, "utf-8");
  const doc = parseMarkdown(raw);

  const originalTags = (doc.frontmatter.tags as string[] | undefined) ?? [];

  if (originalTags.length === 0) {
    return {
      file: absPath,
      originalTags: [],
      migratedTags: [],
      unchanged: true,
    };
  }

  const migratedTags = originalTags.map(mapTag);

  // Check if anything changed
  const unchanged = originalTags.every((t, i) => t === migratedTags[i]);

  if (!unchanged) {
    doc.frontmatter.tags = migratedTags;
    const serialized = serializeMarkdown(doc);
    writeFileSync(absPath, serialized);
  }

  return {
    file: absPath,
    originalTags,
    migratedTags,
    unchanged,
  };
}

/**
 * Run the full namespace-tags migration on a memory store directory.
 */
export function migrateNamespaceTags(baseDir: string): TagMigrationResult[] {
  const files = findMarkdownFiles(baseDir);
  const results: TagMigrationResult[] = [];

  for (const file of files) {
    const result = migrateFileTags(file);
    results.push(result);
  }

  return results;
}

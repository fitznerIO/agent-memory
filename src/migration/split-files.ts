/**
 * Migration: Split bulk markdown files into individual knowledge files.
 *
 * Reads bulk files like `semantic/decisions.md`, splits at `##` headings,
 * and creates individual files with generated frontmatter.
 *
 * PRD 11.1 — agent-memory migrate split-files
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { serializeMarkdown } from "../memory/parser.ts";
import type { KnowledgeType } from "../shared/types.ts";

/** Map bulk file paths to their knowledge type. */
const BULK_FILE_MAP: Array<{ glob: string; type: KnowledgeType; subdir: string }> = [
  { glob: "semantic/decisions.md", type: "decision", subdir: "semantic/decisions" },
  { glob: "episodic/incidents.md", type: "incident", subdir: "episodic/incidents" },
  { glob: "procedural/workflows.md", type: "workflow", subdir: "procedural/workflows" },
  { glob: "procedural/patterns.md", type: "pattern", subdir: "procedural/patterns" },
];

/** Type prefixes for sequential IDs. */
const TYPE_PREFIX: Record<string, string> = {
  decision: "dec",
  incident: "inc",
  entity: "entity",
  pattern: "pat",
  workflow: "wf",
  note: "note",
  session: "session",
};

/** Convert title to URL-friendly slug. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => {
      const map: Record<string, string> = {
        ä: "ae",
        ö: "oe",
        ü: "ue",
        ß: "ss",
      };
      return map[c] ?? c;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export interface SplitSection {
  title: string;
  content: string;
}

/**
 * Split a markdown file at ## headings into individual sections.
 */
export function splitAtHeadings(raw: string): SplitSection[] {
  const lines = raw.split("\n");
  const sections: SplitSection[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  let foundFirstHeading = false;

  // Skip frontmatter if present
  let startIdx = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        startIdx = i + 1;
        break;
      }
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(/^##\s+(.+)/);

    if (headingMatch) {
      // Save previous section if any
      if (foundFirstHeading && currentTitle) {
        const body = currentLines.join("\n").trim();
        if (body.length > 0) {
          sections.push({ title: currentTitle, content: body });
        }
      }
      currentTitle = headingMatch[1]?.trim() ?? "";
      currentLines = [];
      foundFirstHeading = true;
    } else if (foundFirstHeading) {
      currentLines.push(line);
    }
  }

  // Don't forget the last section
  if (foundFirstHeading && currentTitle) {
    const body = currentLines.join("\n").trim();
    if (body.length > 0) {
      sections.push({ title: currentTitle, content: body });
    }
  }

  return sections;
}

export interface SplitResult {
  sourceFile: string;
  createdFiles: string[];
  skipped: boolean;
  reason?: string;
}

/**
 * Split a single bulk file into individual knowledge files.
 */
export function splitBulkFile(
  baseDir: string,
  bulkRelPath: string,
  type: KnowledgeType,
  subdir: string,
  startCounter?: number,
): SplitResult {
  const absPath = join(baseDir, bulkRelPath);

  if (!existsSync(absPath)) {
    return {
      sourceFile: bulkRelPath,
      createdFiles: [],
      skipped: true,
      reason: "File not found",
    };
  }

  const raw = readFileSync(absPath, "utf-8");
  const sections = splitAtHeadings(raw);

  if (sections.length === 0) {
    return {
      sourceFile: bulkRelPath,
      createdFiles: [],
      skipped: true,
      reason: "No ## sections found",
    };
  }

  const prefix = TYPE_PREFIX[type] ?? type;
  const outDir = join(baseDir, subdir);
  mkdirSync(outDir, { recursive: true });

  const createdFiles: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const counter = (startCounter ?? 1) + i;
    const id = `${prefix}-${String(counter).padStart(3, "0")}`;
    const slug = slugify(section.title);
    const fileName = `${id}-${slug}.md`;
    const relPath = join(subdir, fileName);
    const absFilePath = join(baseDir, relPath);

    const frontmatter: Record<string, unknown> = {
      id,
      title: section.title,
      type,
      tags: [],
      created: today,
      updated: today,
      connections: [],
    };

    const serialized = serializeMarkdown({ frontmatter, body: section.content });
    writeFileSync(absFilePath, serialized);
    createdFiles.push(relPath);
  }

  // Remove the original bulk file
  unlinkSync(absPath);

  return {
    sourceFile: bulkRelPath,
    createdFiles,
    skipped: false,
  };
}

/**
 * Run the full split-files migration on a memory store directory.
 */
export function migrateSplitFiles(baseDir: string): SplitResult[] {
  const results: SplitResult[] = [];

  for (const mapping of BULK_FILE_MAP) {
    const result = splitBulkFile(baseDir, mapping.glob, mapping.type, mapping.subdir);
    results.push(result);
  }

  return results;
}

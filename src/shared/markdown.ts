import { parse, stringify } from "yaml";

/** A parsed markdown document: YAML frontmatter + body. */
export interface MarkdownDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse a markdown string into frontmatter + body.
 *
 * Lives in `shared/` so every module (memory, extensions, migration) can use it
 * without a forbidden cross-module import (CLAUDE.md module-isolation rule).
 */
export function parseMarkdown(raw: string): MarkdownDocument {
  const trimmed = raw.trim();

  // Check if frontmatter exists (starts with ---)
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: trimmed };
  }

  // Find the closing --- delimiter
  const afterFirstDelimiter = trimmed.slice(3); // Remove opening ---
  const secondDelimiterIndex = afterFirstDelimiter.indexOf("---");

  if (secondDelimiterIndex === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const frontmatterRaw = afterFirstDelimiter
    .slice(0, secondDelimiterIndex)
    .trim();
  const body = afterFirstDelimiter.slice(secondDelimiterIndex + 3).trim();

  let frontmatter: Record<string, unknown> = {};
  if (frontmatterRaw) {
    try {
      const parsed = parse(frontmatterRaw);
      frontmatter = parsed || {};
    } catch {
      // If YAML parse fails, treat entire content as body
      return { frontmatter: {}, body: trimmed };
    }
  }

  return { frontmatter, body };
}

/** Serialize a markdown document back to a string with `---` delimiters. */
export function serializeMarkdown(doc: MarkdownDocument): string {
  const frontmatterStr = stringify(doc.frontmatter);
  const frontmatterTrimmed = frontmatterStr.trim();

  if (!frontmatterTrimmed || frontmatterTrimmed === "{}") {
    return doc.body;
  }

  return `---\n${frontmatterTrimmed}\n---\n\n${doc.body}`;
}

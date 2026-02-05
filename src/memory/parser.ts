import { parse, stringify } from "yaml";
import type { MarkdownDocument } from "./types.ts";

export function parseMarkdown(raw: string): MarkdownDocument {
  const trimmed = raw.trim();

  // Check if frontmatter exists (starts with ---)
  if (!trimmed.startsWith("---")) {
    // No frontmatter, entire content is body
    return {
      frontmatter: {},
      body: trimmed,
    };
  }

  // Find the closing --- delimiter
  const afterFirstDelimiter = trimmed.slice(3); // Remove opening ---
  const secondDelimiterIndex = afterFirstDelimiter.indexOf("---");

  if (secondDelimiterIndex === -1) {
    // No closing delimiter found, treat as body
    return {
      frontmatter: {},
      body: trimmed,
    };
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
      return {
        frontmatter: {},
        body: trimmed,
      };
    }
  }

  return {
    frontmatter,
    body,
  };
}

export function serializeMarkdown(doc: MarkdownDocument): string {
  const frontmatterStr = stringify(doc.frontmatter);
  const frontmatterTrimmed = frontmatterStr.trim();

  if (!frontmatterTrimmed || frontmatterTrimmed === "{}") {
    // No frontmatter, just body
    return doc.body;
  }

  // Combine with delimiters
  return `---\n${frontmatterTrimmed}\n---\n\n${doc.body}`;
}

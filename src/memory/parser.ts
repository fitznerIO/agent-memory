import type { MarkdownDocument } from "./types.ts";

export function parseMarkdown(_raw: string): MarkdownDocument {
  throw new Error("Not implemented");
}

export function serializeMarkdown(_doc: MarkdownDocument): string {
  throw new Error("Not implemented");
}

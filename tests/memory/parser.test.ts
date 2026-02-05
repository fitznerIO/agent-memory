import { describe, test } from "bun:test";

describe("Markdown Parser", () => {
  describe("parseMarkdown", () => {
    test.todo("parses YAML frontmatter and body", () => {});
    test.todo("handles document with no frontmatter", () => {});
    test.todo("handles empty body with frontmatter", () => {});
    test.todo("preserves frontmatter field types (strings, arrays, numbers)", () => {});
    test.todo("handles empty input", () => {});
  });

  describe("serializeMarkdown", () => {
    test.todo("serializes frontmatter and body into markdown string", () => {});
    test.todo("round-trips: parse then serialize returns equivalent content", () => {});
    test.todo("handles empty frontmatter object", () => {});
  });
});

import { describe, test, expect } from "bun:test";
import { parseMarkdown, serializeMarkdown } from "../../src/memory/parser.ts";

describe("Markdown Parser", () => {
  describe("parseMarkdown", () => {
    test("parses YAML frontmatter and body", () => {
      const input = `---
title: Test
type: semantic
tags: [test, important]
---

This is the body content.`;

      const result = parseMarkdown(input);
      expect(result.frontmatter.title).toBe("Test");
      expect(result.frontmatter.type).toBe("semantic");
      expect(Array.isArray(result.frontmatter.tags)).toBe(true);
      expect(result.body).toContain("This is the body content");
    });

    test("handles document with no frontmatter", () => {
      const input = "Just plain markdown content\nWith multiple lines";

      const result = parseMarkdown(input);
      expect(result.frontmatter).toEqual({});
      expect(result.body).toContain("Just plain markdown content");
    });

    test("handles empty body with frontmatter", () => {
      const input = `---
title: Empty Body
importance: high
---`;

      const result = parseMarkdown(input);
      expect(result.frontmatter.title).toBe("Empty Body");
      expect(result.body).toBe("");
    });

    test("preserves frontmatter field types (strings, arrays, numbers)", () => {
      const input = `---
stringField: hello
numberField: 42
arrayField: [a, b, c]
booleanField: true
---

Body`;

      const result = parseMarkdown(input);
      expect(typeof result.frontmatter.stringField).toBe("string");
      expect(typeof result.frontmatter.numberField).toBe("number");
      expect(Array.isArray(result.frontmatter.arrayField)).toBe(true);
      expect(typeof result.frontmatter.booleanField).toBe("boolean");
    });

    test("handles empty input", () => {
      const result = parseMarkdown("");
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe("");
    });
  });

  describe("serializeMarkdown", () => {
    test("serializes frontmatter and body into markdown string", () => {
      const input = {
        frontmatter: {
          title: "Test Title",
          type: "semantic",
          tags: ["a", "b"],
        },
        body: "Body content here",
      };

      const result = serializeMarkdown(input);
      expect(result).toContain("---");
      expect(result).toContain("title: Test Title");
      expect(result).toContain("type: semantic");
      expect(result).toContain("Body content here");
    });

    test("round-trips: parse then serialize returns equivalent content", () => {
      const original = `---
title: Round Trip
importance: high
tags: [test, verify]
source: memory
---

Round trip content
With multiple lines
And some structure`;

      const parsed = parseMarkdown(original);
      const serialized = serializeMarkdown(parsed);
      const reParsed = parseMarkdown(serialized);

      expect(reParsed.frontmatter.title).toBe(parsed.frontmatter.title);
      expect(reParsed.frontmatter.importance).toBe(parsed.frontmatter.importance);
      expect(reParsed.body).toBe(parsed.body);
    });

    test("handles empty frontmatter object", () => {
      const input = {
        frontmatter: {},
        body: "Just body content",
      };

      const result = serializeMarkdown(input);
      // With empty frontmatter, should just return body
      expect(result).toBe("Just body content");
    });
  });
});

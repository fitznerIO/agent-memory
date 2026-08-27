// Regression tests for two FTS5 query crashes (inc-005).
//
// Both used to throw "no such column: <token>" because a hyphen survived sanitizeFtsQuery() and
// reached FTS5, which reads `-token` as column-exclusion syntax. The old split regex
// /\b(\w+)-(\w+)\b/g missed chained hyphens and non-ASCII words.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSearchIndex } from "../../src/search/index.ts";
import type { SearchIndex } from "../../src/search/types.ts";
import type { MemoryConfig } from "../../src/shared/config.ts";
import type { Memory } from "../../src/shared/types.ts";

const DIMS = 384;

function makeConfig(sqlitePath: string): MemoryConfig {
  return {
    baseDir: "/tmp/agent-memory-test",
    sqlitePath,
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    embeddingDimensions: DIMS,
    hybridDefaults: {
      limit: 5,
      minScore: 0.0,
      weightFts: 0.3,
      weightVector: 0.5,
      weightRecency: 0.2,
      rrfK: 60,
    },
    maxCoreTokens: 4000,
  };
}

function makeMemory(id: string, content: string, title: string): Memory {
  const now = Date.now();
  return {
    metadata: {
      id,
      title,
      type: "episodic",
      tags: ["test"],
      importance: "medium",
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      source: "test",
    },
    content,
    filePath: `/memories/episodic/${id}.md`,
  };
}

describe("sanitizeFtsQuery — hyphen handling (inc-005)", () => {
  let tempDir: string;
  let idx: SearchIndex;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "fts-sanitize-"));
    idx = createSearchIndex(makeConfig(join(tempDir, "search.sqlite")));
    // Contains the date in hyphenated form, so the query's tokens (2026, 08, 27) all appear —
    // sanitizeFtsQuery joins the groups with AND.
    await idx.index(makeMemory("ep-001", "Tagesplan 2026-08-27 mit Notizen vom Tag", "Tagesplan"));
    await idx.index(makeMemory("ep-002", "Neustart und Übergabe der Sitzung", "Übergabe"));
  });

  afterEach(() => {
    try {
      idx.close();
    } catch {
      // already closed
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Repro 1: chained hyphens. The global match consumed "2026-08" and left "-27" intact.
  test("a date query does not throw", async () => {
    const results = await idx.searchText("Tagesplan 2026-08-27");
    expect(Array.isArray(results)).toBe(true);
    expect(results.some((r) => r.memory.metadata.id === "ep-001")).toBe(true);
  });

  // Repro 2: non-ASCII. \w and \b are ASCII-only without the u flag, so this never matched.
  test("an umlaut query with a hyphen does not throw", async () => {
    const results = await idx.searchText("NEUSTART-ÜBERGABE");
    expect(Array.isArray(results)).toBe(true);
    expect(results.some((r) => r.memory.metadata.id === "ep-002")).toBe(true);
  });

  // The same hole, one level deeper — not in the original report but the identical mechanism.
  test("more than two hyphenated segments do not throw", async () => {
    const results = await idx.searchText("a-b-c-d Tagesplan");
    expect(Array.isArray(results)).toBe(true);
  });

  test("plain hyphenated words still match both parts", async () => {
    // Both halves appear in ep-001 ("Tagesplan … Notizen"); dropping the hyphen must keep them
    // searchable as two tokens, which is what the old split regex did for the simple case.
    const results = await idx.searchText("Tagesplan-Notizen");
    expect(results.some((r) => r.memory.metadata.id === "ep-001")).toBe(true);
  });

  // Found while testing the fix above: the old blacklist let these through too, and both are
  // ordinary in German queries. Comma and semicolon are plain FTS5 syntax errors.
  test("punctuation inside a query does not throw", async () => {
    for (const q of [
      "Tagesplan, Notizen",
      "Tagesplan; Notizen",
      "Tagesplan — Notizen",
      "Kosten in €, 5°C, §3",
    ]) {
      const results = await idx.searchText(q);
      expect(Array.isArray(results)).toBe(true);
    }
    const results = await idx.searchText("Tagesplan, Notizen");
    expect(results.some((r) => r.memory.metadata.id === "ep-001")).toBe(true);
  });

  // The failure used to propagate out of searchHybrid() and kill the vector search with it.
  // searchText must degrade to an empty result instead of throwing, whatever it is handed.
  test("a query FTS5 cannot parse returns [] instead of throwing", async () => {
    for (const q of ['"unbalanced', "NEAR/", "col:*", "AND OR NOT"]) {
      const results = await idx.searchText(q);
      expect(Array.isArray(results)).toBe(true);
    }
  });
});

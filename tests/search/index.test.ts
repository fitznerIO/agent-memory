import { describe, test } from "bun:test";

describe("SearchIndex", () => {
  describe("index", () => {
    test.todo("indexes a memory into FTS and vector tables", () => {});
    test.todo("updates existing entry on re-index", () => {});
  });

  describe("remove", () => {
    test.todo("removes a memory from all index tables", () => {});
    test.todo("no-ops when removing non-existent id", () => {});
  });

  describe("searchText", () => {
    test.todo("finds memories by keyword using FTS5", () => {});
    test.todo("returns results ranked by BM25 score", () => {});
    test.todo("respects limit parameter", () => {});
    test.todo("returns empty array for no matches", () => {});
  });

  describe("searchVector", () => {
    test.todo("finds memories by vector similarity", () => {});
    test.todo("returns results ordered by cosine distance", () => {});
    test.todo("respects limit parameter", () => {});
  });

  describe("searchHybrid", () => {
    test.todo("combines FTS and vector results using RRF", () => {});
    test.todo("applies recency weighting", () => {});
    test.todo("filters results below minScore", () => {});
    test.todo("uses default options when none provided", () => {});
  });

  describe("rebuild", () => {
    test.todo("rebuilds index from scratch and returns stats", () => {});
  });

  describe("close", () => {
    test.todo("closes database connection cleanly", () => {});
  });
});

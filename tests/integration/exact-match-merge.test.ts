/**
 * Exact matches first survive the merge of project and global results in `search()`.
 *
 * Each store normalises its own scores, so the best candidate of each gets 1.0. Merged by score
 * alone, a global entry without the query word slipped back in front of a project entry that has
 * it whenever that entry was not also its store's top scorer — and the exact-first order from
 * searchHybrid was silently undone.
 *
 * The query embedding is replaced by a fixed vector and every entry is indexed with a synthetic
 * vector at a known distance, so no embedding model is loaded.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import type { Memory } from "../../src/shared/types.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const DIMS = 384;

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIMS; i++) v[i] = v[i]! / norm;
  return v;
}

const QUERY_VEC = normalize(
  (() => {
    const v = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) v[i] = Math.sin(i * 0.37) + 0.1;
    return v;
  })(),
);

const NOISE = normalize(
  (() => {
    const v = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) v[i] = Math.cos(i * 1.13) - 0.05;
    return v;
  })(),
);

function vectorAtDistance(distance: number): Float32Array {
  const v = new Float32Array(DIMS);
  const t = distance * 0.12;
  for (let i = 0; i < DIMS; i++) v[i] = QUERY_VEC[i]! + t * NOISE[i]!;
  return normalize(v);
}

const FIXED_TIME = Date.UTC(2026, 0, 15);

function makeMemory(
  id: string,
  content: string,
  distance: number,
): Memory & { embedding: Float32Array } {
  return {
    metadata: {
      id,
      title: `Memory ${id}`,
      type: "semantic",
      tags: ["test"],
      importance: "medium",
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
      lastAccessedAt: FIXED_TIME,
      source: "test",
    },
    content,
    filePath: `semantic/${id}.md`,
    embedding: vectorAtDistance(distance),
  };
}

describe("search(): exact matches first across project and global store", () => {
  let projectDir: string;
  let globalDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    projectDir = await createTempDir();
    globalDir = await createTempDir();
    const projectMemory = join(projectDir, ".agent-memory");
    const globalMemory = join(globalDir, ".agent-memory");
    system = createMemorySystem({
      baseDir: projectMemory,
      sqlitePath: join(projectMemory, ".index", "search.sqlite"),
      globalDir: globalMemory,
      globalSqlitePath: join(globalMemory, ".index", "search.sqlite"),
    });
    await system.start();

    system.embedding.embed = async (text: string) => ({
      text,
      vector: QUERY_VEC,
      dimensions: DIMS,
    });

    // Project: the name sits outside the vector pool (limit 5 → pool 15), so a filler that is the
    // closest neighbour outscores it and the project's 1.0 goes to an entry without the name.
    for (let i = 0; i < 16; i++) {
      await system.searchIndex.index(
        makeMemory(`project-filler-${i}`, `project filler note ${i}`, i),
      );
    }
    await system.searchIndex.index(
      makeMemory("project-name", "Meeting with Quillfeather on Monday", 20),
    );

    // Global: one entry without the name — alone in its store, so it scores 1.0.
    await system.globalSearchIndex!.index(
      makeMemory("global-other", "general notes about meetings", 0),
    );
  });

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // may fail if already stopped
    }
    await cleanupTempDir(projectDir);
    await cleanupTempDir(globalDir);
  });

  test("the project entry with the name comes before a global entry scoring 1.0", async () => {
    const out = await system.search({
      query: "Quillfeather",
      limit: 5,
      minScore: 0,
    });

    const first = out.results[0]!;
    expect(first.id).toBe("project-name");
    expect(first.exactMatch).toBe(true);
    expect(first.score).toBeLessThan(1);

    const global = out.results.find((r) => r.id === "global-other");
    expect(global?.storeSource).toBe("global");
    expect(global?.score).toBe(1);
    expect(global?.exactMatch).toBe(false);
    expect(out.results.slice(1).every((r) => r.exactMatch === false)).toBe(
      true,
    );
  });
});

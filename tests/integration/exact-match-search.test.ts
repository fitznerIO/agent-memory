/**
 * Exact matches first on the whole `search()` path: project and global store merged, tag and
 * connection filters, the same id in both stores.
 *
 * Each store normalises its own scores, so the best candidate of each gets 1.0. Merged by score
 * alone, a global entry without the query word slipped back in front of a project entry that has
 * it whenever that entry was not also its store's top scorer — and the exact-first order from
 * searchHybrid was silently undone. A filtered search cut its list before filtering, so exact
 * matches outside the filter could take every slot and the search came back empty.
 *
 * The query embedding is replaced by a fixed vector and every entry is indexed with a synthetic
 * vector at a known distance, so no embedding model is loaded.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import type { SearchIndex } from "../../src/search/types.ts";
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
  tags: string[] = ["test"],
): Memory & { embedding: Float32Array } {
  return {
    metadata: {
      id,
      title: `Memory ${id}`,
      type: "semantic",
      tags,
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

/** Index an entry together with its knowledge row and tags, so tag filters can see it. */
async function addTagged(
  index: SearchIndex,
  id: string,
  content: string,
  distance: number,
  tags: string[],
) {
  await index.index(makeMemory(id, content, distance, tags));
  const iso = new Date(FIXED_TIME).toISOString();
  await index.indexKnowledge({
    id,
    title: `Memory ${id}`,
    type: "semantic" as never,
    filePath: `semantic/${id}.md`,
    createdAt: iso,
    updatedAt: iso,
    accessCount: 0,
    tags,
  });
  await index.insertTags(id, tags);
}

describe("search(): exact matches first", () => {
  const dirs: string[] = [];
  let system: MemorySystem;

  async function start(withGlobal: boolean) {
    const projectDir = await createTempDir();
    const globalDir = await createTempDir();
    dirs.push(projectDir, globalDir);
    const projectMemory = join(projectDir, ".agent-memory");
    const globalMemory = join(globalDir, ".agent-memory");
    system = createMemorySystem({
      baseDir: projectMemory,
      sqlitePath: join(projectMemory, ".index", "search.sqlite"),
      ...(withGlobal
        ? {
            globalDir: globalMemory,
            globalSqlitePath: join(globalMemory, ".index", "search.sqlite"),
          }
        : {}),
    });
    await system.start();
    system.embedding.embed = async (text: string) => ({
      text,
      vector: QUERY_VEC,
      dimensions: DIMS,
    });
  }

  afterEach(async () => {
    try {
      await system.stop();
    } catch {
      // may fail if already stopped
    }
    for (const dir of dirs.splice(0)) await cleanupTempDir(dir);
  });

  /**
   * Project: 16 fillers at distances 0–15 and the name at 20, outside the vector pool (limit 5 →
   * pool 15) — so the closest filler outscores it and the project's 1.0 goes to an entry
   * without the name.
   */
  async function indexProjectWithName() {
    for (let i = 0; i < 16; i++) {
      await system.searchIndex.index(
        makeMemory(`project-filler-${i}`, `project filler note ${i}`, i),
      );
    }
    await system.searchIndex.index(
      makeMemory("project-name", "Meeting with Quillfeather on Monday", 20),
    );
  }

  test("the project entry with the name comes before a global entry scoring 1.0", async () => {
    await start(true);
    await indexProjectWithName();
    // Global: one entry without the name — alone in its store, so it scores 1.0.
    await system.globalSearchIndex!.index(
      makeMemory("global-other", "general notes about meetings", 0),
    );

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

  // Ids are numbered per store, so the same id can name two different entries. Keeping the
  // project copy regardless dropped the only one that contains the query.
  test("with the same id in both stores, the copy that contains the query is kept", async () => {
    await start(true);
    await indexProjectWithName();
    await system.globalSearchIndex!.index(
      makeMemory("project-filler-3", "Quillfeather signed the lease", 0),
    );

    const out = await system.search({
      query: "Quillfeather",
      limit: 5,
      minScore: 0,
    });

    const twins = out.results.filter((r) => r.id === "project-filler-3");
    expect(twins).toHaveLength(1);
    expect(twins[0]!.storeSource).toBe("global");
    expect(twins[0]!.exactMatch).toBe(true);
    expect(out.results.slice(0, 2).every((r) => r.exactMatch)).toBe(true);
  });

  // 30 untagged entries contain the word; the tagged ones are its nearest vector neighbours and
  // do not. Filtered after the cut (limit 5 → 25 kept), the exact matches took all 25 slots and
  // the tagged entries never reached the filter.
  test("a tag filter still finds its entries when many entries outside it contain the word", async () => {
    await start(false);
    for (let i = 0; i < 30; i++) {
      await addTagged(
        system.searchIndex,
        `other-${i}`,
        `Quillfeather note number ${i}`,
        20 + i,
        ["other"],
      );
    }
    for (let i = 0; i < 3; i++) {
      await addTagged(
        system.searchIndex,
        `scoped-${i}`,
        `project meeting summary ${i}`,
        i,
        ["proj/x"],
      );
    }
    await addTagged(
      system.searchIndex,
      "scoped-name",
      "Quillfeather joined the project",
      60,
      ["proj/x"],
    );

    const out = await system.search({
      query: "Quillfeather",
      limit: 5,
      tags: ["proj/x"],
    });

    expect(out.results.map((r) => r.id)).toEqual([
      "scoped-name",
      "scoped-0",
      "scoped-1",
      "scoped-2",
    ]);
    expect(out.results[0]!.exactMatch).toBe(true);
  });

  test("tag and connection filter together: an entry must pass both", async () => {
    await start(false);
    for (let i = 0; i < 30; i++) {
      await addTagged(
        system.searchIndex,
        `other-${i}`,
        `Quillfeather note number ${i}`,
        20 + i,
        ["other"],
      );
    }
    await addTagged(system.searchIndex, "hub", "the hub entry", 70, ["hub"]);
    await addTagged(system.searchIndex, "both", "tagged and linked", 0, [
      "proj/x",
    ]);
    await addTagged(system.searchIndex, "tag-only", "tagged, not linked", 1, [
      "proj/x",
    ]);
    await addTagged(system.searchIndex, "link-only", "linked, not tagged", 2, [
      "misc",
    ]);
    await system.searchIndex.insertConnection("hub", "both", "related");
    await system.searchIndex.insertConnection("hub", "link-only", "related");

    const out = await system.search({
      query: "Quillfeather",
      limit: 5,
      tags: ["proj/x"],
      connected_to: "hub",
    });

    expect(out.results.map((r) => r.id)).toEqual(["both"]);
  });
});

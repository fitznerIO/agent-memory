/**
 * Exact matches first on the whole `search()` path: project and global store merged, tag and
 * connection filters, the extension facade.
 *
 * Each store normalises its own scores, so the best candidate of each gets 1.0; merged by score
 * alone, a global entry without the query word would slip back in front of a project entry that
 * has it. A filter applied after the list is cut lets entries outside it take its places — with
 * exact matches moved up, often all of them.
 *
 * The query embedding is replaced by a fixed vector and every entry is indexed with a synthetic
 * vector at a known distance, so no embedding model is loaded.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemoryApi } from "../../src/extensions/facade.ts";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import type { SearchIndex } from "../../src/search/types.ts";
import type { Memory } from "../../src/shared/types.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";
import {
  DIMS,
  FIXED_TIME,
  QUERY_VEC,
  vectorAtDistance,
} from "../helpers/synthetic-vectors.ts";

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

/** Index an entry with its knowledge row and tags, so tag filters and enrichment can see it. */
async function add(
  index: SearchIndex,
  id: string,
  content: string,
  distance: number,
  tags: string[] = ["test"],
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
  async function addProjectWithName() {
    for (let i = 0; i < 16; i++) {
      await add(
        system.searchIndex,
        `project-filler-${i}`,
        `filler note ${i}`,
        i,
      );
    }
    await add(
      system.searchIndex,
      "project-name",
      "Meeting with Quillfeather on Monday",
      20,
    );
  }

  test("the project entry with the name comes before a global entry scoring 1.0", async () => {
    await start(true);
    await addProjectWithName();
    // Global: one entry without the name — alone in its store, so it scores 1.0.
    await add(
      system.globalSearchIndex!,
      "global-other",
      "general notes about meetings",
      0,
    );

    const out = await system.search({
      query: "Quillfeather",
      limit: 5,
      minScore: 0,
    });

    expect(out.results[0]!.id).toBe("project-name");
    expect(out.results[0]!.exactMatch).toBe(true);
    expect(out.results[0]!.score).toBeLessThan(1);
    const global = out.results.find((r) => r.id === "global-other");
    expect(global?.storeSource).toBe("global");
    expect(global?.score).toBe(1);
    expect(out.results.slice(1).every((r) => !r.exactMatch)).toBe(true);

    // The extension facade passes the flag and the order through.
    const hits = await createMemoryApi(system).search("Quillfeather", {
      limit: 5,
    });
    expect(hits[0]!.id).toBe("project-name");
    expect(hits[0]!.exactMatch).toBe(true);
  });

  // Ids are numbered per store, so the same id can name two different entries. As before, the
  // project copy is kept — merge and enrichment go by id, and mixing the two stores would pair
  // one entry's text with the other's title and tags.
  test("with the same id in both stores the project copy is kept, as before", async () => {
    await start(true);
    await addProjectWithName();
    await add(
      system.globalSearchIndex!,
      "project-filler-3",
      "Quillfeather signed the lease",
      0,
    );

    const out = await system.search({
      query: "Quillfeather",
      limit: 5,
      minScore: 0,
    });

    const twins = out.results.filter((r) => r.id === "project-filler-3");
    expect(twins).toHaveLength(1);
    expect(twins[0]!.storeSource).toBe("project");
    expect(twins[0]!.content).toBe("filler note 3");
  });

  // 30 entries outside the tag contain the word; the tagged ones are its nearest vector
  // neighbours and do not. Filtered after the cut (limit 5 → 25 kept), the exact matches took all
  // 25 places and the tagged entries never reached the filter.
  test("a tag filter still finds its entries when many entries outside it contain the word", async () => {
    await start(true);
    for (let i = 0; i < 30; i++) {
      await add(
        system.searchIndex,
        `other-${i}`,
        `Quillfeather note number ${i}`,
        20 + i,
        ["other"],
      );
    }
    for (let i = 0; i < 3; i++) {
      await add(
        system.searchIndex,
        `scoped-${i}`,
        `project meeting summary ${i}`,
        i,
        ["proj/x"],
      );
    }
    await add(
      system.searchIndex,
      "scoped-name",
      "Quillfeather joined the project",
      60,
      ["proj/x"],
    );
    // An exact match in the global store, outside the filter.
    await add(
      system.globalSearchIndex!,
      "global-name",
      "Quillfeather in the global store",
      0,
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
      await add(
        system.searchIndex,
        `other-${i}`,
        `Quillfeather note number ${i}`,
        20 + i,
        ["other"],
      );
    }
    await add(system.searchIndex, "hub", "the hub entry", 70, ["hub"]);
    await add(system.searchIndex, "both", "tagged and linked", 0, ["proj/x"]);
    await add(system.searchIndex, "tag-only", "tagged, not linked", 1, [
      "proj/x",
    ]);
    await add(system.searchIndex, "link-only", "linked, not tagged", 2, [
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

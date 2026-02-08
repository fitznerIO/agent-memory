import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { parseMarkdown } from "../../src/memory/parser.ts";
import {
  cleanupTempDir,
  createTempDir,
} from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

describe("v2-lite Tools Integration", () => {
  let tempDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
    });
    await system.start();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // may fail if already stopped
    }
    await cleanupTempDir(tempDir);
  }, TEST_TIMEOUT);

  // -------------------------------------------------------------------------
  // memoryStore
  // -------------------------------------------------------------------------

  describe("memoryStore", () => {
    test(
      "creates a markdown file with correct frontmatter",
      async () => {
        const result = await system.memoryStore({
          title: "Use Repository Pattern",
          type: "decision",
          content: "We decided to use the repository pattern for data access.",
          tags: ["architecture", "patterns"],
        });

        expect(result.id).toMatch(/^dec-\d{3}$/);
        expect(result.file_path).toContain("semantic/decisions/");
        expect(result.file_path).toEndWith(".md");

        // Verify the file exists on disk
        const absPath = join(tempDir, result.file_path);
        expect(existsSync(absPath)).toBe(true);

        // Parse and verify frontmatter
        const raw = readFileSync(absPath, "utf-8");
        const doc = parseMarkdown(raw);

        expect(doc.frontmatter.id).toBe(result.id);
        expect(doc.frontmatter.title).toBe("Use Repository Pattern");
        expect(doc.frontmatter.type).toBe("decision");
        expect(doc.frontmatter.tags).toEqual(["architecture", "patterns"]);
        expect(doc.frontmatter.created).toBeDefined();
        expect(doc.frontmatter.updated).toBeDefined();
        expect(doc.frontmatter.connections).toEqual([]);

        // Verify body content
        expect(doc.body).toBe(
          "We decided to use the repository pattern for data access.",
        );
      },
      TEST_TIMEOUT,
    );

    test(
      "generates sequential IDs per type",
      async () => {
        // Create two decisions
        const dec1 = await system.memoryStore({
          title: "Sequential Decision One",
          type: "decision",
          content: "First sequential decision.",
        });

        const dec2 = await system.memoryStore({
          title: "Sequential Decision Two",
          type: "decision",
          content: "Second sequential decision.",
        });

        // Create an incident (different type, separate counter)
        const inc1 = await system.memoryStore({
          title: "Server Outage",
          type: "incident",
          content: "The production server went down at 3am.",
        });

        // Decision IDs should be sequential
        const decNum1 = Number.parseInt(dec1.id.split("-")[1] ?? "0", 10);
        const decNum2 = Number.parseInt(dec2.id.split("-")[1] ?? "0", 10);
        expect(decNum2).toBe(decNum1 + 1);

        // Incident starts its own sequence
        expect(inc1.id).toMatch(/^inc-\d{3}$/);
      },
      TEST_TIMEOUT,
    );

    test(
      "writes file to correct directory per type",
      async () => {
        const typeToDir: Record<string, string> = {
          decision: "semantic/decisions",
          incident: "episodic/incidents",
          entity: "semantic/entities",
          pattern: "procedural/patterns",
          workflow: "procedural/workflows",
          note: "semantic/notes",
        };

        for (const [type, expectedDir] of Object.entries(typeToDir)) {
          const result = await system.memoryStore({
            title: `Test ${type}`,
            type: type as any,
            content: `Content for ${type} entry.`,
          });

          expect(result.file_path).toContain(expectedDir);
          const absPath = join(tempDir, result.file_path);
          expect(existsSync(absPath)).toBe(true);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "indexes entry in knowledge table",
      async () => {
        const result = await system.memoryStore({
          title: "Knowledge Table Test",
          type: "entity",
          content: "This entry should appear in the knowledge table.",
          tags: ["indexing"],
        });

        const entry = await system.searchIndex.getKnowledgeById(result.id);
        expect(entry).not.toBeNull();
        expect(entry!.id).toBe(result.id);
        expect(entry!.title).toBe("Knowledge Table Test");
        expect(entry!.type).toBe("entity");
        expect(entry!.filePath).toBe(result.file_path);
        expect(entry!.accessCount).toBe(0);
      },
      TEST_TIMEOUT,
    );

    test(
      "indexes entry in memories table for v1 compatibility",
      async () => {
        const result = await system.memoryStore({
          title: "V1 Compat Test",
          type: "decision",
          content:
            "This entry about quantum computing memory compatibility should be searchable via v1 hybrid search.",
        });

        // Search via the v1 search tool to confirm it is indexed
        const searchResult = await system.search({
          query: "quantum computing memory compatibility",
          limit: 5,
          minScore: 0.0,
        });

        const found = searchResult.results.find((r) =>
          r.content.includes("quantum computing memory compatibility"),
        );
        expect(found).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "inserts tags in entry_tags",
      async () => {
        const result = await system.memoryStore({
          title: "Tagged Entry",
          type: "pattern",
          content: "A pattern with specific tags.",
          tags: ["TypeScript", "Testing", "bun"],
        });

        const tags = await system.searchIndex.getTagsByEntryId(result.id);
        // Tags should be lowercased
        expect(tags).toContain("typescript");
        expect(tags).toContain("testing");
        expect(tags).toContain("bun");
        expect(tags.length).toBe(3);
      },
      TEST_TIMEOUT,
    );

    test(
      "returns suggested_connections (best-effort, may be empty)",
      async () => {
        const result = await system.memoryStore({
          title: "Suggestion Test",
          type: "note",
          content: "Testing connection suggestions.",
        });

        // suggested_connections should be an array (may be empty)
        expect(Array.isArray(result.suggested_connections)).toBe(true);

        // If there are suggestions, verify their shape
        for (const suggestion of result.suggested_connections) {
          expect(typeof suggestion.id).toBe("string");
          expect(typeof suggestion.title).toBe("string");
          expect(typeof suggestion.relevance).toBe("number");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "returns existing_tags",
      async () => {
        // We already stored entries with tags above
        const result = await system.memoryStore({
          title: "Existing Tags Check",
          type: "note",
          content: "Should list existing tags.",
          tags: ["newtag"],
        });

        expect(Array.isArray(result.existing_tags)).toBe(true);
        // Should include tags from previous entries
        expect(result.existing_tags).toContain("newtag");
      },
      TEST_TIMEOUT,
    );

    test(
      "handles connections provided in input",
      async () => {
        // Create a target entry first
        const target = await system.memoryStore({
          title: "Connection Target",
          type: "entity",
          content: "This is the target entity.",
        });

        // Create a source entry with a connection to the target
        const source = await system.memoryStore({
          title: "Connection Source",
          type: "decision",
          content: "This decision builds on the target entity.",
          connections: [
            {
              target: target.id,
              type: "builds_on",
              note: "Decision depends on entity",
            },
          ],
        });

        // Verify the connection was created in the source file frontmatter
        const sourceAbs = join(tempDir, source.file_path);
        const sourceDoc = parseMarkdown(readFileSync(sourceAbs, "utf-8"));
        const sourceConns = sourceDoc.frontmatter.connections as Array<
          Record<string, unknown>
        >;
        expect(sourceConns.length).toBeGreaterThanOrEqual(1);
        const fwdConn = sourceConns.find((c) => c.target === target.id);
        expect(fwdConn).toBeDefined();
        expect(fwdConn!.type).toBe("builds_on");

        // Verify inverse connection was added to target file frontmatter
        const targetAbs = join(tempDir, target.file_path);
        const targetDoc = parseMarkdown(readFileSync(targetAbs, "utf-8"));
        const targetConns = targetDoc.frontmatter.connections as Array<
          Record<string, unknown>
        >;
        const invConn = targetConns.find((c) => c.target === source.id);
        expect(invConn).toBeDefined();
        expect(invConn!.type).toBe("extended_by");

        // Verify SQLite has both connections
        const outgoing = await system.searchIndex.getConnections(
          source.id,
          "outgoing",
        );
        expect(outgoing.some((c) => c.target_id === target.id)).toBe(true);

        const incoming = await system.searchIndex.getConnections(
          target.id,
          "incoming",
        );
        expect(incoming.some((c) => c.source_id === source.id)).toBe(true);
      },
      TEST_TIMEOUT,
    );
  });

  // -------------------------------------------------------------------------
  // memoryConnect
  // -------------------------------------------------------------------------

  describe("memoryConnect", () => {
    let entryA: { id: string; file_path: string };
    let entryB: { id: string; file_path: string };

    beforeAll(async () => {
      entryA = await system.memoryStore({
        title: "Connect Entry A",
        type: "pattern",
        content: "Entry A for connection tests.",
      });

      entryB = await system.memoryStore({
        title: "Connect Entry B",
        type: "workflow",
        content: "Entry B for connection tests.",
      });
    }, TEST_TIMEOUT);

    test(
      "creates forward connection in SQLite",
      async () => {
        await system.memoryConnect({
          source_id: entryA.id,
          target_id: entryB.id,
          type: "related",
          note: "A is related to B",
        });

        const outgoing = await system.searchIndex.getConnections(
          entryA.id,
          "outgoing",
        );
        const fwd = outgoing.find((c) => c.target_id === entryB.id);
        expect(fwd).toBeDefined();
        expect(fwd!.type).toBe("related");
        expect(fwd!.note).toBe("A is related to B");
      },
      TEST_TIMEOUT,
    );

    test(
      "creates inverse connection in SQLite",
      async () => {
        // The inverse was already created by the memoryConnect call above
        const incoming = await system.searchIndex.getConnections(
          entryB.id,
          "incoming",
        );
        const inv = incoming.find((c) => c.source_id === entryB.id);
        // Actually, inverse is stored as B -> A
        const invFromB = await system.searchIndex.getConnections(
          entryB.id,
          "outgoing",
        );
        const invConn = invFromB.find((c) => c.target_id === entryA.id);
        expect(invConn).toBeDefined();
        expect(invConn!.type).toBe("related"); // related is self-inverse
      },
      TEST_TIMEOUT,
    );

    test(
      "updates source file frontmatter",
      async () => {
        const absPath = join(tempDir, entryA.file_path);
        const doc = parseMarkdown(readFileSync(absPath, "utf-8"));
        const conns = doc.frontmatter.connections as Array<
          Record<string, unknown>
        >;
        const conn = conns.find((c) => c.target === entryB.id);
        expect(conn).toBeDefined();
        expect(conn!.type).toBe("related");
      },
      TEST_TIMEOUT,
    );

    test(
      "updates target file frontmatter",
      async () => {
        const absPath = join(tempDir, entryB.file_path);
        const doc = parseMarkdown(readFileSync(absPath, "utf-8"));
        const conns = doc.frontmatter.connections as Array<
          Record<string, unknown>
        >;
        const conn = conns.find((c) => c.target === entryA.id);
        expect(conn).toBeDefined();
        expect(conn!.type).toBe("related"); // related is self-inverse
      },
      TEST_TIMEOUT,
    );

    test(
      "returns correct inverse_type for all connection types",
      async () => {
        const pairs: Array<{
          type: "related" | "builds_on" | "contradicts" | "part_of" | "supersedes";
          expectedInverse: string;
        }> = [
          { type: "related", expectedInverse: "related" },
          { type: "builds_on", expectedInverse: "extended_by" },
          { type: "contradicts", expectedInverse: "contradicts" },
          { type: "part_of", expectedInverse: "contains" },
          { type: "supersedes", expectedInverse: "superseded_by" },
        ];

        for (const { type, expectedInverse } of pairs) {
          // Create fresh entries for each pair to avoid conflicts
          const src = await system.memoryStore({
            title: `Inverse Src ${type}`,
            type: "note",
            content: `Source for ${type} inverse test.`,
          });
          const tgt = await system.memoryStore({
            title: `Inverse Tgt ${type}`,
            type: "note",
            content: `Target for ${type} inverse test.`,
          });

          const result = await system.memoryConnect({
            source_id: src.id,
            target_id: tgt.id,
            type,
          });

          expect(result.success).toBe(true);
          expect(result.inverse_type).toBe(expectedInverse);
        }
      },
      TEST_TIMEOUT,
    );
  });

  // -------------------------------------------------------------------------
  // memoryTraverse
  // -------------------------------------------------------------------------

  describe("memoryTraverse", () => {
    let nodeA: { id: string; file_path: string };
    let nodeB: { id: string; file_path: string };
    let nodeC: { id: string; file_path: string };

    beforeAll(async () => {
      // Build a small graph: A --builds_on--> B --related--> C
      nodeA = await system.memoryStore({
        title: "Traverse Node A",
        type: "decision",
        content: "Node A for traversal tests.",
      });

      nodeB = await system.memoryStore({
        title: "Traverse Node B",
        type: "pattern",
        content: "Node B for traversal tests.",
      });

      nodeC = await system.memoryStore({
        title: "Traverse Node C",
        type: "entity",
        content: "Node C for traversal tests.",
      });

      // A -> B (builds_on)
      await system.memoryConnect({
        source_id: nodeA.id,
        target_id: nodeB.id,
        type: "builds_on",
      });

      // B -> C (related)
      await system.memoryConnect({
        source_id: nodeB.id,
        target_id: nodeC.id,
        type: "related",
      });
    }, TEST_TIMEOUT);

    test(
      "traverses outgoing connections",
      async () => {
        const result = await system.memoryTraverse({
          start_id: nodeA.id,
          direction: "outgoing",
          depth: 1,
        });

        // A has one outgoing connection: A -> B (builds_on)
        expect(result.results.length).toBeGreaterThanOrEqual(1);
        const foundB = result.results.find((r) => r.id === nodeB.id);
        expect(foundB).toBeDefined();
        expect(foundB!.title).toBe("Traverse Node B");
        expect(foundB!.connection_type).toBe("builds_on");
        expect(foundB!.distance).toBe(1);

        // Should NOT include C at depth 1
        const foundC = result.results.find((r) => r.id === nodeC.id);
        expect(foundC).toBeUndefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "traverses incoming connections",
      async () => {
        const result = await system.memoryTraverse({
          start_id: nodeB.id,
          direction: "incoming",
          depth: 1,
        });

        // B has an incoming connection from A (builds_on) and
        // the inverse from C (related, since B -> C creates C -> B inverse)
        const foundA = result.results.find((r) => r.id === nodeA.id);
        expect(foundA).toBeDefined();
        expect(foundA!.distance).toBe(1);
      },
      TEST_TIMEOUT,
    );

    test(
      "traverses both directions",
      async () => {
        const result = await system.memoryTraverse({
          start_id: nodeB.id,
          direction: "both",
          depth: 1,
        });

        // B connects to A (incoming builds_on) and C (outgoing related)
        // Plus inverse connections
        const ids = result.results.map((r) => r.id);
        expect(ids).toContain(nodeA.id);
        expect(ids).toContain(nodeC.id);
      },
      TEST_TIMEOUT,
    );

    test(
      "respects depth limit (default 1, max 2)",
      async () => {
        // Depth 1 from A: should only reach B
        const depth1 = await system.memoryTraverse({
          start_id: nodeA.id,
          direction: "outgoing",
        });
        const depth1Ids = depth1.results.map((r) => r.id);
        expect(depth1Ids).toContain(nodeB.id);
        expect(depth1Ids).not.toContain(nodeC.id);

        // Depth 2 from A: should reach B and C
        const depth2 = await system.memoryTraverse({
          start_id: nodeA.id,
          direction: "outgoing",
          depth: 2,
        });
        const depth2Ids = depth2.results.map((r) => r.id);
        expect(depth2Ids).toContain(nodeB.id);
        expect(depth2Ids).toContain(nodeC.id);

        // Verify C is at distance 2
        const cEntry = depth2.results.find((r) => r.id === nodeC.id);
        expect(cEntry).toBeDefined();
        expect(cEntry!.distance).toBe(2);

        // Depth > 2 should be clamped to 2
        const depth5 = await system.memoryTraverse({
          start_id: nodeA.id,
          direction: "outgoing",
          depth: 5,
        });
        // Should not traverse beyond depth 2
        for (const r of depth5.results) {
          expect(r.distance).toBeLessThanOrEqual(2);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "filters by connection type",
      async () => {
        // From A outgoing, only "related" connections (A -> B is builds_on, so nothing)
        const filtered = await system.memoryTraverse({
          start_id: nodeA.id,
          direction: "outgoing",
          types: ["related"],
          depth: 1,
        });

        // A -> B is "builds_on", not "related", so B should NOT appear
        const foundB = filtered.results.find((r) => r.id === nodeB.id);
        expect(foundB).toBeUndefined();

        // Now filter for builds_on: should find B
        const buildsOn = await system.memoryTraverse({
          start_id: nodeA.id,
          direction: "outgoing",
          types: ["builds_on"],
          depth: 1,
        });
        const foundB2 = buildsOn.results.find((r) => r.id === nodeB.id);
        expect(foundB2).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "returns correct distance values",
      async () => {
        const result = await system.memoryTraverse({
          start_id: nodeA.id,
          direction: "outgoing",
          depth: 2,
        });

        // B should be at distance 1
        const bEntry = result.results.find((r) => r.id === nodeB.id);
        expect(bEntry).toBeDefined();
        expect(bEntry!.distance).toBe(1);

        // C should be at distance 2
        const cEntry = result.results.find((r) => r.id === nodeC.id);
        expect(cEntry).toBeDefined();
        expect(cEntry!.distance).toBe(2);
      },
      TEST_TIMEOUT,
    );
  });
});

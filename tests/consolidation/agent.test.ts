import { describe, expect, test } from "bun:test";
import { createConsolidationAgent } from "../../src/consolidation/agent.ts";
import type { ExistingEntry, SessionNoteInput } from "../../src/consolidation/types.ts";

const agent = createConsolidationAgent();

describe("ConsolidationAgent", () => {
  // -- categorize -------------------------------------------------------------

  describe("categorize", () => {
    test("detects decisions by keyword patterns", () => {
      expect(
        agent.categorize(
          "We decided to use Bun because it is faster than Node.js for our use case",
          "semantic",
        ),
      ).toBe("decision");
    });

    test("detects incidents by keyword patterns", () => {
      expect(
        agent.categorize(
          "The SSL certificate expired causing a crash. We fixed it by renewing.",
          "episodic",
        ),
      ).toBe("incident");
    });

    test("detects workflows by keyword patterns", () => {
      expect(
        agent.categorize(
          "How to deploy: 1. Build the project 2. Run tests 3. Push to production",
          "procedural",
        ),
      ).toBe("workflow");
    });

    test("detects facts from short preference statements", () => {
      expect(
        agent.categorize("User prefers dark mode", "semantic"),
      ).toBe("fact");
    });

    test("respects pre-typed decision notes", () => {
      expect(agent.categorize("Some content", "decision")).toBe("decision");
    });

    test("respects pre-typed incident notes", () => {
      expect(agent.categorize("Some content", "incident")).toBe("incident");
    });

    test("falls back to note for ambiguous content", () => {
      expect(
        agent.categorize(
          "Today I learned about functional programming and monads. They are interesting abstractions.",
          "semantic",
        ),
      ).toBe("note");
    });
  });

  // -- categoryToKnowledgeType ------------------------------------------------

  describe("categoryToKnowledgeType", () => {
    test("maps decision to decision", () => {
      expect(agent.categoryToKnowledgeType("decision")).toBe("decision");
    });

    test("maps incident to incident", () => {
      expect(agent.categoryToKnowledgeType("incident")).toBe("incident");
    });

    test("maps workflow to workflow", () => {
      expect(agent.categoryToKnowledgeType("workflow")).toBe("workflow");
    });

    test("maps fact to null (appended to entity)", () => {
      expect(agent.categoryToKnowledgeType("fact")).toBeNull();
    });

    test("maps note to note", () => {
      expect(agent.categoryToKnowledgeType("note")).toBe("note");
    });
  });

  // -- generateTitle ----------------------------------------------------------

  describe("generateTitle", () => {
    test("extracts first line as title", () => {
      expect(agent.generateTitle("Use Bun for runtime\nBecause speed.")).toBe(
        "Use Bun for runtime",
      );
    });

    test("strips markdown headers", () => {
      expect(agent.generateTitle("## My Decision\nDetails")).toBe(
        "My Decision",
      );
    });

    test("truncates long titles", () => {
      const long = "A".repeat(100);
      const title = agent.generateTitle(long);
      expect(title.length).toBeLessThanOrEqual(80);
      expect(title.endsWith("...")).toBe(true);
    });

    test("returns Untitled for empty content", () => {
      expect(agent.generateTitle("")).toBe("Untitled");
    });
  });

  // -- normalizeTags ----------------------------------------------------------

  describe("normalizeTags", () => {
    test("lowercases all tags", () => {
      expect(agent.normalizeTags(["Tech/AI", "BUSINESS/Clients"])).toEqual([
        "business/clients",
        "tech/ai",
      ]);
    });

    test("removes duplicates", () => {
      expect(agent.normalizeTags(["tech/ai", "tech/AI", "tech/ai"])).toEqual([
        "tech/ai",
      ]);
    });

    test("removes trailing slashes", () => {
      expect(agent.normalizeTags(["tech/ai/", "business/"])).toEqual([
        "business",
        "tech/ai",
      ]);
    });

    test("replaces spaces with hyphens", () => {
      expect(agent.normalizeTags(["tech/my tool"])).toEqual(["tech/my-tool"]);
    });

    test("filters empty tags", () => {
      expect(agent.normalizeTags(["", "tech/ai", "  "])).toEqual(["tech/ai"]);
    });

    test("sorts alphabetically", () => {
      expect(agent.normalizeTags(["z-tag", "a-tag", "m-tag"])).toEqual([
        "a-tag",
        "m-tag",
        "z-tag",
      ]);
    });
  });

  // -- findDuplicate ----------------------------------------------------------

  describe("findDuplicate", () => {
    const entries: ExistingEntry[] = [
      {
        id: "dec-001",
        title: "Use Bun",
        content: "We decided to use Bun runtime because of speed and DX.",
        type: "decision",
        tags: ["tech/bun"],
      },
      {
        id: "inc-001",
        title: "SSL issue",
        content: "SSL certificate expired causing downtime on production servers.",
        type: "incident",
        tags: [],
      },
    ];

    test("finds duplicate when content is very similar", () => {
      const dup = agent.findDuplicate(
        "We decided to use Bun runtime because of the speed and DX benefits.",
        entries,
      );
      expect(dup).not.toBeNull();
      expect(dup!.id).toBe("dec-001");
    });

    test("returns null when no duplicate exists", () => {
      const dup = agent.findDuplicate(
        "A completely different topic about quantum physics and black holes.",
        entries,
      );
      expect(dup).toBeNull();
    });
  });

  // -- findSuperseded ---------------------------------------------------------

  describe("findSuperseded", () => {
    const entries: ExistingEntry[] = [
      {
        id: "dec-001",
        title: "Use Node.js",
        content: "We decided to use Node.js for the runtime.",
        type: "decision",
        tags: [],
      },
    ];

    test("detects supersession when content replaces an old entry", () => {
      const result = agent.findSuperseded(
        "We now use Bun instead of Node.js. The old runtime decision is deprecated.",
        entries,
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe("dec-001");
    });

    test("returns null without supersession keywords", () => {
      const result = agent.findSuperseded(
        "Bun is a fast JavaScript runtime. We like it for testing.",
        entries,
      );
      expect(result).toBeNull();
    });
  });

  // -- buildPlan --------------------------------------------------------------

  describe("buildPlan", () => {
    test("creates file actions for substantial notes", () => {
      const notes: SessionNoteInput[] = [
        {
          noteId: "n-1",
          content:
            "We decided to switch from REST to GraphQL because it reduces overfetching and improves DX significantly.",
          type: "semantic",
          importance: "high",
          tags: ["Tech/API"],
        },
      ];

      const plan = agent.buildPlan(notes, [], []);

      expect(plan.length).toBe(1);
      expect(plan[0]!.type).toBe("create_file");
      expect(plan[0]!.category).toBe("decision");
      expect(plan[0]!.targetType).toBe("decision");
      expect(plan[0]!.tags).toEqual(["tech/api"]);
    });

    test("skips duplicates", () => {
      const notes: SessionNoteInput[] = [
        {
          noteId: "n-1",
          content: "We decided to use Bun runtime because of speed and DX.",
          type: "semantic",
          importance: "medium",
        },
      ];
      const existing: ExistingEntry[] = [
        {
          id: "dec-001",
          title: "Use Bun",
          content: "We decided to use Bun runtime because of speed and DX.",
          type: "decision",
          tags: [],
        },
      ];

      const plan = agent.buildPlan(notes, existing, []);

      expect(plan.length).toBe(1);
      expect(plan[0]!.type).toBe("skip_duplicate");
      expect(plan[0]!.duplicateOfId).toBe("dec-001");
    });

    test("creates subsume action when superseding", () => {
      const notes: SessionNoteInput[] = [
        {
          noteId: "n-1",
          content:
            "We now use Bun instead of Node.js. The old runtime is no longer used in our codebase.",
          type: "semantic",
          importance: "high",
        },
      ];
      const existing: ExistingEntry[] = [
        {
          id: "dec-001",
          title: "Use Node.js",
          content: "We decided to use Node.js for the runtime.",
          type: "decision",
          tags: [],
        },
      ];

      const plan = agent.buildPlan(notes, existing, []);

      expect(plan.length).toBe(1);
      expect(plan[0]!.type).toBe("subsume");
      expect(plan[0]!.supersedesId).toBe("dec-001");
    });

    test("normalizes tags in all actions", () => {
      const notes: SessionNoteInput[] = [
        {
          noteId: "n-1",
          content:
            "The server crashed because the SSL certificate expired. We fixed it by renewing via Certbot.",
          type: "episodic",
          importance: "high",
          tags: ["Tech/SSL/", "INFRA"],
        },
      ];

      const plan = agent.buildPlan(notes, [], ["tech/ssl", "infra"]);

      expect(plan[0]!.tags).toEqual(["infra", "tech/ssl"]);
    });

    test("handles empty notes array", () => {
      const plan = agent.buildPlan([], [], []);
      expect(plan).toEqual([]);
    });
  });
});

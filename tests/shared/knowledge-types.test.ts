import { afterEach, describe, expect, test } from "bun:test";
import {
  getIdPrefix,
  getKnowledgeTypeDir,
  getRegisteredKnowledgeTypes,
  getTypeForPrefix,
  getV1MemoryType,
  isKnowledgeType,
  registerKnowledgeType,
  unregisterKnowledgeType,
} from "../../src/shared/knowledge-types.ts";
import {
  knowledgeToMemoryType,
  knowledgeTypeDir,
  parseV2LiteId,
} from "../../src/shared/utils.ts";

describe("knowledge-types registry (C1)", () => {
  afterEach(() => {
    // Clean up any extension types registered during a test
    unregisterKnowledgeType("transaction");
    unregisterKnowledgeType("idea");
  });

  test("seeds the seven core types with their original values", () => {
    const types = getRegisteredKnowledgeTypes();
    for (const t of [
      "decision",
      "incident",
      "entity",
      "pattern",
      "workflow",
      "note",
      "session",
    ]) {
      expect(types).toContain(t);
      expect(isKnowledgeType(t)).toBe(true);
    }
    // Exact legacy mappings preserved
    expect(getKnowledgeTypeDir("decision")).toBe("semantic/decisions");
    expect(getKnowledgeTypeDir("incident")).toBe("episodic/incidents");
    expect(getKnowledgeTypeDir("workflow")).toBe("procedural/workflows");
    expect(getV1MemoryType("entity")).toBe("semantic");
    expect(getV1MemoryType("session")).toBe("episodic");
    expect(getV1MemoryType("pattern")).toBe("procedural");
    expect(getIdPrefix("decision")).toBe("dec");
    expect(getIdPrefix("incident")).toBe("inc");
  });

  test("registers an extension type and resolves it everywhere", () => {
    registerKnowledgeType({
      type: "transaction",
      dir: "episodic/transactions",
      v1Type: "episodic",
      idPrefix: "txn",
    });
    expect(isKnowledgeType("transaction")).toBe(true);
    expect(getKnowledgeTypeDir("transaction")).toBe("episodic/transactions");
    expect(getV1MemoryType("transaction")).toBe("episodic");
    expect(getIdPrefix("transaction")).toBe("txn");
    expect(getTypeForPrefix("txn")).toBe("transaction");
    // Extension type appears in the rebuild-index gate set
    expect(getRegisteredKnowledgeTypes()).toContain("transaction");
  });

  test("delegating utils resolve extension types", () => {
    registerKnowledgeType({
      type: "transaction",
      dir: "episodic/transactions",
      v1Type: "episodic",
      idPrefix: "txn",
    });
    expect(knowledgeTypeDir("transaction")).toBe("episodic/transactions");
    expect(knowledgeToMemoryType("transaction")).toBe("episodic");
    // parseV2LiteId resolves the extension prefix
    expect(parseV2LiteId("txn-001")).toEqual({
      type: "transaction",
      dir: "episodic/transactions",
    });
  });

  test("rejects duplicate type names and duplicate prefixes", () => {
    registerKnowledgeType({
      type: "transaction",
      dir: "episodic/transactions",
      v1Type: "episodic",
      idPrefix: "txn",
    });
    // Duplicate type
    expect(() =>
      registerKnowledgeType({
        type: "transaction",
        dir: "x",
        v1Type: "semantic",
        idPrefix: "tx2",
      }),
    ).toThrow(/already registered/);
    // Duplicate prefix
    expect(() =>
      registerKnowledgeType({
        type: "idea",
        dir: "semantic/ideas",
        v1Type: "semantic",
        idPrefix: "txn",
      }),
    ).toThrow(/prefix already in use/);
  });

  test("never overwrites or removes core types", () => {
    // Core type cannot be re-registered
    expect(() =>
      registerKnowledgeType({
        type: "decision",
        dir: "x",
        v1Type: "semantic",
        idPrefix: "d2",
      }),
    ).toThrow(/already registered/);
    // unregister is a no-op for core types
    unregisterKnowledgeType("decision");
    expect(isKnowledgeType("decision")).toBe(true);
    expect(getKnowledgeTypeDir("decision")).toBe("semantic/decisions");
  });

  test("unknown types get defined fallbacks (no crash)", () => {
    expect(isKnowledgeType("nope")).toBe(false);
    expect(getKnowledgeTypeDir("nope")).toBe("semantic/nope");
    expect(getV1MemoryType("nope")).toBe("semantic");
    expect(getIdPrefix("nope")).toBe("nope");
  });
});

/**
 * Runtime registry for knowledge types (Extension System C1).
 *
 * The core ships seven built-in knowledge types. Extensions register their own
 * types (e.g. "transaction", "idea") here so the orchestrator's type-dependent
 * functions — directory mapping, v1 MemoryType mapping, ID prefix allocation,
 * and the rebuild-index type gate — work for them without a hardcoded switch.
 *
 * Built-in types are seeded on module load with the exact values the previous
 * compile-time switches used, so existing behavior is unchanged.
 */

/** Declaration an extension provides for each knowledge type it introduces. */
export interface KnowledgeTypeDecl {
  /** The `knowledge.type` value, e.g. "decision", "transaction". */
  type: string;
  /** Directory (relative to baseDir) where files of this type live. */
  dir: string;
  /** Which v1 `memories.memory_type` bucket this maps to. */
  v1Type: "semantic" | "episodic" | "procedural";
  /** Prefix for sequential IDs, e.g. "dec" → dec-001. */
  idPrefix: string;
}

/** The seven built-in core types, with the exact values the old switches used. */
const CORE_TYPES: readonly KnowledgeTypeDecl[] = [
  {
    type: "decision",
    dir: "semantic/decisions",
    v1Type: "semantic",
    idPrefix: "dec",
  },
  {
    type: "entity",
    dir: "semantic/entities",
    v1Type: "semantic",
    idPrefix: "entity",
  },
  {
    type: "incident",
    dir: "episodic/incidents",
    v1Type: "episodic",
    idPrefix: "inc",
  },
  {
    type: "pattern",
    dir: "procedural/patterns",
    v1Type: "procedural",
    idPrefix: "pat",
  },
  {
    type: "workflow",
    dir: "procedural/workflows",
    v1Type: "procedural",
    idPrefix: "wf",
  },
  { type: "note", dir: "semantic/notes", v1Type: "semantic", idPrefix: "note" },
  {
    type: "session",
    dir: "episodic/sessions",
    v1Type: "episodic",
    idPrefix: "session",
  },
];

const registry = new Map<string, KnowledgeTypeDecl>();
const prefixToType = new Map<string, string>();

function seedCore(): void {
  for (const decl of CORE_TYPES) {
    registry.set(decl.type, decl);
    prefixToType.set(decl.idPrefix, decl.type);
  }
}
seedCore();

/**
 * Register a knowledge type introduced by an extension. Merges with the
 * built-in types; never overwrites them. Throws on a duplicate type name or a
 * duplicate ID prefix so two extensions cannot silently collide.
 */
export function registerKnowledgeType(decl: KnowledgeTypeDecl): void {
  if (registry.has(decl.type)) {
    throw new Error(`Knowledge type already registered: ${decl.type}`);
  }
  if (prefixToType.has(decl.idPrefix)) {
    throw new Error(
      `Knowledge type ID prefix already in use: ${decl.idPrefix} (by ${prefixToType.get(decl.idPrefix)})`,
    );
  }
  registry.set(decl.type, decl);
  prefixToType.set(decl.idPrefix, decl.type);
}

/** Remove an extension's type (used on uninstall / in test teardown). Core types are kept. */
export function unregisterKnowledgeType(type: string): void {
  if (CORE_TYPES.some((c) => c.type === type)) return;
  const decl = registry.get(type);
  if (!decl) return;
  registry.delete(type);
  prefixToType.delete(decl.idPrefix);
}

/** Directory for a type, relative to baseDir. Unknown types get a defined fallback. */
export function getKnowledgeTypeDir(type: string): string {
  return registry.get(type)?.dir ?? `semantic/${type}`;
}

/** v1 MemoryType bucket for a type. Unknown types fall back to "semantic". */
export function getV1MemoryType(
  type: string,
): "semantic" | "episodic" | "procedural" {
  return registry.get(type)?.v1Type ?? "semantic";
}

/** ID prefix for a type. Unknown types fall back to the type name itself. */
export function getIdPrefix(type: string): string {
  return registry.get(type)?.idPrefix ?? type;
}

/** The knowledge type owning a given ID prefix, or undefined. */
export function getTypeForPrefix(prefix: string): string | undefined {
  return prefixToType.get(prefix);
}

/** Whether a type string is a registered knowledge type (core or extension). */
export function isKnowledgeType(type: string): boolean {
  return registry.has(type);
}

/** All currently registered type names (core + extension). Used by the rebuild-index gate. */
export function getRegisteredKnowledgeTypes(): string[] {
  return [...registry.keys()];
}

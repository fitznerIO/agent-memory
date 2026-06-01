import {
  getIdPrefix,
  getKnowledgeTypeDir,
  getTypeForPrefix,
  getV1MemoryType,
} from "./knowledge-types.ts";
import type {
  ConnectionType,
  InverseConnectionType,
  KnowledgeType,
} from "./types.ts";

/**
 * ID prefix per built-in KnowledgeType (dec-001, inc-002, …).
 * Backed by the runtime registry (C1); extension prefixes are resolved via
 * `getIdPrefix()` in src/shared/knowledge-types.ts, not this object.
 */
export const TYPE_PREFIX: Record<KnowledgeType, string> = {
  decision: getIdPrefix("decision"),
  incident: getIdPrefix("incident"),
  entity: getIdPrefix("entity"),
  pattern: getIdPrefix("pattern"),
  workflow: getIdPrefix("workflow"),
  note: getIdPrefix("note"),
  session: getIdPrefix("session"),
};

/** Reverse map: prefix → KnowledgeType (inverse of TYPE_PREFIX). */
export const PREFIX_TO_TYPE: Record<string, KnowledgeType> = Object.fromEntries(
  Object.entries(TYPE_PREFIX).map(([type, prefix]) => [
    prefix,
    type as KnowledgeType,
  ]),
) as Record<string, KnowledgeType>;

const V2_LITE_ID_RE = /^([a-z]+)-\d+$/;

/**
 * Parse a v2-lite ID (e.g. "dec-001", "txn-001") into its knowledge type and
 * target directory, or null for UUIDs. Resolves through the runtime registry so
 * extension prefixes (e.g. "txn") work alongside the built-in ones.
 */
export function parseV2LiteId(
  id: string,
): { type: string; dir: string } | null {
  const match = V2_LITE_ID_RE.exec(id);
  if (!match?.[1]) return null;
  const type = getTypeForPrefix(match[1]);
  if (!type) return null;
  return { type, dir: getKnowledgeTypeDir(type) };
}

/** Extract last-modified date as ISO string from any frontmatter format (v1 or v2-lite). */
export function getLastModified(fm: Record<string, unknown>): string {
  // v1: updatedAt as number
  if (typeof fm.updatedAt === "number" && !Number.isNaN(fm.updatedAt)) {
    return new Date(fm.updatedAt).toISOString();
  }
  // v2-lite: updated as string date
  if (fm.updated) {
    return new Date(String(fm.updated)).toISOString();
  }
  // v2-lite fallback: created as string date
  if (fm.created) {
    return new Date(String(fm.created)).toISOString();
  }
  return new Date().toISOString();
}

/** Convert title to URL-friendly slug with German umlaut support. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => {
      const map: Record<string, string> = {
        ä: "ae",
        ö: "oe",
        ü: "ue",
        ß: "ss",
      };
      return map[c] ?? c;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Map a knowledge type to its directory path relative to baseDir.
 * Delegates to the runtime registry (C1) so extension types resolve too.
 */
export function knowledgeTypeDir(type: KnowledgeType | string): string {
  return getKnowledgeTypeDir(type);
}

/**
 * Map a knowledge type to its v1 MemoryType bucket for the memories table.
 * Delegates to the runtime registry (C1); unknown types fall back to "semantic".
 */
export function knowledgeToMemoryType(
  type: KnowledgeType | string,
): "semantic" | "episodic" | "procedural" {
  return getV1MemoryType(type);
}

/** Get the inverse connection type for bidirectional connections. */
export function getInverseType(type: ConnectionType): InverseConnectionType {
  switch (type) {
    case "related":
      return "related";
    case "builds_on":
      return "extended_by";
    case "contradicts":
      return "contradicts";
    case "part_of":
      return "contains";
    case "supersedes":
      return "superseded_by";
  }
}

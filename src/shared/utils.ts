import type {
  ConnectionType,
  InverseConnectionType,
  KnowledgeType,
} from "./types.ts";

/** ID prefix per KnowledgeType for sequential IDs like dec-001, inc-002. */
export const TYPE_PREFIX: Record<KnowledgeType, string> = {
  decision: "dec",
  incident: "inc",
  entity: "entity",
  pattern: "pat",
  workflow: "wf",
  note: "note",
  session: "session",
};

/** Reverse map: prefix → KnowledgeType (inverse of TYPE_PREFIX). */
export const PREFIX_TO_TYPE: Record<string, KnowledgeType> = Object.fromEntries(
  Object.entries(TYPE_PREFIX).map(([type, prefix]) => [
    prefix,
    type as KnowledgeType,
  ]),
) as Record<string, KnowledgeType>;

const V2_LITE_ID_RE = /^([a-z]+)-\d+$/;

/** Parse a v2-lite ID (e.g. "dec-001") into its KnowledgeType and target directory, or null for UUIDs. */
export function parseV2LiteId(
  id: string,
): { type: KnowledgeType; dir: string } | null {
  const match = V2_LITE_ID_RE.exec(id);
  if (!match?.[1]) return null;
  const prefix = match[1];
  const type = PREFIX_TO_TYPE[prefix];
  if (!type) return null;
  return { type, dir: knowledgeTypeDir(type) };
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

/** Map KnowledgeType to directory path relative to baseDir. */
export function knowledgeTypeDir(type: KnowledgeType): string {
  switch (type) {
    case "decision":
      return "semantic/decisions";
    case "entity":
      return "semantic/entities";
    case "incident":
      return "episodic/incidents";
    case "pattern":
      return "procedural/patterns";
    case "workflow":
      return "procedural/workflows";
    case "note":
      return "semantic/notes";
    case "session":
      return "episodic/sessions";
  }
}

/** Map KnowledgeType to v1 MemoryType for the memories table. */
export function knowledgeToMemoryType(
  type: KnowledgeType,
): "semantic" | "episodic" | "procedural" {
  switch (type) {
    case "decision":
    case "entity":
    case "note":
      return "semantic";
    case "incident":
    case "session":
      return "episodic";
    case "pattern":
    case "workflow":
      return "procedural";
  }
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

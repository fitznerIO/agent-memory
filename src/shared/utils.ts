import type { ConnectionType, InverseConnectionType, KnowledgeType } from "./types.ts";

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

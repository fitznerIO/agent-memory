import type {
  ConsolidationAction,
  KnowledgeType,
  NoteCategory,
} from "../shared/types.ts";

export interface SessionNoteInput {
  noteId: string;
  content: string;
  type: string;
  importance: string;
  tags?: string[];
}

export interface ExistingEntry {
  id: string;
  title: string;
  content: string;
  type: string;
  tags: string[];
}

export interface ConsolidationAgent {
  /** Categorize a note based on content heuristics. */
  categorize(content: string, type: string): NoteCategory;

  /** Map a NoteCategory to a KnowledgeType for file creation. */
  categoryToKnowledgeType(category: NoteCategory): KnowledgeType | null;

  /** Generate a title from content (first meaningful line or summary). */
  generateTitle(content: string): string;

  /** Normalize tags: lowercase, deduplicate, trim whitespace. */
  normalizeTags(tags: string[], existingTags?: string[]): string[];

  /** Check if content is a near-duplicate of any existing entry. */
  findDuplicate(
    content: string,
    existingEntries: ExistingEntry[],
  ): ExistingEntry | null;

  /** Check if content supersedes an existing entry. */
  findSuperseded(
    content: string,
    existingEntries: ExistingEntry[],
  ): ExistingEntry | null;

  /** Build a consolidation plan from session notes. */
  buildPlan(
    notes: SessionNoteInput[],
    existingEntries: ExistingEntry[],
    existingTags: string[],
  ): ConsolidationAction[];
}

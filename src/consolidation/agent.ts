import type {
  ConsolidationAction,
  KnowledgeType,
  NoteCategory,
} from "../shared/types.ts";
import type {
  ConsolidationAgent,
  ExistingEntry,
  SessionNoteInput,
} from "./types.ts";

// -- Keyword patterns for note categorization --------------------------------

const DECISION_PATTERNS = [
  /\b(decided|decision|chose|chosen|picked|selected)\b/i,
  /\b(rationale|reasoning|trade-?off)\b/i,
  /\b(alternative|option|vs\.?|versus|instead of)\b/i,
  /\bwir (haben|nutzen|verwenden|setzen auf)\b/i,
  /\bbecause\b.{5,}/i, // "because" followed by actual reasoning
];

const INCIDENT_PATTERNS = [
  /\b(bug|error|crash|incident)\b/i,
  /\b(fix(ed)?|resolved|behoben)\b/i,
  /\b(workaround|root cause|debugging)\b/i,
  /\b(issue|problem|outage|downtime|failure)\b/i,
  /\b(broke|broken|fehlgeschlagen|fehler|geloest)\b/i,
];

const WORKFLOW_PATTERNS = [
  /\b(workflow|process|procedure|recipe|guide)\b/i,
  /\b(steps?|step-by-step|how to|tutorial)\b/i,
  /\b(1\.\s|2\.\s|3\.\s)/,
  /\b(anleitung|ablauf|schritte|vorgehen)\b/i,
];

const FACT_PATTERNS = [
  /\b(prefers?|preference|likes?|always|never)\b/i,
  /\b(uses?|bevorzugt|nutzt|mag)\b/i,
];

/** Minimum content length for a note to warrant its own file. */
const MIN_FILE_LENGTH = 80;

/** Similarity threshold (0-1) for duplicate detection via Jaccard index. */
const DUPLICATE_THRESHOLD = 0.6;

/** Similarity threshold for supersession detection. */
const SUPERSEDE_THRESHOLD = 0.25;

const SUPERSEDE_KEYWORDS =
  /\b(replaces?|supersedes?|instead of|no longer|deprecated|ersetzt|nicht mehr)\b/i;

// -- Helpers ------------------------------------------------------------------

function countMatches(content: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(content)) count++;
  }
  return count;
}

/** Simple word-level Jaccard similarity. Strips punctuation for fair comparison. */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s/-]/g, "") // strip punctuation (keep slashes/hyphens for tags)
      .split(/\s+/)
      .filter(Boolean);
  const wordsA = new Set(tokenize(a));
  const wordsB = new Set(tokenize(b));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// -- Factory ------------------------------------------------------------------

export function createConsolidationAgent(): ConsolidationAgent {
  return {
    categorize(content: string, type: string): NoteCategory {
      // If the note was already typed as a specific type, respect that
      if (type === "decision") return "decision";
      if (type === "incident") return "incident";
      if (type === "workflow") return "workflow";

      const decisionScore = countMatches(content, DECISION_PATTERNS);
      const incidentScore = countMatches(content, INCIDENT_PATTERNS);
      const workflowScore = countMatches(content, WORKFLOW_PATTERNS);
      const factScore = countMatches(content, FACT_PATTERNS);

      // Require at least 2 matching patterns for confidence
      if (decisionScore >= 2) return "decision";
      if (incidentScore >= 2) return "incident";
      if (workflowScore >= 2) return "workflow";

      // Single strong match with sufficient content
      if (content.length >= MIN_FILE_LENGTH) {
        if (decisionScore >= 1) return "decision";
        if (incidentScore >= 1) return "incident";
        if (workflowScore >= 1) return "workflow";
      }

      // Short factual content
      if (factScore >= 1 && content.length < MIN_FILE_LENGTH) return "fact";

      return "note";
    },

    categoryToKnowledgeType(category: NoteCategory): KnowledgeType | null {
      switch (category) {
        case "decision":
          return "decision";
        case "incident":
          return "incident";
        case "workflow":
          return "workflow";
        case "fact":
          return null; // Facts get appended to entities, not own file
        case "note":
          return "note";
      }
    },

    generateTitle(content: string): string {
      // Take first line, strip markdown headers, limit length
      const firstLine = content.split("\n").find((l) => l.trim().length > 0);
      if (!firstLine) return "Untitled";

      let title = firstLine
        .replace(/^#+\s*/, "") // strip markdown headers
        .replace(/^\*\*(.+?)\*\*.*/, "$1") // extract bold text
        .trim();

      if (title.length > 80) {
        title = `${title.slice(0, 77)}...`;
      }

      return title || "Untitled";
    },

    normalizeTags(tags: string[]): string[] {
      const normalized = new Set<string>();

      for (const tag of tags) {
        const t = tag
          .toLowerCase()
          .trim()
          .replace(/\/+$/, "") // Remove trailing slashes
          .replace(/\s+/g, "-"); // Spaces to hyphens

        if (t.length > 0) {
          normalized.add(t);
        }
      }

      return [...normalized].sort();
    },

    findDuplicate(
      content: string,
      existingEntries: ExistingEntry[],
    ): ExistingEntry | null {
      for (const entry of existingEntries) {
        const similarity = jaccardSimilarity(content, entry.content);
        if (similarity >= DUPLICATE_THRESHOLD) {
          return entry;
        }
      }
      return null;
    },

    findSuperseded(
      content: string,
      existingEntries: ExistingEntry[],
    ): ExistingEntry | null {
      if (!SUPERSEDE_KEYWORDS.test(content)) return null;

      for (const entry of existingEntries) {
        const similarity = jaccardSimilarity(content, entry.content);
        if (
          similarity >= SUPERSEDE_THRESHOLD &&
          similarity < DUPLICATE_THRESHOLD
        ) {
          return entry;
        }
      }
      return null;
    },

    buildPlan(
      notes: SessionNoteInput[],
      existingEntries: ExistingEntry[],
    ): ConsolidationAction[] {
      const actions: ConsolidationAction[] = [];

      for (const note of notes) {
        const category = this.categorize(note.content, note.type);
        const tags = this.normalizeTags(note.tags ?? []);

        // Check for duplicates
        const duplicate = this.findDuplicate(note.content, existingEntries);
        if (duplicate) {
          actions.push({
            type: "skip_duplicate",
            noteId: note.noteId,
            category,
            duplicateOfId: duplicate.id,
            tags,
          });
          continue;
        }

        // Check for supersession
        const superseded = this.findSuperseded(note.content, existingEntries);
        if (superseded) {
          const knType = this.categoryToKnowledgeType(category);
          if (knType) {
            actions.push({
              type: "subsume",
              noteId: note.noteId,
              category,
              targetType: knType,
              title: this.generateTitle(note.content),
              content: note.content,
              tags,
              supersedesId: superseded.id,
            });
            continue;
          }
        }

        // Decide: create file or skip
        const knType = this.categoryToKnowledgeType(category);
        if (knType && note.content.length >= MIN_FILE_LENGTH) {
          actions.push({
            type: "create_file",
            noteId: note.noteId,
            category,
            targetType: knType,
            title: this.generateTitle(note.content),
            content: note.content,
            tags,
          });
        } else if (tags.length > 0) {
          // Tag normalization action for notes that don't get their own file
          actions.push({
            type: "normalize_tags",
            noteId: note.noteId,
            category,
            tags,
          });
        }
      }

      return actions;
    },
  };
}

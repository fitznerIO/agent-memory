// The markdown parser now lives in src/shared/markdown.ts so all modules can use
// it without a cross-module import (CLAUDE.md). Re-exported here for the memory
// module's own internal use and backward-compatible import paths.
export {
  parseMarkdown,
  serializeMarkdown,
  type MarkdownDocument,
} from "../shared/markdown.ts";

import type { Extension } from "../types.ts";

/**
 * Reference extension that validates the Extension System end to end (Task 007).
 *
 * Minimal but real: introduces a `bookmark` knowledge type, a `bookmark_meta`
 * table (FK + CASCADE added by the runtime), and one tool `bookmark_add` that
 * creates a knowledge entry, writes its ext.bookmark frontmatter, and inserts a
 * row into bookmark_meta. It exercises every contract: knowledgeTypes (C1),
 * ExtensionDB (C4), the MemoryAPI facade (C3 store + setExtensionData), and the
 * install/uninstall lifecycle.
 */
export const bookmarkExtension: Extension = {
  name: "bookmark",
  version: "1.0.0",
  description: "Reference extension: bookmark entries with a priority tag",

  knowledgeTypes: [
    {
      type: "bookmark",
      dir: "semantic/bookmarks",
      v1Type: "semantic",
      idPrefix: "bm",
    },
  ],

  schema: {
    table: "bookmark_meta",
    columns: [
      { name: "url", type: "TEXT" },
      { name: "priority", type: "INTEGER", default: "0" },
    ],
  },

  tools: [
    {
      name: "bookmark_add",
      description: "Create a bookmark entry with a url and priority",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          priority: { type: "number" },
        },
        required: ["title", "url"],
      },
      async handler(input, ctx) {
        const { title, url, priority } = input as {
          title: string;
          url: string;
          priority?: number;
        };
        const prio = priority ?? 0;

        // 1. Core entry via the facade.
        const id = await ctx.memory.store({
          title,
          type: "bookmark",
          content: `Bookmark: ${url}`,
          tags: ["bookmark"],
        });

        // 2. Extension table row (own table, scoped db).
        ctx.db.run(
          "INSERT INTO bookmark_meta (entry_id, url, priority) VALUES (?, ?, ?)",
          [id, url, prio],
        );

        // 3. ext.bookmark frontmatter block (C3).
        await ctx.memory.setExtensionData(id, "bookmark", {
          url,
          priority: prio,
        });

        return { id, url, priority: prio };
      },
    },
  ],

  async onInstall(ctx) {
    ctx.db.run(
      "CREATE INDEX IF NOT EXISTS idx_bookmark_priority ON bookmark_meta(priority)",
    );
  },

  async onUninstall(ctx) {
    ctx.log.info("bookmark extension uninstalled");
  },
};

import { parseMarkdown, serializeMarkdown } from "../shared/markdown.ts";

/**
 * Remove every `ext.<name>` frontmatter block from all markdown files under
 * `memoryPath`, returning the count of files changed (§7.3).
 *
 * Uses the core's own `yaml`-based parser/serializer (NOT gray-matter) and
 * Bun.Glob (NO external `glob` dependency). `ext.<name>` is a flat literal key.
 * `memoryPath` is the PROJECT store root — the C6 invariant guarantees ext keys
 * never live in the global store, so only the project tree is scanned.
 */
export async function cleanFrontmatterNamespace(
  memoryPath: string,
  extensionName: string,
): Promise<number> {
  const extKey = `ext.${extensionName}`;
  const glob = new Bun.Glob("**/*.md");
  let cleaned = 0;

  for (const file of glob.scanSync({ cwd: memoryPath, absolute: true })) {
    const raw = await Bun.file(file).text();
    const doc = parseMarkdown(raw);
    if (doc.frontmatter[extKey] !== undefined) {
      delete doc.frontmatter[extKey];
      await Bun.write(file, serializeMarkdown(doc));
      cleaned++;
    }
  }

  return cleaned;
}

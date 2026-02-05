import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MemoryType } from "../../src/shared/types.ts";

export async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-memory-test-"));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function createSampleMemory(
  dir: string,
  type: MemoryType,
  content: string,
): Promise<string> {
  const fileName = `${type}-${Date.now()}.md`;
  const subDir = join(dir, type);
  await Bun.write(join(subDir, ".keep"), "");
  const filePath = join(subDir, fileName);
  const frontmatter = [
    "---",
    `title: Sample ${type} memory`,
    `type: ${type}`,
    "tags: [test]",
    "importance: medium",
    "---",
    "",
  ].join("\n");
  await Bun.write(filePath, frontmatter + content);
  return filePath;
}

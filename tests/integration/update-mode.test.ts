// Regression test for update --mode append (inc-006).
//
// `mode` did not exist at all: the CLI parsed the flag, dropped it, and update() always replaced
// the body. A real memory shrank from 572 to 467 characters that way; the reported diff quoted the
// input length, so the shrink looked like a normal update.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createMemorySystem } from "../../src/index.ts";
import type { MemorySystem } from "../../src/index.ts";
import { cleanupTempDir, createTempDir } from "../helpers/fixtures.ts";

const TEST_TIMEOUT = 120_000;

describe("update modes (inc-006)", () => {
  let tempDir: string;
  let system: MemorySystem;

  beforeAll(async () => {
    tempDir = await createTempDir();
    system = createMemorySystem({
      baseDir: tempDir,
      sqlitePath: join(tempDir, ".index", "search.sqlite"),
    });
    await system.start();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    try {
      await system.stop();
    } catch {
      // may fail if already stopped
    }
    await cleanupTempDir(tempDir);
  }, TEST_TIMEOUT);

  async function seed(title: string, content: string): Promise<string> {
    const stored = await system.memoryStore({
      title,
      content,
      type: "semantic",
      tags: ["test"],
    });
    return stored.file_path;
  }

  test(
    "mode append keeps the existing body and adds to it",
    async () => {
      const path = await seed("Append target", "Erster Absatz.");
      await system.update({
        path,
        content: "Zweiter Absatz.",
        reason: "Nachtrag",
        mode: "append",
      });

      const after = await system.read({ path });
      expect(after.content).toContain("Erster Absatz.");
      expect(after.content).toContain("Zweiter Absatz.");
      expect(after.content.indexOf("Erster")).toBeLessThan(
        after.content.indexOf("Zweiter"),
      );
    },
    TEST_TIMEOUT,
  );

  test(
    "mode append grows the file instead of shrinking it",
    async () => {
      const original = "Ein deutlich längerer Ausgangstext, der erhalten bleiben muss.";
      const path = await seed("Append length", original);
      const result = await system.update({
        path,
        content: "Kurz.",
        reason: "Nachtrag",
        mode: "append",
      });

      const after = await system.read({ path });
      expect(after.content.length).toBeGreaterThan(original.length);
      // The reported diff must describe what was written, not what was passed in — otherwise a
      // growing file is reported as a shrinking one, which is how inc-006 stayed unnoticed.
      expect(result.diff).toContain(`new length: ${after.content.length}`);
    },
    TEST_TIMEOUT,
  );

  test(
    "the default is still replace",
    async () => {
      const path = await seed("Replace target", "Alter Text.");
      await system.update({ path, content: "Neuer Text.", reason: "Ersetzt" });

      const after = await system.read({ path });
      expect(after.content).toContain("Neuer Text.");
      expect(after.content).not.toContain("Alter Text.");
    },
    TEST_TIMEOUT,
  );

  test(
    "mode replace is explicit and behaves like the default",
    async () => {
      const path = await seed("Explicit replace", "Alter Text.");
      await system.update({
        path,
        content: "Neuer Text.",
        reason: "Ersetzt",
        mode: "replace",
      });

      const after = await system.read({ path });
      expect(after.content).not.toContain("Alter Text.");
    },
    TEST_TIMEOUT,
  );
});

import { test, expect } from "bun:test";

test("all modules import without error", async () => {
  const memory = await import("../src/memory/store.ts");
  const search = await import("../src/search/index.ts");
  const git = await import("../src/git/manager.ts");
  const embedding = await import("../src/embedding/engine.ts");
  const system = await import("../src/index.ts");

  expect(memory.createMemoryStore).toBeFunction();
  expect(search.createSearchIndex).toBeFunction();
  expect(git.createGitManager).toBeFunction();
  expect(embedding.createEmbeddingEngine).toBeFunction();
  expect(system.createMemorySystem).toBeFunction();
});

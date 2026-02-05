import { describe, test, expect, beforeAll } from "bun:test";
import { createDefaultConfig } from "../../src/shared/config.ts";
import { createEmbeddingEngine } from "../../src/embedding/engine.ts";
import type { EmbeddingEngine } from "../../src/embedding/types.ts";

const TEST_TIMEOUT = 60000; // 60s for model download

describe("EmbeddingEngine", () => {
  let engine: EmbeddingEngine;

  beforeAll(async () => {
    const config = createDefaultConfig();
    engine = createEmbeddingEngine(config);
    // Initialize once for all tests
    await engine.initialize();
  }, TEST_TIMEOUT);

  describe("initialize", () => {
    test("loads the embedding model", async () => {
      const config = createDefaultConfig();
      const testEngine = createEmbeddingEngine(config);
      expect(testEngine.isReady()).toBe(false);
      await testEngine.initialize();
      expect(testEngine.isReady()).toBe(true);
    }, TEST_TIMEOUT);

    test("sets isReady to true after initialization", async () => {
      const config = createDefaultConfig();
      const testEngine = createEmbeddingEngine(config);
      expect(testEngine.isReady()).toBe(false);
      await testEngine.initialize();
      expect(testEngine.isReady()).toBe(true);
      // Second call should be idempotent
      await testEngine.initialize();
      expect(testEngine.isReady()).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe("embed", () => {
    test("returns a Float32Array of correct dimensions", async () => {
      const result = await engine.embed("test text");
      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(result.vector.length).toBe(384);
      expect(result.dimensions).toBe(384);
      expect(result.text).toBe("test text");
    }, TEST_TIMEOUT);

    test("returns consistent vectors for identical input", async () => {
      const text = "consistent test";
      const result1 = await engine.embed(text);
      const result2 = await engine.embed(text);

      expect(result1.vector.length).toBe(result2.vector.length);
      for (let i = 0; i < result1.vector.length; i++) {
        const val1 = result1.vector[i];
        const val2 = result2.vector[i];
        if (val1 !== undefined && val2 !== undefined) {
          expect(val1).toBeCloseTo(val2, 6);
        }
      }
    }, TEST_TIMEOUT);

    test("returns different vectors for different input", async () => {
      const result1 = await engine.embed("dog");
      const result2 = await engine.embed("javascript");

      // Vectors should be different
      let differenceCount = 0;
      for (let i = 0; i < result1.vector.length; i++) {
        const val1 = result1.vector[i];
        const val2 = result2.vector[i];
        if (val1 !== undefined && val2 !== undefined && Math.abs(val1 - val2) > 0.001) {
          differenceCount++;
        }
      }
      expect(differenceCount).toBeGreaterThan(100); // Most values should differ
    }, TEST_TIMEOUT);

    test("returns normalized vectors with magnitude ~1.0", async () => {
      const result = await engine.embed("test normalization");

      // Calculate magnitude
      let sumOfSquares = 0;
      for (let i = 0; i < result.vector.length; i++) {
        const val = result.vector[i];
        if (val !== undefined) {
          sumOfSquares += val * val;
        }
      }
      const magnitude = Math.sqrt(sumOfSquares);

      expect(magnitude).toBeCloseTo(1.0, 5);
    }, TEST_TIMEOUT);

    test("lazily initializes on first embed call", async () => {
      const config = createDefaultConfig();
      const testEngine = createEmbeddingEngine(config);
      expect(testEngine.isReady()).toBe(false);

      const result = await testEngine.embed("lazy init test");
      expect(testEngine.isReady()).toBe(true);
      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(result.vector.length).toBe(384);
    }, TEST_TIMEOUT);
  });

  describe("embedBatch", () => {
    test("embeds multiple texts in a single call", async () => {
      const texts = ["first text", "second text", "third text"];
      const results = await engine.embedBatch(texts);

      expect(results.length).toBe(3);
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const text = texts[i];
        if (result !== undefined && text !== undefined) {
          expect(result.text).toBe(text);
          expect(result.vector).toBeInstanceOf(Float32Array);
          expect(result.vector.length).toBe(384);
          expect(result.dimensions).toBe(384);
        }
      }
    }, TEST_TIMEOUT);

    test("returns results in same order as input", async () => {
      const texts = ["alpha", "beta", "gamma", "delta"];
      const results = await engine.embedBatch(texts);

      expect(results.length).toBe(4);
      expect(results[0]?.text).toBe("alpha");
      expect(results[1]?.text).toBe("beta");
      expect(results[2]?.text).toBe("gamma");
      expect(results[3]?.text).toBe("delta");
    }, TEST_TIMEOUT);

    test("handles empty input array", async () => {
      const results = await engine.embedBatch([]);
      expect(results).toEqual([]);
    }, TEST_TIMEOUT);
  });

  describe("isReady", () => {
    test("returns false before initialization", () => {
      const config = createDefaultConfig();
      const testEngine = createEmbeddingEngine(config);
      expect(testEngine.isReady()).toBe(false);
    });

    test("returns true after initialization", () => {
      // Using the beforeAll initialized engine
      expect(engine.isReady()).toBe(true);
    });
  });

  describe("dimensions", () => {
    test("returns 384 for all-MiniLM-L6-v2", () => {
      expect(engine.dimensions()).toBe(384);
    });
  });

  describe("semantic similarity", () => {
    test("semantically similar texts have higher cosine similarity", async () => {
      const dogEmbed = await engine.embed("dog");
      const puppyEmbed = await engine.embed("puppy");
      const jsEmbed = await engine.embed("javascript");

      // Calculate cosine similarity (since vectors are normalized, it's just the dot product)
      const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
        let dot = 0;
        for (let i = 0; i < a.length; i++) {
          const valA = a[i];
          const valB = b[i];
          if (valA !== undefined && valB !== undefined) {
            dot += valA * valB;
          }
        }
        return dot;
      };

      const dogPuppySim = cosineSimilarity(dogEmbed.vector, puppyEmbed.vector);
      const dogJsSim = cosineSimilarity(dogEmbed.vector, jsEmbed.vector);

      // "dog" should be more similar to "puppy" than to "javascript"
      expect(dogPuppySim).toBeGreaterThan(dogJsSim);
      expect(dogPuppySim).toBeGreaterThan(0.5); // Should be fairly similar
    }, TEST_TIMEOUT);
  });
});

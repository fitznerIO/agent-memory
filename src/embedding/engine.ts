import { pipeline } from "@huggingface/transformers";
import type { MemoryConfig } from "../shared/config.ts";
import type { EmbeddingEngine, EmbeddingResult } from "./types.ts";

export function createEmbeddingEngine(config: MemoryConfig): EmbeddingEngine {
  // biome-ignore lint/suspicious/noExplicitAny: transformers pipeline type is complex and internal
  let pipe: any = null;
  let ready = false;

  const initialize = async (): Promise<void> => {
    if (ready) return;
    pipe = await pipeline("feature-extraction", config.embeddingModel);
    ready = true;
  };

  const embed = async (text: string): Promise<EmbeddingResult> => {
    if (!ready) {
      await initialize();
    }
    const output = await pipe(text, { pooling: "mean", normalize: true });
    const vector = new Float32Array(output.data);
    return {
      text,
      vector,
      dimensions: config.embeddingDimensions,
    };
  };

  const embedBatch = async (texts: string[]): Promise<EmbeddingResult[]> => {
    if (texts.length === 0) return [];
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await embed(text));
    }
    return results;
  };

  const isReady = (): boolean => {
    return ready;
  };

  const dimensions = (): number => {
    return config.embeddingDimensions;
  };

  return {
    initialize,
    embed,
    embedBatch,
    isReady,
    dimensions,
  };
}

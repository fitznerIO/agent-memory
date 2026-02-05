export interface EmbeddingResult {
  text: string;
  vector: Float32Array;
  dimensions: number;
}

export interface EmbeddingEngine {
  initialize(): Promise<void>;
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  isReady(): boolean;
  dimensions(): number;
}

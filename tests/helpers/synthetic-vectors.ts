/**
 * Synthetic embeddings for search tests: a fixed query vector and vectors at a known distance
 * from it, so every entry has a fixed vector rank and no embedding model is loaded.
 */
export const DIMS = 384;

/** Timestamp shared by test entries, so recency cannot change their order. */
export const FIXED_TIME = Date.UTC(2026, 0, 15);

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIMS; i++) v[i] = v[i]! / norm;
  return v;
}

export const QUERY_VEC = normalize(
  (() => {
    const v = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) v[i] = Math.sin(i * 0.37) + 0.1;
    return v;
  })(),
);

const NOISE = normalize(
  (() => {
    const v = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) v[i] = Math.cos(i * 1.13) - 0.05;
    return v;
  })(),
);

/** A vector whose similarity to QUERY_VEC falls as `distance` grows; 0 is the closest. */
export function vectorAtDistance(distance: number): Float32Array {
  const v = new Float32Array(DIMS);
  const t = distance * 0.12;
  for (let i = 0; i < DIMS; i++) v[i] = QUERY_VEC[i]! + t * NOISE[i]!;
  return normalize(v);
}

/**
 * Migration: Discover initial connections between existing knowledge entries.
 *
 * For each entry, runs FTS5 + vector search to find related entries
 * and creates `related` connections for pairs with high similarity.
 *
 * PRD 11.4 — agent-memory migrate discover-connections (optional)
 */
import { createEmbeddingEngine } from "../embedding/engine.ts";
import type { SearchIndex } from "../search/types.ts";
import type { MemoryConfig } from "../shared/config.ts";
import type { ConnectionType, SearchResult } from "../shared/types.ts";

export interface DiscoveryResult {
  entryId: string;
  connectionsCreated: Array<{
    targetId: string;
    type: ConnectionType;
    score: number;
  }>;
}

/**
 * Discover connections for a single entry by searching for similar content.
 */
export async function discoverForEntry(
  entryId: string,
  searchIndex: SearchIndex,
  config: MemoryConfig,
  minScore = 0.8,
): Promise<DiscoveryResult> {
  const entry = await searchIndex.getKnowledgeById(entryId);
  if (!entry) {
    return { entryId, connectionsCreated: [] };
  }

  // Check existing connections to avoid duplicates
  const existingConns = await searchIndex.getConnections(entryId, "both");
  const existingTargets = new Set(
    existingConns.map((c) =>
      c.source_id === entryId ? c.target_id : c.source_id,
    ),
  );

  // Search for similar entries via FTS
  let ftsResults: SearchResult[] = [];
  try {
    const searchQuery = `${entry.title} ${entry.type}`;
    ftsResults = await searchIndex.searchText(searchQuery, 5);
  } catch {
    // FTS might fail
  }

  // Use embedding engine for vector search
  const embeddingEngine = createEmbeddingEngine(config);
  const titleEmbed = await embeddingEngine.embed(entry.title);
  const vecResults = await searchIndex.searchVector(titleEmbed.vector, 5);

  // Merge and deduplicate candidates
  const candidates = new Map<string, number>();

  for (const r of ftsResults) {
    const id = r.memory.metadata.id;
    if (id === entryId || existingTargets.has(id)) continue;
    const existing = candidates.get(id) ?? 0;
    candidates.set(id, Math.max(existing, r.score * 0.5));
  }

  for (const r of vecResults) {
    const id = r.memory.metadata.id;
    if (id === entryId || existingTargets.has(id)) continue;
    const existing = candidates.get(id) ?? 0;
    candidates.set(id, Math.max(existing, r.score));
  }

  // Filter by minimum score and create connections
  const connectionsCreated: DiscoveryResult["connectionsCreated"] = [];

  for (const [targetId, score] of candidates) {
    if (score < minScore) continue;

    // Create bidirectional `related` connection
    await searchIndex.insertConnection(entryId, targetId, "related");
    await searchIndex.insertConnection(targetId, entryId, "related");

    connectionsCreated.push({
      targetId,
      type: "related",
      score,
    });
  }

  return { entryId, connectionsCreated };
}

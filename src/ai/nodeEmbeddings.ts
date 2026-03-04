/**
 * Embed nodes and persist to node_embeddings for semantic search.
 *
 * ## node_embeddings spec
 * - **Model**: OpenAI text-embedding-ada-002 (1536 dimensions)
 * - **Text source**: label (suggestedLabel or label) + description + exports, joined and truncated to 8k chars
 * - **Flow**: For each node, call OpenAI embeddings.create; upsert into node_embeddings with
 *   (workspace_id, node_id, embedding). Unique on (workspace_id, node_id).
 * - **Requires**: OPENAI_API_KEY
 */
import type { ArchGraph, ArchNode } from "../types";
import type { SupabaseClient } from "@supabase/supabase-js";

function buildNodeText(node: ArchNode): string {
  const parts: string[] = [
    node.suggestedLabel ?? node.label,
    node.description ?? "",
    (node.semanticSignals?.exports ?? []).join(" "),
  ];
  return parts.filter(Boolean).join(" ").slice(0, 8000);
}

export async function embedAndPersistNodes(
  graph: ArchGraph,
  workspaceId: string,
  supabase: SupabaseClient,
  apiKey?: string
): Promise<{ embedded: number; failed: number }> {
  const key = apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return { embedded: 0, failed: graph.nodes.length };
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: key });

  let embedded = 0;
  let failed = 0;

  for (const node of graph.nodes) {
    const text = buildNodeText(node);
    if (!text.trim()) {
      failed++;
      continue;
    }

    try {
      const { data } = await client.embeddings.create({
        model: "text-embedding-ada-002",
        input: text,
      });
      const vec = data.data?.[0]?.embedding;
      if (!vec || vec.length !== 1536) {
        failed++;
        continue;
      }

      const { error } = await supabase.from("node_embeddings").upsert(
        {
          workspace_id: workspaceId,
          node_id: node.id,
          embedding: vec,
        },
        { onConflict: "workspace_id,node_id" }
      );

      if (error) {
        failed++;
        if (process.env.METRICS_LOG === "1") {
          console.warn(`[embeddings] upsert failed for ${node.id}:`, error.message);
        }
      } else {
        embedded++;
      }
    } catch (err) {
      failed++;
      if (process.env.METRICS_LOG === "1") {
        console.warn(`[embeddings] embed failed for ${node.id}:`, err);
      }
    }
  }

  return { embedded, failed };
}

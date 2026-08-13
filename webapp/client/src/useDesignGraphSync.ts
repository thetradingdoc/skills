import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { SyncNode } from "./graphSync";

/**
 * Post-V1 multiplayer design graph sync — realtime broadcast transport.
 *
 * Pairs with `graphSync.ts` (pure merge). This hook is deliberately dumb: it
 * only ships/receives patches over a Supabase Realtime broadcast channel and
 * hands them to the caller. It does NOT merge, persist, or debounce — that's
 * the caller's job (see App.tsx wiring, which merges remote `nodes_upsert`
 * patches into local state via `mergeGraphs`). Kept this thin on purpose so
 * we can land it without risking the existing save/autosave paths.
 *
 * Channel topic: `workspace:${workspaceId}:graph` — separate from the
 * presence channel (`workspace:${workspaceId}`) in useWorkspacePresence.ts,
 * so a noisy graph-edit session never competes with cursor/focus presence
 * updates on the same topic.
 */

export type GraphPatch = {
  type: "nodes_upsert";
  nodes: SyncNode[];
  revision?: number;
  userId: string;
};

const BROADCAST_EVENT = "graph_patch";

export function useDesignGraphSync(
  workspaceId: string | null,
  userId: string | null | undefined,
  onRemotePatch?: (patch: GraphPatch) => void
): {
  broadcastPatch: (patch: GraphPatch) => void;
  currentUserId: string | null;
} {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onRemotePatchRef = useRef(onRemotePatch);
  onRemotePatchRef.current = onRemotePatch;

  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);

  // Resolve current user lazily when the caller doesn't already have it handy
  // (mirrors useWorkspacePresence.ts so callers aren't forced to plumb userId).
  useEffect(() => {
    if (userId || !supabase) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setResolvedUserId(user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const effectiveUserId = userId ?? resolvedUserId;

  useEffect(() => {
    if (!supabase || !workspaceId || !effectiveUserId) {
      channelRef.current = null;
      return;
    }
    const sb = supabase;
    const channel = sb.channel(`workspace:${workspaceId}:graph`);

    channel
      .on("broadcast", { event: BROADCAST_EVENT }, ({ payload }) => {
        const patch = payload as GraphPatch;
        if (!patch || patch.userId === effectiveUserId) return; // ignore our own echoes
        onRemotePatchRef.current?.(patch);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      sb.removeChannel(channel);
      channelRef.current = null;
    };
  }, [workspaceId, effectiveUserId]);

  const broadcastPatch = useCallback((patch: GraphPatch) => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({ type: "broadcast", event: BROADCAST_EVENT, payload: patch });
  }, []);

  return { broadcastPatch, currentUserId: effectiveUserId };
}

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface PresenceFocus {
  kind: "node" | "layer" | "section";
  id: string;
  label?: string;
}

export interface PresenceUser {
  id: string;
  name: string;
  cursor?: { x: number; y: number } | null;
  /** What this user currently has selected/inspecting, if anything. */
  focus?: PresenceFocus | null;
}

type PresenceMeta = { userId: string; name: string; cursor?: { x: number; y: number } | null; focus?: PresenceFocus | null };

/**
 * Subscribe to workspace presence channel. Fetches current user from Supabase when not provided.
 *
 * Multiple components in the tree may call this for the same workspace (the
 * underlying Supabase channel is reused per topic). Every track() call reads
 * the caller's own last-known presence meta first and merges into it, so a
 * cursor update from one call site never clobbers a focus update from
 * another.
 */
export function useWorkspacePresence(
  workspaceId: string | null,
  userId?: string | null,
  userName?: string | null
): {
  users: PresenceUser[];
  trackCursor: (x: number, y: number) => void;
  trackFocus: (focus: PresenceFocus | null) => void;
  currentUserId: string | null;
} {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || !workspaceId) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) {
        setCurrentUser(null);
        return;
      }
      const name = (user.user_metadata?.nickname as string) ?? user.email?.split("@")[0] ?? "User";
      setCurrentUser({ id: user.id, name });
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const effectiveUserId = userId ?? currentUser?.id ?? null;
  const effectiveUserName = userName ?? currentUser?.name ?? "Anonymous";

  useEffect(() => {
    if (!supabase || !workspaceId || !effectiveUserId) {
      setUsers([]);
      return;
    }
    const sb = supabase;

    const channelName = `workspace:${workspaceId}`;
    const channel = sb.channel(channelName, {
      config: { presence: { key: effectiveUserId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceMeta>();
        const list: PresenceUser[] = [];
        for (const key of Object.keys(state)) {
          for (const pres of state[key]) {
            list.push({
              id: pres.userId,
              name: pres.name ?? "Anonymous",
              cursor: pres.cursor ?? null,
              focus: pres.focus ?? null,
            });
          }
        }
        setUsers(list);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            userId: effectiveUserId,
            name: effectiveUserName,
            cursor: null,
            focus: null,
          });
        }
      });

    channelRef.current = channel;

    return () => {
      sb.removeChannel(channel);
      channelRef.current = null;
      setUsers([]);
    };
  }, [workspaceId, effectiveUserId, effectiveUserName]);

  /** Reads this client's own last-tracked meta so a partial update doesn't drop the other fields. */
  const readOwnMeta = useCallback((): PresenceMeta | null => {
    const ch = channelRef.current;
    if (!ch || !effectiveUserId) return null;
    const state = ch.presenceState<PresenceMeta>();
    return state[effectiveUserId]?.[0] ?? null;
  }, [effectiveUserId]);

  const trackCursor = useCallback(
    (x: number, y: number) => {
      const ch = channelRef.current;
      if (!ch || !effectiveUserId) return;
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
        const mine = readOwnMeta();
        ch.track({
          userId: effectiveUserId,
          name: effectiveUserName,
          cursor: { x, y },
          focus: mine?.focus ?? null,
        });
      }, 80);
    },
    [effectiveUserId, effectiveUserName, readOwnMeta]
  );

  const trackFocus = useCallback(
    (focus: PresenceFocus | null) => {
      const ch = channelRef.current;
      if (!ch || !effectiveUserId) return;
      const mine = readOwnMeta();
      ch.track({
        userId: effectiveUserId,
        name: effectiveUserName,
        cursor: mine?.cursor ?? null,
        focus,
      });
    },
    [effectiveUserId, effectiveUserName, readOwnMeta]
  );

  return { users, trackCursor, trackFocus, currentUserId: effectiveUserId };
}

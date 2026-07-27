import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface PresenceUser {
  id: string;
  name: string;
  cursor?: { x: number; y: number } | null;
}

/**
 * Subscribe to workspace presence channel. Fetches current user from Supabase when not provided.
 */
export function useWorkspacePresence(
  workspaceId: string | null,
  userId?: string | null,
  userName?: string | null
): {
  users: PresenceUser[];
  trackCursor: (x: number, y: number) => void;
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

    const channelName = `workspace:${workspaceId}`;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: effectiveUserId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ userId: string; name: string; cursor?: { x: number; y: number } | null }>();
        const list: PresenceUser[] = [];
        for (const key of Object.keys(state)) {
          for (const pres of state[key]) {
            list.push({
              id: pres.userId,
              name: pres.name ?? "Anonymous",
              cursor: pres.cursor ?? null,
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
          });
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setUsers([]);
    };
  }, [workspaceId, effectiveUserId, effectiveUserName]);

  const trackCursor = useCallback(
    (x: number, y: number) => {
      const ch = channelRef.current;
      if (!ch || !effectiveUserId) return;
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
        ch.track({
          userId: effectiveUserId,
          name: effectiveUserName,
          cursor: { x, y },
        });
      }, 80);
    },
    [effectiveUserId, effectiveUserName]
  );

  return { users, trackCursor, currentUserId: effectiveUserId };
}

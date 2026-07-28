import { useEffect, type RefObject } from "react";
import { useReactFlow } from "reactflow";
import { useWorkspacePresence } from "./useWorkspacePresence";

interface Props {
  workspaceId: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
}

/** Tracks local cursor and renders remote cursors. Rendered inside ReactFlow so flow coords align. */
export function PresenceCursorsOverlay({ workspaceId, containerRef }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const { users, trackCursor, currentUserId } = useWorkspacePresence(workspaceId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Use pane if available (React Flow 11), else attach to container for mousemove
    const pane =
      container.querySelector(".react-flow__pane") ??
      container.querySelector("[class*='pane']") ??
      container;
    const onMove = (e: MouseEvent) => {
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      trackCursor(pos.x, pos.y);
    };
    pane.addEventListener("mousemove", onMove);
    return () => pane.removeEventListener("mousemove", onMove);
  }, [screenToFlowPosition, trackCursor, containerRef]);

  const others = users.filter((u) => u.cursor && u.id !== currentUserId);

  if (others.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {others.map((u) =>
        u.cursor ? (
          <div
            key={u.id}
            style={{
              position: "absolute",
              left: u.cursor.x,
              top: u.cursor.y,
              transform: "translate(-2px, -2px)",
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid #1f6feb",
              background: "rgba(59, 130, 246, 0.3)",
              boxShadow: "0 0 8px rgba(59, 130, 246, 0.5)",
              transition: "left 0.05s ease-out, top 0.05s ease-out",
            }}
            title={u.name}
          >
            <div
              style={{
                position: "absolute",
                left: 14,
                top: -4,
                padding: "2px 6px",
                fontSize: 10,
                background: "#1e293b",
                color: "#e2e8f0",
                borderRadius: 4,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {u.name}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}

/**
 * Ops dock — Rollup + Changes (sole Rollup entry; gated by rail visibility).
 */
import { useState } from "react";
import type { ArchGraph } from "../types";
import { ManagementRollupView } from "../ManagementRollupView";
import { ChangesView } from "../ChangesView";
import { ACCENT, CANVAS, FONT_UI, LINE, SLATE } from "../theme/tokens";

type Props = {
  graph: ArchGraph;
  workspaceId?: string | null;
  accessToken?: string | null;
  apiBase?: string;
  onSelectNode?: (nodeId: string) => void;
  onConnectGitHub?: () => void;
  rollupRefreshKey?: number;
  initialSub?: "rollup" | "changes";
};

export function OpsDock({
  graph,
  workspaceId,
  accessToken,
  apiBase = "/api",
  onSelectNode,
  onConnectGitHub,
  rollupRefreshKey = 0,
  initialSub = "rollup",
}: Props) {
  const [opsSub, setOpsSub] = useState<"rollup" | "changes">(initialSub);

  const crumb = `Ops · ${opsSub === "rollup" ? "Rollup" : "Changes"}`;

  return (
    <div data-testid="blanko-ops-dock" style={{ height: "100%", fontFamily: FONT_UI, display: "flex", flexDirection: "column" }}>
      <div
        data-testid="blanko-ops-breadcrumb"
        style={{
          padding: "8px 12px",
          fontSize: 11,
          color: SLATE,
          borderBottom: `1px solid ${LINE}`,
          background: CANVAS,
        }}
      >
        {crumb}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${LINE}` }}>
        <button
          type="button"
          data-testid="blanko-ops-rollup"
          onClick={() => setOpsSub("rollup")}
          style={{
            fontSize: 11,
            fontWeight: 700,
            border: "none",
            background: "transparent",
            color: opsSub === "rollup" ? ACCENT : SLATE,
            cursor: "pointer",
          }}
        >
          Rollup
        </button>
        <button
          type="button"
          data-testid="blanko-ops-changes"
          onClick={() => setOpsSub("changes")}
          style={{
            fontSize: 11,
            fontWeight: 700,
            border: "none",
            background: "transparent",
            color: opsSub === "changes" ? ACCENT : SLATE,
            cursor: "pointer",
          }}
        >
          Changes
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {opsSub === "rollup" ? (
          workspaceId ? (
            <ManagementRollupView
              graph={graph}
              workspaceId={workspaceId}
              accessToken={accessToken ?? null}
              apiBase={apiBase}
              onSelectNode={onSelectNode}
              onConnectGitHub={onConnectGitHub}
              refreshKey={rollupRefreshKey}
            />
          ) : (
            <div style={{ padding: 14, fontSize: 12, color: SLATE }}>Open a workspace for rollup.</div>
          )
        ) : (
          <ChangesView
            graph={graph}
            apiBase={apiBase}
            accessToken={accessToken ?? null}
            workspaceId={workspaceId ?? null}
          />
        )}
      </div>
    </div>
  );
}

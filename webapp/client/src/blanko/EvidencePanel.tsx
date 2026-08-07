import type { ReactNode } from "react";
import { CANVAS, FONT_UI, INK, LINE, SLATE } from "../theme/tokens";

type Props = {
  hasRepoFiles: boolean;
  files: ReactNode;
};

/** Workspace Files sheet — proof on disk. Terminal lives only on the right wall. */
export function EvidencePanel({ hasRepoFiles, files }: Props) {
  return (
    <div data-testid="blanko-evidence" style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: FONT_UI }}>
      <div
        style={{
          padding: "10px 14px",
          fontSize: 11,
          color: SLATE,
          borderBottom: `1px solid ${LINE}`,
          lineHeight: 1.4,
        }}
      >
        Files linked to this workspace. Use <strong style={{ color: INK }}>Terminal</strong> on the right wall for a
        shell.
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: CANVAS }}>
        {hasRepoFiles ? (
          files
        ) : (
          <div data-testid="blanko-evidence-files-empty" style={{ padding: 16, fontSize: 13, color: SLATE, lineHeight: 1.5 }}>
            Scan a GitHub repo to browse files here. Design-only and n8n imports stay empty until a repo is linked.
          </div>
        )}
      </div>
    </div>
  );
}

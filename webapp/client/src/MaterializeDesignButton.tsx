/**
 * Post-V1: "Materialize" — turn a design-mode graph (nodes drawn on the
 * canvas, no scan behind them yet) into real folders + boilerplate files on
 * disk, via POST /api/design-materialize. Sits next to Export/Save in the
 * design-mode toolbar.
 */
import { useCallback, useState } from "react";
import type { ArchGraph } from "./types";
import { materializeDesignGraph } from "./designMaterialize";

const DEFAULT_TARGET_ROOT = "/tmp/littlelabs-materialize";

type Props = {
  graph: ArchGraph | null;
  apiBase: string;
  accessToken: string | null;
  disabled?: boolean;
  /** Called when the user tries to materialize without being signed in. */
  onRequireAuth?: () => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; created: number; skipped: number; errors: number }
  | { kind: "error"; message: string };

export function MaterializeDesignButton({ graph, apiBase, accessToken, disabled, onRequireAuth }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const nodeCount = graph?.nodes.length ?? 0;
  const isDisabled = !!disabled || nodeCount === 0 || status.kind === "running";

  const handleClick = useCallback(async () => {
    if (!graph || nodeCount === 0) return;

    if (!accessToken) {
      onRequireAuth?.();
      return;
    }

    const targetRoot = window.prompt(
      "Materialize this design to a folder on disk. Target directory:",
      DEFAULT_TARGET_ROOT
    );
    if (!targetRoot || !targetRoot.trim()) return;

    setStatus({ kind: "running" });
    try {
      const result = await materializeDesignGraph({
        apiBase,
        token: accessToken,
        targetRoot: targetRoot.trim(),
        nodes: graph.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          layer: n.layer,
          techKind: n.techKind,
          kind: n.kind,
          path: n.path,
        })),
      });
      setStatus({
        kind: "done",
        created: result.created.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
      });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [graph, nodeCount, accessToken, apiBase, onRequireAuth]);

  const label =
    status.kind === "running"
      ? "Materializing…"
      : status.kind === "done"
        ? `Created ${status.created}${status.skipped ? ` · ${status.skipped} skipped` : ""}${
            status.errors ? ` · ${status.errors} errors` : ""
          }`
        : status.kind === "error"
          ? "Materialize failed — retry?"
          : "Materialize";

  return (
    <button
      type="button"
      data-testid="materialize-design-btn"
      title="Create real folders and boilerplate files on disk for every node in this design"
      disabled={isDisabled}
      onClick={handleClick}
      style={{
        padding: "4px 12px",
        fontSize: 10,
        borderRadius: 999,
        border: status.kind === "error" ? "1px solid #f85149" : "1px solid #30363d",
        background: status.kind === "done" ? "rgba(63,185,80,0.12)" : "transparent",
        color: status.kind === "error" ? "#f85149" : status.kind === "done" ? "#3fb950" : "#8b949e",
        cursor: isDisabled ? "default" : "pointer",
        fontFamily: "monospace",
        opacity: isDisabled && status.kind !== "running" ? 0.5 : 1,
        marginLeft: 8,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

export default MaterializeDesignButton;

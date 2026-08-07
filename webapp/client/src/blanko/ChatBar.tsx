import { useState } from "react";
import type { GraphCommand } from "../types";
import type { ArchitectureChatMessage } from "../types";
import { ACCENT, ACCENT_WASH, BAD, CANVAS, FONT_MONO, FONT_UI, INK, LINE, PAPER, SLATE } from "../theme/tokens";

type Props = {
  expanded: boolean;
  onToggleExpand: () => void;
  messages: ArchitectureChatMessage[];
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  pendingCommands: GraphCommand[] | null;
  chatOnlyNotice: boolean;
  onAccept: () => void;
  onReject: () => void;
  onPlusBuild: () => void;
  onPlusN8n: () => void;
  onPlusGithub: () => void;
  canUndoAccept?: boolean;
  onUndoAccept?: () => void;
  lastAcceptWhy?: string | null;
};

function describeCommand(cmd: GraphCommand): string {
  if (cmd.action === "create_node") return `Add node “${cmd.label}” (${cmd.layer})`;
  if (cmd.action === "connect") return `Connect ${cmd.fromId} → ${cmd.toId}`;
  if (cmd.action === "update_node") return `Update ${cmd.id}`;
  if (cmd.action === "focus_node") return `Focus ${cmd.nodeId}`;
  if (cmd.action === "highlight_nodes") return `Highlight ${(cmd.nodeIds ?? []).length} node(s)`;
  return cmd.action;
}

/** Floating brainstorm pill — soft shadow, sparkle + field + chevron (image-2). */
export function ChatBar({
  expanded,
  onToggleExpand,
  messages,
  draft,
  onDraftChange,
  onSend,
  loading,
  pendingCommands,
  chatOnlyNotice,
  onAccept,
  onReject,
  onPlusBuild,
  onPlusN8n,
  onPlusGithub,
  canUndoAccept,
  onUndoAccept,
  lastAcceptWhy,
}: Props) {
  const showTray =
    expanded || !!(pendingCommands && pendingCommands.length > 0);

  return (
    <div
      data-testid="blanko-chat-bar"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        width: "min(520px, calc(100% - 48px))",
        zIndex: 30,
        fontFamily: FONT_UI,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none",
        alignItems: "stretch",
      }}
    >
      {showTray && (
        <div
          style={{
            pointerEvents: "auto",
            background: CANVAS,
            borderRadius: 20,
            boxShadow: "0 12px 40px rgba(18,19,26,0.1), 0 2px 8px rgba(18,19,26,0.04)",
            overflow: "hidden",
            maxHeight: "min(42vh, 420px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {expanded && (
            <div
              data-testid="blanko-chat-history"
              style={{
                flex: 1,
                overflow: "auto",
                padding: "14px 16px",
                minHeight: 100,
                maxHeight: "26vh",
                borderBottom:
                  (pendingCommands && pendingCommands.length > 0) || chatOnlyNotice || (canUndoAccept && onUndoAccept)
                    ? `1px solid ${LINE}`
                    : "none",
                background: CANVAS,
              }}
            >
              {messages.length === 0 && (
                <div>
                  <div style={{ fontSize: 13, color: SLATE, lineHeight: 1.45, marginBottom: 10 }}>
                    Design your agent on the AI design canvas — changes appear as proposals you Accept.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[
                      "Design a trading agent with RAG and strategies",
                      "Add Retell as the voice channel",
                      "Add a RAG path to this agent",
                    ].map((seed) => (
                      <button
                        key={seed}
                        type="button"
                        data-testid={`blanko-chat-seed-${seed.slice(0, 12).replace(/\s/g, "-")}`}
                        onClick={() => onDraftChange(seed)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: `1px solid ${LINE}`,
                          background: PAPER,
                          color: INK,
                          fontFamily: FONT_UI,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {seed}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.slice(-12).map((m, i) => (
                <div
                  key={`${m.role}-${i}-${m.content.slice(0, 12)}`}
                  style={{
                    marginBottom: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: m.role === "user" ? INK : PAPER,
                    color: m.role === "user" ? CANVAS : INK,
                    border: m.role === "user" ? "none" : `1px solid ${LINE}`,
                    fontSize: 13,
                    lineHeight: 1.45,
                    maxWidth: "92%",
                    marginLeft: m.role === "user" ? "auto" : 0,
                  }}
                >
                  {m.content.slice(0, 800)}
                  {m.content.length > 800 ? "…" : ""}
                </div>
              ))}
            </div>
          )}

          {pendingCommands && pendingCommands.length > 0 ? (
            <div
              data-testid="blanko-proposed-changes"
              style={{
                padding: "10px 16px",
                background: ACCENT_WASH,
                borderBottom: expanded ? `1px solid ${LINE}` : "none",
              }}
            >
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  color: ACCENT,
                  marginBottom: 6,
                }}
              >
                PROPOSED CHANGES
              </div>
              <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12, color: INK, lineHeight: 1.45 }}>
                {pendingCommands.map((c, i) => (
                  <li key={i}>{describeCommand(c)}</li>
                ))}
              </ul>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" data-testid="blanko-propose-accept" onClick={onAccept} style={acceptBtn}>
                  Accept
                </button>
                <button type="button" data-testid="blanko-propose-reject" onClick={onReject} style={rejectBtn}>
                  Reject
                </button>
              </div>
            </div>
          ) : null}

          {expanded && (chatOnlyNotice || (canUndoAccept && onUndoAccept)) ? (
            <div>
              {chatOnlyNotice && !(pendingCommands && pendingCommands.length > 0) ? (
                <div
                  data-testid="blanko-chat-only-notice"
                  style={{
                    padding: "10px 16px",
                    background: ACCENT_WASH,
                    fontSize: 12,
                    color: SLATE,
                    lineHeight: 1.45,
                  }}
                >
                  Answered in chat only — no graph changes. Ask blanko to{" "}
                  <strong style={{ color: INK }}>add or connect nodes</strong> if you want the canvas to
                  update.
                </div>
              ) : null}
              {canUndoAccept && onUndoAccept ? (
                <div
                  data-testid="blanko-accept-undo"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 16px",
                    background: PAPER,
                    fontSize: 12,
                    color: SLATE,
                  }}
                >
                  <span style={{ flex: 1, lineHeight: 1.4 }}>
                    {lastAcceptWhy ?? "Applied proposed changes to the canvas."}
                  </span>
                  <button
                    type="button"
                    data-testid="blanko-undo-accept"
                    onClick={onUndoAccept}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: `1px solid ${LINE}`,
                      background: CANVAS,
                      color: INK,
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Undo
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {/* Image-2 composer pill */}
      <div
        style={{
          pointerEvents: "auto",
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px 10px 12px",
          background: CANVAS,
          borderRadius: 999,
          boxShadow: "0 10px 32px rgba(18,19,26,0.1), 0 2px 6px rgba(18,19,26,0.04)",
          border: "none",
        }}
      >
        <PlusMenu onBuild={onPlusBuild} onN8n={onPlusN8n} onGithub={onPlusGithub} />

        <input
          data-testid="blanko-chat-input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Brainstorm or ask something…"
          disabled={loading}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: FONT_UI,
            fontSize: 15,
            color: INK,
            padding: "6px 0",
          }}
        />

        <span
          aria-hidden
          style={{
            width: 1,
            height: 22,
            background: LINE,
            flexShrink: 0,
          }}
        />

        <button
          type="button"
          data-testid="blanko-chat-expand"
          onClick={onToggleExpand}
          title={expanded ? "Collapse chat" : "Expand chat"}
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            border: "none",
            background: "transparent",
            color: SLATE,
            cursor: "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <ChevronIcon up={!expanded} />
        </button>

        {/* Hidden send for tests + Enter; visible only while loading or as a11y */}
        <button
          type="button"
          data-testid="blanko-chat-send"
          onClick={onSend}
          disabled={loading || !draft.trim()}
          aria-label="Send"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5l1.2 5.1L18 9.8l-4.8 1.2L12 16.5l-1.2-5.5L6 9.8l4.8-1.2L12 3.5z"
        fill={ACCENT}
      />
      <path
        d="M18.5 14.5l.55 2.2 2.15.55-2.15.55-.55 2.2-.55-2.2-2.15-.55 2.15-.55.55-2.2z"
        fill={ACCENT}
        opacity={0.85}
      />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ transform: up ? "none" : "rotate(180deg)", transition: "transform 0.15s ease" }}
    >
      <path
        d="M6 14.5L12 8.5l6 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusMenu({
  onBuild,
  onN8n,
  onGithub,
}: {
  onBuild: () => void;
  onN8n: () => void;
  onGithub: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        data-testid="blanko-chat-plus"
        onClick={() => setOpen((v) => !v)}
        title="Add · Components, n8n, GitHub"
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          border: "none",
          background: open ? ACCENT_WASH : "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        <SparkleIcon />
      </button>
      {open && (
        <div
          data-testid="blanko-chat-plus-menu"
          style={{
            position: "absolute",
            bottom: 44,
            left: 0,
            width: 200,
            background: CANVAS,
            border: `1px solid ${LINE}`,
            borderRadius: 12,
            boxShadow: "0 12px 28px rgba(18,19,26,0.12)",
            padding: 6,
            zIndex: 30,
          }}
        >
          {[
            { label: "Open Components", fn: onBuild },
            { label: "Upload n8n JSON", fn: onN8n },
            { label: "Import GitHub…", fn: onGithub },
          ].map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                a.fn();
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                background: "transparent",
                borderRadius: 8,
                fontFamily: FONT_UI,
                fontSize: 13,
                color: INK,
                cursor: "pointer",
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const acceptBtn = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: INK,
  color: CANVAS,
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};

const rejectBtn = {
  ...acceptBtn,
  background: CANVAS,
  color: BAD,
  border: `1px solid ${LINE}`,
};

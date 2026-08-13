import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { GraphCommand } from "../types";
import type { ArchitectureChatMessage } from "../types";
import { ACCENT, ACCENT_WASH, BAD, CANVAS, FONT_MONO, FONT_UI, INK, LINE, PAPER, SLATE } from "../theme/tokens";

/** Space below ChromeBar before expanded chat starts. */
const CHROME_OFFSET_PX = 56;

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

/**
 * Floating brainstorm chat.
 * Collapsed: bottom-center pill.
 * Expanded: tall panel from below ChromeBar → bottom, unified card (history + composer).
 */
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
  const historyRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!expanded || !stickToBottomRef.current) return;
    const el = historyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [expanded, messages, loading, pendingCommands]);

  const onHistoryScroll = () => {
    const el = historyRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 48;
  };

  const shellStyle: CSSProperties = expanded
    ? {
        position: "absolute",
        left: "50%",
        top: CHROME_OFFSET_PX,
        bottom: 16,
        transform: "translateX(-50%)",
        width: "min(720px, calc(100% - 48px))",
        zIndex: 30,
        fontFamily: FONT_UI,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        pointerEvents: "none",
        alignItems: "stretch",
      }
    : {
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
      };

  const composer = (
    <ComposerRow
      draft={draft}
      onDraftChange={onDraftChange}
      onSend={onSend}
      loading={loading}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      onPlusBuild={onPlusBuild}
      onPlusN8n={onPlusN8n}
      onGithub={onPlusGithub}
      pill={!expanded}
    />
  );

  if (expanded) {
    return (
      <div data-testid="blanko-chat-bar" data-expanded="true" style={shellStyle}>
        <div
          style={{
            pointerEvents: "auto",
            flex: 1,
            minHeight: 0,
            background: CANVAS,
            borderRadius: 20,
            boxShadow: "0 12px 40px rgba(18,19,26,0.1), 0 2px 8px rgba(18,19,26,0.04)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            border: `1px solid ${LINE}`,
          }}
        >
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderBottom: `1px solid ${LINE}`,
              background: PAPER,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>Architecture chat</div>
              <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>
                Long threads stay readable — canvas peeks on the sides
              </div>
            </div>
            <button
              type="button"
              data-testid="blanko-chat-expand"
              onClick={onToggleExpand}
              title="Collapse chat"
              style={iconBtn}
            >
              <ChevronIcon up={false} />
            </button>
          </div>

          <div
            ref={historyRef}
            data-testid="blanko-chat-history"
            onScroll={onHistoryScroll}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: "14px 16px",
              background: CANVAS,
            }}
          >
            <HistoryBody
              messages={messages}
              onDraftChange={onDraftChange}
              truncateAt={null}
            />
          </div>

          <ProposalsAndNotices
            pendingCommands={pendingCommands}
            chatOnlyNotice={chatOnlyNotice}
            canUndoAccept={canUndoAccept}
            onUndoAccept={onUndoAccept}
            lastAcceptWhy={lastAcceptWhy}
            onAccept={onAccept}
            onReject={onReject}
            expanded
          />

          <div
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${LINE}`,
              padding: "10px 12px 12px",
              background: PAPER,
            }}
          >
            {composer}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="blanko-chat-bar" data-expanded="false" style={shellStyle}>
      {showTray && (
        <div
          style={{
            pointerEvents: "auto",
            background: CANVAS,
            borderRadius: 20,
            boxShadow: "0 12px 40px rgba(18,19,26,0.1), 0 2px 8px rgba(18,19,26,0.04)",
            overflow: "hidden",
            maxHeight: "min(36vh, 320px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ProposalsAndNotices
            pendingCommands={pendingCommands}
            chatOnlyNotice={false}
            canUndoAccept={false}
            onUndoAccept={undefined}
            lastAcceptWhy={null}
            onAccept={onAccept}
            onReject={onReject}
            expanded={false}
          />
        </div>
      )}
      {composer}
    </div>
  );
}

function HistoryBody({
  messages,
  onDraftChange,
  truncateAt,
}: {
  messages: ArchitectureChatMessage[];
  onDraftChange: (v: string) => void;
  truncateAt: number | null;
}) {
  return (
    <>
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
      {messages.map((m, i) => {
        const raw = m.content ?? "";
        const shown =
          truncateAt != null && raw.length > truncateAt ? `${raw.slice(0, truncateAt)}…` : raw;
        const isUser = m.role === "user";
        return (
          <div
            key={`${m.role}-${i}-${raw.slice(0, 12)}`}
            data-testid={isUser ? "blanko-chat-msg-user" : "blanko-chat-msg-assistant"}
            style={{
              marginBottom: 10,
              padding: "10px 12px",
              borderRadius: 12,
              background: isUser ? INK : PAPER,
              color: isUser ? CANVAS : INK,
              border: isUser ? "none" : `1px solid ${LINE}`,
              fontSize: 13,
              lineHeight: 1.55,
              maxWidth: "94%",
              marginLeft: isUser ? "auto" : 0,
              wordBreak: "break-word",
            }}
          >
            <ChatMarkdown content={shown} tone={isUser ? "onInk" : "onPaper"} />
          </div>
        );
      })}
    </>
  );
}

/**
 * Cursor-like markdown: **bold** renders bold, `code` as pills, fences as blocks.
 */
function ChatMarkdown({ content, tone }: { content: string; tone: "onPaper" | "onInk" }) {
  const onInk = tone === "onInk";
  const body = onInk ? CANVAS : INK;
  const muted = onInk ? "rgba(255,255,255,0.65)" : SLATE;
  const link = onInk ? "#F9A8D4" : ACCENT;
  const inlineCodeBg = onInk ? "rgba(253, 242, 248, 0.18)" : ACCENT_WASH;
  const inlineCodeFg = onInk ? "#FBCFE8" : "#9F1239";
  const inlineCodeBorder = onInk ? "rgba(249, 168, 212, 0.35)" : "rgba(239, 50, 166, 0.22)";
  const hr = onInk ? "rgba(255,255,255,0.2)" : LINE;

  return (
    <div className="blanko-chat-md" style={{ color: body, fontFamily: FONT_UI }}>
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p style={{ margin: "0 0 0.65em" }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 700, color: body }}>{children}</strong>
          ),
          em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
          h1: ({ children }) => <MdHeading level={1} color={body}>{children}</MdHeading>,
          h2: ({ children }) => <MdHeading level={2} color={body}>{children}</MdHeading>,
          h3: ({ children }) => <MdHeading level={3} color={body}>{children}</MdHeading>,
          h4: ({ children }) => <MdHeading level={4} color={body}>{children}</MdHeading>,
          ul: ({ children }) => (
            <ul style={{ margin: "0 0 0.65em", paddingLeft: 18 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: "0 0 0.65em", paddingLeft: 18 }}>{children}</ol>
          ),
          li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
          hr: () => (
            <hr style={{ border: "none", borderTop: `1px solid ${hr}`, margin: "12px 0" }} />
          ),
          a: ({ href, children, ...props }) => {
            const railIdMatch = typeof href === "string" && href.match(/^#rail:(.+)$/);
            if (railIdMatch) {
              return (
                <span style={{ color: link, fontFamily: FONT_MONO, fontSize: "0.92em" }}>
                  {children ?? railIdMatch[1]}
                </span>
              );
            }
            return (
              <a
                href={href}
                {...props}
                style={{ color: link, textDecoration: "underline" }}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "0 0 0.65em",
                padding: "4px 0 4px 12px",
                borderLeft: `3px solid ${onInk ? "rgba(255,255,255,0.35)" : LINE}`,
                color: muted,
              }}
            >
              {children}
            </blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const text = String(children).replace(/\n$/, "");
            const isBlock = !!match || text.includes("\n");

            if (isBlock) {
              return (
                <SyntaxHighlighter
                  style={vscDarkPlus}
                  language={match?.[1] ?? "text"}
                  PreTag="div"
                  customStyle={{
                    borderRadius: 8,
                    fontSize: "0.85em",
                    margin: "10px 0",
                    padding: "12px 14px",
                  }}
                >
                  {text}
                </SyntaxHighlighter>
              );
            }

            return (
              <code
                style={{
                  backgroundColor: inlineCodeBg,
                  color: inlineCodeFg,
                  padding: "1px 6px",
                  borderRadius: 5,
                  fontSize: "0.9em",
                  fontFamily: FONT_MONO,
                  border: `1px solid ${inlineCodeBorder}`,
                  wordBreak: "break-word",
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MdHeading({
  level,
  color,
  children,
}: {
  level: 1 | 2 | 3 | 4;
  color: string;
  children: ReactNode;
}) {
  const sizes = { 1: 17, 2: 15, 3: 14, 4: 13 } as const;
  return (
    <div
      role="heading"
      aria-level={level}
      style={{
        fontSize: sizes[level],
        fontWeight: 700,
        color,
        margin: "0.85em 0 0.4em",
        lineHeight: 1.3,
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </div>
  );
}

function ProposalsAndNotices({
  pendingCommands,
  chatOnlyNotice,
  canUndoAccept,
  onUndoAccept,
  lastAcceptWhy,
  onAccept,
  onReject,
  expanded,
}: {
  pendingCommands: GraphCommand[] | null;
  chatOnlyNotice: boolean;
  canUndoAccept?: boolean;
  onUndoAccept?: () => void;
  lastAcceptWhy?: string | null;
  onAccept: () => void;
  onReject: () => void;
  expanded: boolean;
}) {
  return (
    <>
      {pendingCommands && pendingCommands.length > 0 ? (
        <div
          data-testid="blanko-proposed-changes"
          style={{
            flexShrink: 0,
            padding: "10px 16px",
            background: ACCENT_WASH,
            borderTop: expanded ? `1px solid ${LINE}` : "none",
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
        <div style={{ flexShrink: 0 }}>
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
    </>
  );
}

function ComposerRow({
  draft,
  onDraftChange,
  onSend,
  loading,
  expanded,
  onToggleExpand,
  onPlusBuild,
  onPlusN8n,
  onGithub,
  pill,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onPlusBuild: () => void;
  onPlusN8n: () => void;
  onGithub: () => void;
  pill: boolean;
}) {
  return (
    <div
      style={{
        pointerEvents: "auto",
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: pill ? "10px 14px 10px 12px" : "4px 4px 4px 6px",
        background: pill ? CANVAS : "transparent",
        borderRadius: pill ? 999 : 14,
        boxShadow: pill ? "0 10px 32px rgba(18,19,26,0.1), 0 2px 6px rgba(18,19,26,0.04)" : "none",
        border: pill ? "none" : `1px solid ${LINE}`,
      }}
    >
      <PlusMenu onBuild={onPlusBuild} onN8n={onPlusN8n} onGithub={onGithub} />

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

      {!expanded ? (
        <button
          type="button"
          data-testid="blanko-chat-expand"
          onClick={onToggleExpand}
          title="Expand chat"
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
          <ChevronIcon up />
        </button>
      ) : null}

      <button
        type="button"
        data-testid="blanko-chat-send"
        onClick={onSend}
        disabled={loading || !draft.trim()}
        aria-label="Send"
        title="Send"
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: `1px solid ${LINE}`,
          background: loading || !draft.trim() ? PAPER : ACCENT_WASH,
          color: loading || !draft.trim() ? SLATE : ACCENT,
          cursor: loading || !draft.trim() ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontFamily: FONT_MONO,
          fontWeight: 600,
          padding: 0,
        }}
      >
        {loading ? "…" : "↑"}
      </button>
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

const iconBtn: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: `1px solid ${LINE}`,
  background: CANVAS,
  color: SLATE,
  cursor: "pointer",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

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

import { useState, useRef, useCallback } from "react";
import { styles } from "./styles";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  id: string;
  label: string;
  history: ChatMessage[];
}

interface ChatPanelProps {
  chats: ChatSession[];
  activeChatId: string;
  onActiveChatChange: (id: string) => void;
  onAddChat: () => void;
  onSend: (message: string, history: ChatMessage[]) => void;
  selectedNode: string | null;
  loading?: boolean;
  onCriticCreateJira?: (message: ChatMessage) => void;
  onCriticCreateTasks?: (message: ChatMessage) => void;
}

export function ChatPanel({
  chats,
  activeChatId,
  onActiveChatChange,
  onAddChat,
  onSend,
  selectedNode,
  loading = false,
  onCriticCreateJira,
  onCriticCreateTasks,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeChat = chats.find((c) => c.id === activeChatId) ?? chats[0];
  const history = activeChat?.history ?? [];

  const handleSubmit = useCallback(() => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    onSend(q, history);
    setTimeout(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }, 0);
  }, [input, loading, history, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  };

  return (
    <div style={{ ...styles.chatPanel, flex: 1, minHeight: 0 }}>
      {/* Tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          padding: "8px 12px 0",
          background: "#161b22",
          borderBottom: "1px solid #30363d",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "#8b949e",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          Agent
        </span>
        {chats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => onActiveChatChange(chat.id)}
            style={
              activeChatId === chat.id
                ? { ...styles.tabActive }
                : { ...styles.tabInactive }
            }
          >
            {chat.label}
          </button>
        ))}
        <button
          onClick={onAddChat}
          title="New chat — Start a fresh conversation"
          style={{
            ...styles.tabInactive,
            marginLeft: 4,
            width: 36,
            padding: 0,
            fontSize: 16,
          }}
        >
          +
        </button>
      </div>

      {/* Scrollable messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 0,
        }}
      >
        {history.length === 0 && !loading && (
          <div
            style={{
              color: "#7d8590",
              fontSize: 12,
              padding: 16,
              textAlign: "center",
            }}
          >
            Ask about your architecture, dependencies, or patterns.
          </div>
        )}
        {history.map((m, i) => {
          const isCritic = m.role === "assistant" && m.content.startsWith("Critic:");
          const content = isCritic ? m.content.replace(/^Critic:\s*/i, "") : m.content;
          return (
            <div
              key={i}
              style={{
                padding: 10,
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background:
                  m.role === "user"
                    ? "#1e3a5f"
                    : isCritic
                      ? "rgba(245,158,11,0.12)"
                      : "#1c2128",
                border:
                  m.role === "user"
                    ? "1px solid #30363d"
                    : isCritic
                      ? "1px solid #f59e0b44"
                      : "1px solid #30363d",
                color:
                  m.role === "user"
                    ? "#e6edf3"
                    : isCritic
                      ? "#fbbf24"
                      : "#c9d1d9",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: isCritic ? "#f59e0b" : "#7d8590",
                  marginBottom: 4,
                  textTransform: "uppercase",
                }}
              >
                {m.role === "user" ? "You" : isCritic ? "Critic" : "Assistant"}
              </div>
              <div style={{ marginBottom: isCritic && (onCriticCreateJira || onCriticCreateTasks) ? 6 : 0 }}>
                {content}
              </div>
              {isCritic && (onCriticCreateJira || onCriticCreateTasks) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                  {onCriticCreateJira && (
                    <button
                      onClick={() => onCriticCreateJira(m)}
                      style={{
                        ...styles.buttonBase,
                        ...styles.buttonSecondary,
                        padding: "4px 8px",
                        height: 24,
                        fontSize: 10,
                      }}
                    >
                      Create Jira from critique
                    </button>
                  )}
                  {onCriticCreateTasks && (
                    <button
                      onClick={() => onCriticCreateTasks(m)}
                      style={{
                        ...styles.buttonBase,
                        padding: "4px 8px",
                        height: 24,
                        fontSize: 10,
                      }}
                    >
                      Create tasks from critique
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {loading && (
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              background: "#1c2128",
              border: "1px solid #30363d",
              color: "#7d8590",
              fontSize: 12,
            }}
          >
            Thinking...
          </div>
        )}
      </div>

      {/* Input bar - ChatGPT style */}
      <div
        style={{
          padding: 12,
          borderTop: "1px solid #30363d",
          background: "#161b22",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            background: "#0d1117",
            border: "1px solid #30363d",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedNode
                ? `Ask about ${selectedNode}...`
                : "Ask about your architecture..."
            }
            rows={1}
            disabled={loading}
            style={{
              flex: 1,
              minHeight: 24,
              maxHeight: 120,
              background: "transparent",
              border: "none",
              color: "#e6edf3",
              padding: 0,
              fontSize: 13,
              resize: "none",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            title="Send (Enter)"
            style={{
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#238636",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              fontSize: 16,
              flexShrink: 0,
              opacity: loading || !input.trim() ? 0.6 : 1,
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

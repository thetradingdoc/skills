import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { ArchGraph } from "./types";

interface LearnPanelProps {
  graph: ArchGraph | null;
  tourActive: boolean;
  currentStep: number;
  onStart: () => void;
  onStop: () => void;
  onSetStep: (index: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onSelectNode: (nodeId: string) => void;
}

export default function LearnPanel({
  graph,
  tourActive,
  currentStep,
  onStart,
  onStop,
  onSetStep,
  onNext,
  onPrev,
  onSelectNode,
}: LearnPanelProps) {
  const tourSteps = useMemo(
    () =>
      graph?.tour
        ? [...graph.tour].slice().sort((a, b) => a.order - b.order)
        : [],
    [graph?.tour]
  );

  const hasTour = tourSteps.length > 0;

  if (!hasTour) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 280 }}>
          <div style={{ fontSize: 24, marginBottom: 8, color: "#6b7280" }}>
            🧭
          </div>
          <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 4 }}>
            No tour available
          </div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>
            Generate an architecture tour from the graph to guide people
            through key components.
          </div>
        </div>
      </div>
    );
  }

  if (!tourActive) {
    return (
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <h2
            style={{
              fontSize: 18,
              fontFamily: "Georgia, ui-serif, serif",
              color: "#e6edf3",
              margin: 0,
              marginBottom: 4,
            }}
          >
            Project Tour
          </h2>
          <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>
            {tourSteps.length} steps · guided walkthrough of this architecture
          </p>
        </div>

        <button
          type="button"
          onClick={onStart}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(212,165,116,0.6)",
            background: "rgba(212,165,116,0.12)",
            color: "#fbbf24",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Start Tour
        </button>

        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#d4a574",
              marginBottom: 6,
            }}
          >
            Steps
          </div>
          {tourSteps.map((step, i) => (
            <div
              key={step.order}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "6px 8px",
                borderRadius: 8,
                border: "1px solid #30363d",
                background: "#111827",
                fontSize: 11,
                color: "#9ca3af",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontFamily: "monospace",
                  color: "#d4a574",
                  marginTop: 1,
                }}
              >
                {i + 1}.
              </span>
              <span>{step.title}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const step = tourSteps[currentStep];
  if (!step) return null;

  const totalSteps = tourSteps.length;
  const progressPct = ((currentStep + 1) / totalSteps) * 100;
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          borderBottom: "1px solid #30363d",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#d4a574",
            }}
          >
            Tour
          </span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>
            {currentStep + 1} / {totalSteps}
          </span>
        </div>
        <button
          type="button"
          onClick={onStop}
          style={{
            fontSize: 10,
            color: "#9ca3af",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          Exit
        </button>
      </div>

      <div
        style={{
          height: 4,
          background: "#111827",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressPct}%`,
            background: "#d4a574",
            transition: "width 0.25s ease",
          }}
        />
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          minHeight: 0,
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontFamily: "Georgia, ui-serif, serif",
            color: "#e6edf3",
            marginTop: 0,
            marginBottom: 8,
          }}
        >
          {step.title}
        </h2>

        <div
          style={{
            fontSize: 13,
            color: "#9ca3af",
            lineHeight: 1.6,
            marginBottom: 8,
          }}
        >
          <ReactMarkdown
            components={{
              p: ({ children }) => (
                <p style={{ margin: "0 0 4px 0" }}>{children}</p>
              ),
              strong: ({ children }) => (
                <strong style={{ fontWeight: 600, color: "#e5e7eb" }}>
                  {children}
                </strong>
              ),
              code: ({ className, children }) => {
                const isBlock = className?.includes("language-");
                return isBlock ? (
                  <code
                    style={{
                      display: "block",
                      background: "#020617",
                      borderRadius: 6,
                      padding: "6px 8px",
                      marginBottom: 4,
                      fontSize: 11,
                      overflowX: "auto",
                    }}
                  >
                    {children}
                  </code>
                ) : (
                  <code
                    style={{
                      background: "#020617",
                      borderRadius: 4,
                      padding: "1px 4px",
                      fontSize: 11,
                    }}
                  >
                    {children}
                  </code>
                );
              },
              ul: ({ children }) => (
                <ul
                  style={{
                    margin: "0 0 4px 1.2em",
                    padding: 0,
                  }}
                >
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol
                  style={{
                    margin: "0 0 4px 1.2em",
                    padding: 0,
                  }}
                >
                  {children}
                </ol>
              ),
            }}
          >
            {step.description}
          </ReactMarkdown>
        </div>

        {step.languageLesson && (
          <div
            style={{
              borderRadius: 8,
              border: "1px solid rgba(212,165,116,0.3)",
              background: "rgba(212,165,116,0.06)",
              padding: 8,
              marginBottom: 8,
              fontSize: 12,
              color: "#e5e7eb",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 4,
                color: "#fbbf24",
              }}
            >
              Language Lesson
            </div>
            {step.languageLesson}
          </div>
        )}

        {step.nodeIds.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "#d4a574",
                marginBottom: 4,
              }}
            >
              Referenced Components
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {step.nodeIds.map((nodeId) => {
                const node = graph?.nodes.find((n) => n.id === nodeId);
                const label =
                  node?.suggestedLabel ?? node?.label ?? nodeId;
                return (
                  <button
                    key={nodeId}
                    type="button"
                    onClick={() => onSelectNode(nodeId)}
                    style={{
                      fontSize: 11,
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: "1px solid #30363d",
                      background: "#111827",
                      color: "#9ca3af",
                      cursor: "pointer",
                    }}
                    title={label}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          borderTop: "1px solid #30363d",
          padding: "6px 10px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 4,
            marginBottom: 6,
          }}
        >
          {tourSteps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSetStep(i)}
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                border: "none",
                background: i === currentStep ? "#d4a574" : "#111827",
                cursor: "pointer",
              }}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onPrev}
            disabled={isFirst}
            style={{
              flex: 1,
              fontSize: 11,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: isFirst ? "#0b1120" : "#111827",
              color: isFirst ? "#4b5563" : "#e5e7eb",
              cursor: isFirst ? "not-allowed" : "pointer",
            }}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={isLast ? onStop : onNext}
            style={{
              flex: 1,
              fontSize: 11,
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid rgba(212,165,116,0.6)",
              background: "rgba(212,165,116,0.12)",
              color: "#fbbf24",
              cursor: "pointer",
            }}
          >
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}


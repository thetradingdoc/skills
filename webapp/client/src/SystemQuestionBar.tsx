import { useState } from "react";

interface SystemQuestionBarProps {
  placeholder?: string;
  onSubmit: (question: string) => void;
  disabled?: boolean;
}

export function SystemQuestionBar({
  placeholder = "Ask about your system… Why is login slow? Which services touch the DB?",
  onSubmit,
  disabled = false,
}: SystemQuestionBarProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (!q || disabled) return;
    onSubmit(q);
    setValue("");
  };

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "6px 12px",
          background: "rgba(15,23,42,0.92)",
          border: "1px solid #334155",
          borderRadius: 8,
        }}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            color: "#e2e8f0",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!value.trim() || disabled}
          style={{
            padding: "4px 12px",
            background: value.trim() && !disabled ? "#3b82f6" : "#334155",
            border: "none",
            borderRadius: 4,
            color: "#fff",
            fontSize: 11,
            cursor: value.trim() && !disabled ? "pointer" : "not-allowed",
          }}
        >
          Ask
        </button>
      </div>
    </form>
  );
}

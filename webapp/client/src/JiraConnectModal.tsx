import { useState } from "react";

const API_BASE = "/api";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#c9d1d9",
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 6,
  color: "#e6edf3",
  marginBottom: 12,
  outline: "none",
  boxSizing: "border-box",
};
const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "transparent",
  color: "#8b949e",
  border: "1px solid #30363d",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};
const connectBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#238636",
  color: "white",
  border: "1px solid #238636",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

export interface JiraConnectModalProps {
  onConnected: () => void;
  onClose: () => void;
  accessToken: string | null;
}

export function JiraConnectModal({ onConnected, onClose, accessToken }: JiraConnectModalProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "success">("form");

  const handleConnect = async () => {
    if (!accessToken) {
      setError("Please sign in to connect Jira.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/integrations/jira`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          email: email.trim(),
          apiToken: apiToken.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? res.statusText ?? "Connection failed");
        return;
      }
      setStep("success");
    } catch (err) {
      setError("Connection failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 480,
          maxWidth: "95vw",
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          padding: 24,
          color: "#e6edf3",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === "form" ? (
          <>
            <h3 style={{ color: "#e6edf3", margin: "0 0 4px", fontSize: 16 }}>Connect Jira</h3>
            <p style={{ color: "#7d8590", fontSize: 12, margin: "0 0 20px" }}>
              Your credentials are encrypted and stored per-user. Other team members connect their
              own accounts.
            </p>

            <div
              style={{
                background: "#0d1117",
                borderRadius: 8,
                padding: 12,
                marginBottom: 20,
                fontSize: 11,
                color: "#7d8590",
              }}
            >
              <div style={{ marginBottom: 6, color: "#c9d1d9", fontWeight: 600 }}>
                How to get your API token:
              </div>
              <div>
                1. Go to{" "}
                <a
                  href="https://id.atlassian.com/manage-profile/security/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#58a6ff" }}
                >
                  id.atlassian.com → Security → API tokens
                </a>
              </div>
              <div>2. Click "Create API token"</div>
              <div>3. Copy the token and paste it below</div>
            </div>

            <label style={labelStyle}>Jira Base URL</label>
            <input
              placeholder="https://yourcompany.atlassian.net"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={inputStyle}
            />

            <label style={labelStyle}>Email</label>
            <input
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />

            <label style={labelStyle}>API Token</label>
            <input
              type="password"
              placeholder="Paste your Jira API token"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              style={inputStyle}
            />

            {error && (
              <div
                style={{
                  color: "#f85149",
                  fontSize: 11,
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: "#1c0f0f",
                  borderRadius: 6,
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose} style={cancelBtnStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConnect}
                disabled={!baseUrl || !email || !apiToken || loading}
                style={{
                  ...connectBtnStyle,
                  opacity: !baseUrl || !email || !apiToken || loading ? 0.6 : 1,
                  cursor: !baseUrl || !email || !apiToken || loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Verifying…" : "Connect & Verify"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <div style={{ color: "#3fb950", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                Jira Connected
              </div>
              <div style={{ color: "#7d8590", fontSize: 12, marginBottom: 24 }}>
                Connected as <strong>{email.trim()}</strong>. Set a project key in the sidebar to start tracking violations.
              </div>
              <button type="button" onClick={onConnected} style={connectBtnStyle}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

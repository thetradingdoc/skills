/**
 * Reusable style objects for Arch Visualizer UI.
 * Keeps layout and visual hierarchy consistent.
 */

export const styles = {
  sidebar: {
    minWidth: 280,
    maxWidth: 420,
    defaultWidth: 320,
    container: {
      background: "#161b22",
      borderRight: "1px solid #30363d",
      display: "flex",
      flexDirection: "column" as const,
      overflowY: "auto" as const,
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: 13,
      color: "#e6edf3",
      padding: 16,
    },
  },

  panel: {
    background: "#1c2128",
    borderRadius: 8,
    padding: 12,
    border: "1px solid #30363d",
    marginBottom: 12,
  },

  sectionHeader: {
    color: "#7d8590",
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 8,
  },

  buttonBase: {
    padding: "8px 12px",
    fontSize: 13,
    borderRadius: 6,
    cursor: "pointer" as const,
    transition: "background 0.2s ease",
    height: 36,
  },

  buttonPrimary: {
    padding: "8px 12px",
    fontSize: 13,
    height: 36,
    background: "#238636",
    color: "white",
    border: "none",
    borderRadius: 6,
    cursor: "pointer" as const,
    transition: "background 0.2s ease",
  },

  buttonSecondary: {
    padding: "8px 12px",
    fontSize: 13,
    height: 36,
    background: "#21262d",
    color: "#e6edf3",
    border: "1px solid #30363d",
    borderRadius: 6,
    cursor: "pointer" as const,
    transition: "background 0.2s ease",
  },

  buttonDanger: {
    padding: "8px 12px",
    fontSize: 13,
    background: "#da3633",
    color: "white",
    border: "none",
    borderRadius: 6,
    cursor: "pointer" as const,
  },

  tabInactive: {
    height: 36,
    padding: "0 12px",
    background: "#21262d",
    color: "#8b949e",
    border: "none",
    borderBottom: "2px solid transparent",
    borderRadius: "6px 6px 0 0",
    cursor: "pointer" as const,
    fontSize: 12,
  },

  tabActive: {
    height: 36,
    padding: "0 12px",
    background: "#0d1117",
    color: "#e6edf3",
    border: "none",
    borderBottom: "2px solid #238636",
    borderRadius: "6px 6px 0 0",
    cursor: "pointer" as const,
    fontSize: 12,
  },

  chatPanel: {
    height: 260,
    minHeight: 200,
    background: "#0d1117",
    borderTop: "1px solid #30363d",
    display: "flex",
    flexDirection: "column" as const,
  },

  divider: {
    width: 4,
    background: "transparent",
    cursor: "col-resize" as const,
    flexShrink: 0,
  },

  dividerHover: {
    background: "#238636",
  },
};

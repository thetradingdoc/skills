import { useEffect, useState } from "react";
import type { CriticViolation } from "./types";
import { ViolationRow, type SharedViolation } from "./ViolationRow";

// ─── Tokens ──────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #0d1117;
    --surface:   #161b22;
    --surface2:  #1c2330;
    --border:    #21262d;
    --border2:   #30363d;
    --text:      #e6edf3;
    --muted:     #7d8590;
    --subtle:    #484f58;
    --accent:    #58a6ff;
    --accent-dim:#1f3a5f;
    --green:     #3fb950;
    --green-dim: #0d2a14;
    --yellow:    #d29922;
    --yellow-dim:#271f0a;
    --red:       #f85149;
    --red-dim:   #2d0f0e;
    --purple:    #bc8cff;
    --radius:    6px;
    --radius-lg: 10px;
    --mono: 'IBM Plex Mono', monospace;
    --sans: 'IBM Plex Sans', system-ui, sans-serif;
    --transition: 140ms cubic-bezier(.4,0,.2,1);
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Layout ── */
  .panel {
    width: 340px;
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-right: 1px solid var(--border);
  }

  /* ── Section ── */
  .section {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 9px;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid transparent;
    transition: background var(--transition);
  }
  .section-header:hover { background: var(--surface2); }
  .section-header.open { border-bottom-color: var(--border); }

  .section-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .section-title svg { color: var(--subtle); }

  .chevron {
    color: var(--subtle);
    transition: transform var(--transition);
    flex-shrink: 0;
  }
  .chevron.open { transform: rotate(90deg); }

  .section-body {
    overflow: hidden;
    transition: max-height 220ms cubic-bezier(.4,0,.2,1);
  }

  /* ── Health grid ── */
  .health-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--border);
    border-bottom: 1px solid var(--border);
  }
  .health-cell {
    background: var(--surface);
    padding: 14px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .health-cell:hover { background: var(--surface2); transition: background var(--transition); }
  .health-value {
    font-family: var(--mono);
    font-size: 22px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: -.02em;
  }
  .health-label {
    font-size: 11px;
    color: var(--muted);
    font-weight: 400;
  }
  .health-trend {
    font-family: var(--mono);
    font-size: 10px;
    margin-top: 2px;
  }
  .trend-up   { color: var(--red);   }
  .trend-down { color: var(--green); }
  .trend-flat { color: var(--muted); }

  /* severity color map */
  .sev-critical { color: var(--red); }
  .sev-high     { color: var(--yellow); }
  .sev-medium   { color: var(--accent); }
  .sev-ok       { color: var(--green); }

  /* ── Violations list ── */
  .viol-list { display: flex; flex-direction: column; }
  .viol-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    transition: background var(--transition);
    cursor: default;
  }
  .viol-item:last-child { border-bottom: none; }
  .viol-item:hover { background: var(--surface2); }

  .viol-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }
  .dot-critical { background: var(--red); box-shadow: 0 0 6px var(--red); }
  .dot-high     { background: var(--yellow); }
  .dot-medium   { background: var(--accent); }

  .viol-content { flex: 1; min-width: 0; }
  .viol-type {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .viol-desc {
    font-size: 12px;
    color: var(--text);
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .viol-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  .jira-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px 1px 4px;
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    background: var(--accent-dim);
    color: var(--accent);
    border: 1px solid #1f3a5f;
    text-decoration: none;
    transition: background var(--transition);
  }
  .jira-badge:hover { background: #1a3356; }
  .jira-badge-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 10px;
    background: var(--surface2);
    color: var(--muted);
    border: 1px solid var(--border2);
  }
  .tag-recur { color: var(--yellow); background: var(--yellow-dim); border-color: #3a2a0a; }

  .viol-actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
  }
  .icon-btn {
    width: 24px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    border-radius: var(--radius);
    border: 1px solid transparent;
    background: transparent;
    color: var(--subtle);
    cursor: pointer;
    transition: all var(--transition);
  }
  .icon-btn:hover { background: var(--surface2); border-color: var(--border2); color: var(--text); }
  .icon-btn.active { color: var(--accent); }

  /* ── Governance card ── */
  .gov-card {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .gov-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 28px;
  }
  .gov-row-label {
    font-size: 11px;
    color: var(--muted);
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px 2px 6px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 500;
  }
  .status-pill.connected {
    background: var(--green-dim);
    color: var(--green);
    border: 1px solid #1a4d1f;
  }
  .status-pill.disconnected {
    background: var(--surface2);
    color: var(--muted);
    border: 1px solid var(--border2);
  }
  .status-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
  }
  .status-dot.on  { background: var(--green); box-shadow: 0 0 5px var(--green); }
  .status-dot.off { background: var(--subtle); }

  .scope-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: var(--radius);
    background: var(--surface2);
    border: 1px solid var(--border2);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 11px;
    font-family: var(--sans);
    cursor: pointer;
    padding: 0;
    text-decoration: none;
    transition: opacity var(--transition);
  }
  .link-btn:hover { opacity: .75; }

  .gov-divider {
    height: 1px;
    background: var(--border);
    margin: 0 -14px;
  }

  .gov-actions {
    display: flex;
    gap: 7px;
  }

  .btn-primary {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: var(--radius);
    border: none;
    background: var(--accent);
    color: #0d1117;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--sans);
    cursor: pointer;
    transition: opacity var(--transition);
  }
  .btn-primary:hover { opacity: .85; }
  .btn-primary:disabled { opacity: .4; cursor: default; }

  .btn-secondary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 7px 11px;
    border-radius: var(--radius);
    border: 1px solid var(--border2);
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    font-family: var(--sans);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
  }
  .btn-secondary:hover { background: var(--surface2); color: var(--text); border-color: var(--subtle); }

  .metrics-row {
    display: flex;
    gap: 8px;
  }
  .metric-chip {
    flex: 1;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 7px 10px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .metric-val {
    font-family: var(--mono);
    font-size: 16px;
    font-weight: 500;
    line-height: 1;
  }
  .metric-lbl {
    font-size: 10px;
    color: var(--muted);
  }

  /* ── Issues drawer ── */
  .issues-drawer {
    border-top: 1px solid var(--border);
    background: var(--surface);
    overflow: hidden;
    transition: max-height 240ms cubic-bezier(.4,0,.2,1);
  }

  .issues-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
  }
  .issues-toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .issues-count {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  .issue-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--border);
    transition: background var(--transition);
  }
  .issue-row:last-child { border-bottom: none; }
  .issue-row:hover { background: var(--surface2); }

  .issue-key {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent);
    flex-shrink: 0;
    min-width: 70px;
  }
  .issue-summary {
    flex: 1;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .issue-status {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    flex-shrink: 0;
    font-family: var(--mono);
  }
  .issue-status.todo    { background: var(--surface2); color: var(--muted); border: 1px solid var(--border2); }
  .issue-status.inprog  { background: var(--accent-dim); color: var(--accent); border: 1px solid #1f3a5f; }
  .issue-status.done    { background: var(--green-dim); color: var(--green); border: 1px solid #1a4d1f; }

  .stale-warning {
    margin: 8px 14px;
    padding: 8px 10px;
    border-radius: var(--radius);
    background: var(--yellow-dim);
    border: 1px solid #3a2a0a;
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 11px;
    color: var(--yellow);
  }

  /* ── Modal ── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.65);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    animation: fadeIn 120ms ease;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    width: 420px;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 80px rgba(0,0,0,.6);
    animation: slideUp 160ms cubic-bezier(.4,0,.2,1);
    overflow: hidden;
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(12px) scale(.98); }
    to   { opacity: 1; transform: none; }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  .modal-title {
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal-section-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--subtle);
    margin-bottom: 8px;
  }

  .field-group { display: flex; flex-direction: column; gap: 6px; }
  .field-label { font-size: 11px; color: var(--muted); font-weight: 500; }
  .field-hint  { font-size: 10px; color: var(--subtle); }

  .input {
    width: 100%;
    padding: 7px 10px;
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 12px;
    font-family: var(--mono);
    outline: none;
    transition: border-color var(--transition);
  }
  .input:focus { border-color: var(--accent); }
  .input::placeholder { color: var(--subtle); }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
  }
  .toggle-label { font-size: 12px; color: var(--text); }
  .toggle-sub   { font-size: 11px; color: var(--muted); margin-top: 1px; }

  .toggle {
    width: 32px; height: 18px;
    border-radius: 9px;
    background: var(--border2);
    border: none;
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
    transition: background var(--transition);
  }
  .toggle.on { background: var(--accent); }
  .toggle::after {
    content: '';
    position: absolute;
    top: 2px; left: 2px;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: white;
    transition: transform var(--transition);
  }
  .toggle.on::after { transform: translateX(14px); }

  .account-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .account-email { font-size: 12px; color: var(--text); font-family: var(--mono); }
  .account-meta  { font-size: 10px; color: var(--muted); margin-top: 2px; }

  .danger-btn {
    background: none;
    border: 1px solid #3a1a1a;
    color: var(--red);
    font-size: 11px;
    font-family: var(--sans);
    padding: 4px 10px;
    border-radius: var(--radius);
    cursor: pointer;
    transition: all var(--transition);
  }
  .danger-btn:hover { background: var(--red-dim); }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }

  .empty-state {
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    text-align: center;
  }
  .empty-icon {
    width: 36px; height: 36px;
    border-radius: 50%;
    background: var(--surface2);
    border: 1px solid var(--border2);
    display: flex; align-items: center; justify-content: center;
    color: var(--subtle);
    margin-bottom: 2px;
  }
  .empty-title { font-size: 12px; font-weight: 500; color: var(--text); }
  .empty-sub   { font-size: 11px; line-height: 1.6; max-width: 240px; }

  .spinner {
    width: 14px; height: 14px;
    border: 2px solid var(--border2);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 700ms linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* scroll region for issues */
  .issues-scroll {
    max-height: 220px;
    overflow-y: auto;
  }
  .issues-scroll::-webkit-scrollbar { width: 4px; }
  .issues-scroll::-webkit-scrollbar-track { background: transparent; }
  .issues-scroll::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  /* viol list scroll */
  .viol-scroll {
    max-height: 260px;
    overflow-y: auto;
  }
  .viol-scroll::-webkit-scrollbar { width: 4px; }
  .viol-scroll::-webkit-scrollbar-track { background: transparent; }
  .viol-scroll::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  .separator { height: 1px; background: var(--border); margin: 2px 0; }

  /* connect CTA */
  .connect-cta {
    margin: 12px 14px;
    padding: 12px;
    border-radius: var(--radius);
    border: 1px dashed var(--border2);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .connect-cta-text {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.6;
  }

  /* refresh icon btn */
  .refresh-btn {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    background: none;
    border: none;
    color: var(--subtle);
    cursor: pointer;
    border-radius: 4px;
    transition: all var(--transition);
  }
  .refresh-btn:hover { color: var(--text); background: var(--surface2); }
  .refresh-btn.spinning svg { animation: spin 700ms linear infinite; }
`;

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_VIOLATIONS = [
  {
    id: "v1",
    type: "layer_violation",
    severity: "critical",
    sourceNodeId: "src/payment",
    targetNodeId: "src/auth",
    description: "Payment depends on Auth directly",
    recurrenceCount: 12,
    jiraKey: "DOCLP-42",
    jiraStatus: "In Progress",
    policyState: "tracked",
  },
  {
    id: "v2",
    type: "drift",
    severity: "high",
    sourceNodeId: "src/api",
    targetNodeId: "src/storage",
    description: "API bypasses service layer to hit storage",
    recurrenceCount: 3,
    jiraKey: null,
    jiraStatus: null,
    policyState: "new",
  },
  {
    id: "v3",
    type: "layer_violation",
    severity: "high",
    sourceNodeId: "src/ui",
    targetNodeId: "src/db",
    description: "UI layer imports DB models directly",
    recurrenceCount: 7,
    jiraKey: "DOCLP-38",
    jiraStatus: "To Do",
    policyState: "tracked",
  },
  {
    id: "v4",
    type: "drift",
    severity: "medium",
    sourceNodeId: "src/jobs",
    targetNodeId: "src/api",
    description: "Background job imports HTTP client",
    recurrenceCount: 1,
    jiraKey: null,
    jiraStatus: null,
    policyState: "new",
  },
];

const MOCK_ISSUES = [
  { key: "DOCLP-42", summary: "Payment → Auth: remove direct dependency", status: "In Progress" },
  { key: "DOCLP-38", summary: "UI importing DB models: extract DAO layer", status: "To Do" },
  { key: "DOCLP-35", summary: "Jobs layer HTTP coupling should use events", status: "To Do" },
  { key: "DOCLP-31", summary: "Circular dep in src/config resolved", status: "Done" },
];

const MOCK_STALE = [
  { key: "DOCLP-35", reason: "changed", summary: "Jobs layer HTTP coupling" },
];

// ─── SVG icons ────────────────────────────────────────────────────────────────
const Icon = {
  health: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 8h2l2-5 3 10 2-6 1 1h2"/></svg>,
  shield: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 2l5 2v4c0 3-2.5 5.5-5 6-2.5-.5-5-3-5-6V4l5-2z"/></svg>,
  chevron: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 4l4 4-4 4"/></svg>,
  jira: <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M11.975 0C9.67 0 7.8 1.87 7.8 4.175v2.4H3.6C1.61 6.575 0 8.184 0 10.175s1.61 3.6 3.6 3.6h4.2v2.4c0 2.306 1.87 4.175 4.175 4.175S16.15 18.481 16.15 16.175v-2.4h4.2c1.99 0 3.65-1.61 3.65-3.6s-1.66-3.6-3.65-3.6h-4.2V4.175C16.15 1.87 14.28 0 11.975 0z"/></svg>,
  settings: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42"/></svg>,
  external: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 3H3v10h10V9M9 2h5v5M14 2l-7 7"/></svg>,
  ticket: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="12" height="10" rx="1.5"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M6 9h4M6 12h2"/></svg>,
  close: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4l8 8M12 4l-8 8"/></svg>,
  warn: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l6.5 11H1.5L8 2z"/><path d="M8 7v3M8 11.5v.5"/></svg>,
  refresh: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5"/><path d="M13.5 2.5v4h-4"/></svg>,
  dismiss: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4l8 8M12 4l-8 8"/></svg>,
  eye: <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="8" cy="8" rx="6" ry="4"/><circle cx="8" cy="8" r="2"/></svg>,
  connect: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 8h6M9 6l2 2-2 2"/><rect x="1" y="3" width="14" height="10" rx="2"/></svg>,
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  defaultOpen = true,
  children,
  badge,
}: {
  title: string;
  icon: JSX.Element;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <div
        className={`section-header ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="section-title">
          {icon}
          {title}
          {badge != null && (
            <span
              style={{
                background: badge > 0 ? "var(--red-dim)" : "var(--surface2)",
                color: badge > 0 ? "var(--red)" : "var(--muted)",
                border: `1px solid ${badge > 0 ? "#3a1a1a" : "var(--border2)"}`,
                borderRadius: "20px",
                padding: "0 5px",
                fontSize: "10px",
                fontFamily: "var(--mono)",
                fontWeight: "500",
                letterSpacing: "0",
                textTransform: "none",
              }}
            >
              {badge}
            </span>
          )}
        </span>
        <span className={`chevron ${open ? "open" : ""}`}>{Icon.chevron}</span>
      </div>
      <div className="section-body" style={{ maxHeight: open ? "1200px" : "0" }}>
        {children}
      </div>
    </div>
  );
}

function IssueRow({
  issue,
}: {
  issue: { key: string; summary: string; status: string };
}) {
  const statusClass =
    {
      "In Progress": "inprog",
      "To Do": "todo",
      Done: "done",
    }[issue.status] ?? "todo";
  return (
    <div className="issue-row">
      <span className="issue-key">{issue.key}</span>
      <span className="issue-summary" title={issue.summary}>
        {issue.summary}
      </span>
      <span className={`issue-status ${statusClass}`}>{issue.status}</span>
    </div>
  );
}

interface DashboardPanelProps {
  violations: CriticViolation[];
  jiraIssues: Array<{ key: string; summary: string; status: string; baseUrl?: string }>;
  jiraConnected: boolean;
  projectKey: string | null;
  repoName: string | null;
  staleMismatches?: Array<{ key: string; reason: string; summary: string }>;
  onRefreshIssues?: () => void;
  onOpenJiraSettings?: () => void;
  onCreateViolationJira?: (v: CriticViolation) => void;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function DashboardPanel({
  violations: incomingViolations,
  jiraIssues,
  jiraConnected,
  projectKey,
  repoName,
  staleMismatches,
  onRefreshIssues,
  onOpenJiraSettings,
  onCreateViolationJira,
}: DashboardPanelProps) {
  const [showIssues, setShowIssues] = useState(false);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [violations, setViolations] = useState<SharedViolation[]>([]);
  const [issues, setIssues] = useState<typeof MOCK_ISSUES>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Sync incoming violations into local dashboard state (so dismiss is local-only)
  useEffect(() => {
    if (!incomingViolations || incomingViolations.length === 0) {
      setViolations([]);
      return;
    }
  const mapped: SharedViolation[] = incomingViolations.map((v, idx) => ({
      ...v,
      id: (v as any).id ?? v.traceId ?? `${v.sourceNodeId}-${idx}`,
      recurrenceCount: v.recurrences ?? 1,
      policyState: v.jiraKey ? "tracked" : "new",
    }));
    setViolations(mapped);
  }, [incomingViolations]);

  useEffect(() => {
    if (jiraIssues && jiraIssues.length > 0) {
      setIssues(
        jiraIssues.map((i) => ({
          key: i.key,
          summary: i.summary,
          status: i.status,
        }))
      );
    } else {
      setIssues([]);
    }
  }, [jiraIssues]);

  const linkedCount = violations.filter((v) => v.jiraKey).length;
  const openCount = violations.filter(
    (v) => !["resolved", "waived", "accepted"].includes(v.policyState)
  ).length;

  const handleViewIssues = async () => {
    if (showIssues) {
      setShowIssues(false);
      return;
    }
    setShowIssues(true);
    if (onRefreshIssues) {
      setLoadingIssues(true);
      await Promise.resolve(onRefreshIssues());
      setLoadingIssues(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 900));
    setRefreshing(false);
  };

  const handleCreateJira = (v: MockViolation) => {
    if (onCreateViolationJira) {
      onCreateViolationJira(v);
    }
  };

  const handleDismiss = (id: string) => {
    // Dismissals are session-scoped only; we intentionally do not persist them yet.
    setViolations((vs) => vs.filter((v) => v.id !== id));
  };

  const criticalCount = violations.filter((v) => v.severity === "critical").length;
  const highCount = violations.filter((v) => v.severity === "high").length;

  return (
    <>
      <style>{css}</style>
      <div className="panel">
        {/* ── Health ── */}
        <Section title="Project Health" icon={Icon.health} defaultOpen>
          <div className="health-grid">
            <div className="health-cell">
              <span
                className={`health-value ${
                  criticalCount > 0 ? "sev-critical" : "sev-ok"
                }`}
              >
                {criticalCount}
              </span>
              <span className="health-label">Critical</span>
              <span
                className={`health-trend ${
                  criticalCount > 0 ? "trend-up" : "trend-flat"
                }`}
              >
                {criticalCount > 0 ? `↑ ${criticalCount} active` : "— none"}
              </span>
            </div>
            <div className="health-cell">
              <span
                className={`health-value ${
                  highCount > 0 ? "sev-high" : "sev-ok"
                }`}
              >
                {highCount}
              </span>
              <span className="health-label">High severity</span>
              <span
                className={`health-trend ${
                  highCount > 1 ? "trend-up" : "trend-flat"
                }`}
              >
                {highCount > 0 ? `↑ ${highCount} open` : "— none"}
              </span>
            </div>
            <div className="health-cell">
              <span className="health-value" style={{ color: "var(--text)" }}>
                {violations.length}
              </span>
              <span className="health-label">Total violations</span>
              <span className="health-trend trend-flat">— all time</span>
            </div>
            <div className="health-cell">
              <span className="health-value sev-ok">{linkedCount}</span>
              <span className="health-label">Tracked in Jira</span>
              <span className="health-trend trend-down">
                {linkedCount > 0
                  ? `↓ ${violations.length - linkedCount} untracked`
                  : "— none linked"}
              </span>
            </div>
          </div>
        </Section>

        {/* ── Violations ── */}
        <Section
          title="Violations"
          icon={Icon.shield}
          badge={openCount}
          defaultOpen
        >
          {violations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M8 2l5 2v4c0 3-2.5 5.5-5 6-2.5-.5-5-3-5-6V4l5-2z" />
                  <path d="M5.5 8l1.5 1.5 3-3" />
                </svg>
              </div>
              <div className="empty-title">All clear</div>
              <div className="empty-sub">
                No active violations detected in the last scan.
              </div>
            </div>
          ) : (
            <div className="viol-scroll">
              <div className="viol-list">
                {violations.map((v) => (
                  <ViolationRow
                    key={v.id}
                    violation={v}
                    onCreateJira={handleCreateJira}
                    onDismiss={handleDismiss}
                  />
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ── Governance ── */}
        <Section title="Governance" icon={Icon.jira} defaultOpen>
          <div className="gov-card">
            {/* Status row */}
            <div className="gov-row">
              <span className="gov-row-label">
                Status
              </span>
              <span
                className={`status-pill ${
                  jiraConnected ? "connected" : "disconnected"
                }`}
              >
                <span
                  className={`status-dot ${jiraConnected ? "on" : "off"}`}
                />
                {jiraConnected ? "Connected" : "Not connected"}
              </span>
            </div>

            {/* Scope row */}
            {jiraConnected && (
              <div className="gov-row">
                <span className="gov-row-label">Project scope</span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {projectKey ? (
                    <span className="scope-chip">
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <rect x="2" y="2" width="12" height="12" rx="2" />
                        <path d="M5 8h6M8 5v6" />
                      </svg>
                      {projectKey}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      All projects
                    </span>
                  )}
                  <button
                    className="link-btn"
                    onClick={() => onOpenJiraSettings && onOpenJiraSettings()}
                  >
                    Change
                  </button>
                </div>
              </div>
            )}

            {/* Metrics — computed from payloads, no extra call */}
            {jiraConnected && (
              <div className="metrics-row">
                <div className="metric-chip">
                  <span className="metric-val sev-ok">{linkedCount}</span>
                  <span className="metric-lbl">Linked issues</span>
                </div>
                <div className="metric-chip">
                  <span
                    className={`metric-val ${
                      openCount > 0 ? "sev-high" : "sev-ok"
                    }`}
                  >
                    {openCount}
                  </span>
                  <span className="metric-lbl">Open violations</span>
                </div>
                <div className="metric-chip">
                  <span
                    className="metric-val"
                    style={{ color: "var(--muted)" }}
                  >
                    {
                      violations.filter(
                        (v) => v.policyState === "tracked"
                      ).length
                    }
                  </span>
                  <span className="metric-lbl">Tracked</span>
                </div>
              </div>
            )}

            {staleMismatches && staleMismatches.length > 0 && jiraConnected && (
              <div className="stale-warning">
                {Icon.warn}
                <span>
                  {staleMismatches.length} issue
                  {staleMismatches.length > 1 ? "s" : ""} may be stale — module
                  fingerprint has changed.{" "}
                  <button
                    className="link-btn"
                    style={{ color: "var(--yellow)" }}
                  >
                    Review
                  </button>
                </span>
              </div>
            )}

            <div className="gov-divider" />

            {/* Actions */}
            <div className="gov-actions">
              {jiraConnected ? (
                <>
                  <button className="btn-primary" onClick={handleViewIssues}>
                    {loadingIssues ? (
                      <span
                        className="spinner"
                        style={{ borderTopColor: "#0d1117" }}
                      />
                    ) : (
                      Icon.eye
                    )}
                    {showIssues ? "Hide issues" : "View issues"}
                  </button>
                  <button
                    className={`refresh-btn ${
                      refreshing ? "spinning" : ""
                    }`}
                    title="Refresh"
                    onClick={handleRefresh}
                    style={{
                      width: 34,
                      height: 34,
                      border: "1px solid var(--border2)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    {Icon.refresh}
                  </button>
                  <button className="btn-secondary" onClick={onOpenJiraSettings}>
                    {Icon.settings}
                    Settings
                  </button>
                </>
              ) : (
                <button
                  className="btn-primary"
                  style={{ width: "100%" }}
                  onClick={() => setShowSettings(true)}
                >
                  {Icon.connect}
                  Connect Jira
                </button>
              )}
            </div>
          </div>

          {/* Issues drawer */}
          <div
            className="issues-drawer"
            style={{ maxHeight: showIssues ? "360px" : "0" }}
          >
            {loadingIssues ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "14px",
                  color: "var(--muted)",
                  fontSize: "12px",
                }}
              >
                <span className="spinner" />
                Fetching issues…
              </div>
            ) : issues.length > 0 ? (
              <>
                <div className="issues-toolbar">
                  <div className="issues-toolbar-left">
                    <span className="issues-count">
                      {issues.length} issues
                    </span>
                    {projectKey && <span className="tag">{projectKey}</span>}
                  </div>
                  <a
                    href="#"
                    style={{
                      fontSize: "11px",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    Open in Jira {Icon.external}
                  </a>
                </div>
                <div className="issues-scroll">
                  {issues.map((i) => (
                    <IssueRow key={i.key} issue={i} />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </Section>
      </div>

    </>
  );
}


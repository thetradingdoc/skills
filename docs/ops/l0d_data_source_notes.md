# L0-D data-source notes (Phase 1 — reconnaissance)

Canonical copy lives in the trading-agent runtime:

`~/.arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170/middleware-platform/docs/ops/l0d_data_source_notes.md`

## Summary (2026-08-08)

- **No FMP / Finnhub API keys** in the runtime environment; live earnings/estimate probes return **401**.
- **FMP docs:** analyst estimates = **current consensus state**, not a historical revision / PIT ledger; local snapshotting required for true as-of history. Historical earnings endpoints expose a **single estimate point** per report date — **not** proven pre-announcement consensus.
- **Finnhub:** estimate+actual history exists on paper; free depth insufficient for full 2023–2025 window; not documented as daily PIT consensus.
- **Honest conclusion:** available free-tier paths **cannot fully satisfy L0-A** PIT consensus as specified. Do not invent timestamps to pass PIT checks. Do not flip `pead_mode`.

See the runtime file for full tables, probe results, and labeling rules if a limited-confidence panel is ever explicitly accepted.

#!/usr/bin/env npx tsx
/**
 * Sync Blanko scan-clone middleware from live Voice Agent SSOT.
 * Does NOT touch live. Excludes node_modules, .env, sqlite, artifacts.
 *
 * Run: npx tsx scripts/sync-blanko-scan-clone-from-local.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { readBlankoTarget, tradingLiveRoot, tradingScanClone } from "./lib/blanko-target.ts";

const EXCLUDES = [
  "node_modules",
  ".env",
  "*.sqlite",
  "*.sqlite-shm",
  "*.sqlite-wal",
  "artifacts",
  "data",
  "coverage",
  "dist",
  ".DS_Store",
];

function main() {
  const t = readBlankoTarget();
  const live = tradingLiveRoot();
  const scan = tradingScanClone();

  if (!t.local || !t.scanClone) {
    console.error("Need both local: and scan-clone: in .blanko-target");
    process.exit(1);
  }
  if (path.resolve(live) === path.resolve(scan)) {
    console.log("local and scan-clone are the same path — nothing to sync.");
    process.exit(0);
  }

  const liveMw = path.join(live, "middleware-platform");
  const scanMw = path.join(scan, "middleware-platform");
  if (!fs.existsSync(liveMw)) {
    console.error("Missing live middleware-platform:", liveMw);
    process.exit(1);
  }
  fs.mkdirSync(scanMw, { recursive: true });

  const args = ["-a", "--delete"];
  for (const e of EXCLUDES) {
    args.push("--exclude", e);
  }
  args.push(`${liveMw}/`, `${scanMw}/`);

  console.log("rsync live → scan-clone middleware-platform");
  console.log("  from:", liveMw);
  console.log("  to:  ", scanMw);
  const r = spawnSync("rsync", args, { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status || 1);
  }

  // Also sync trading UI shell if present
  const liveUi = path.join(live, "unified-dashboard/trading");
  const scanUi = path.join(scan, "unified-dashboard/trading");
  if (fs.existsSync(liveUi)) {
    fs.mkdirSync(path.dirname(scanUi), { recursive: true });
    const r2 = spawnSync(
      "rsync",
      ["-a", "--delete", "--exclude", "node_modules", `${liveUi}/`, `${scanUi}/`],
      { encoding: "utf8" }
    );
    if (r2.status !== 0) {
      console.warn("UI sync warning:", r2.stderr);
    } else {
      console.log("synced unified-dashboard/trading");
    }
  }

  // Verify critical drift markers
  const liveChat = fs.readFileSync(
    path.join(liveMw, "services/trading-chat-service.js"),
    "utf8"
  );
  const scanChat = fs.readFileSync(
    path.join(scanMw, "services/trading-chat-service.js"),
    "utf8"
  );
  const liveTypo = /const sessiId\b/.test(liveChat);
  const scanTypo = /const sessiId\b/.test(scanChat);
  const liveAlpaca = fs.readFileSync(
    path.join(liveMw, "services/broker/alpaca-broker.js"),
    "utf8"
  );
  const scanAlpaca = fs.readFileSync(
    path.join(scanMw, "services/broker/alpaca-broker.js"),
    "utf8"
  );

  const report = {
    live,
    scan,
    liveHasSessiIdTypo: liveTypo,
    scanHasSessiIdTypo: scanTypo,
    liveAlpacaHasHttp: /_fetch|submitOrder/.test(liveAlpaca),
    scanAlpacaHasHttp: /_fetch|submitOrder/.test(scanAlpaca),
    matchChat: liveChat === scanChat,
    matchAlpaca: liveAlpaca === scanAlpaca,
  };
  const out = path.resolve("docs/ops/blanko-dual-audit/scan-clone-sync-report.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (scanTypo || !report.scanAlpacaHasHttp || !report.matchChat) {
    console.error("Sync verification failed");
    process.exit(1);
  }
  console.log("OK — scan-clone middleware matches live SSOT (excl. secrets/db/artifacts)");
}

main();

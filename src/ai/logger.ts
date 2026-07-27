import * as fs from "fs";
import * as path from "path";

export type ArchLogLevel = "info" | "warn" | "error" | "debug";

export interface ArchLogContext {
  archNodeId?: string;
  filePath?: string;
  requestId?: string;
  workspaceId?: string;
  [key: string]: unknown;
}

/**
 * Central logger helper.
 *
 * - Always threads through archNodeId when provided.
 * - Writes JSONL to ARCHY_LOG_PATH or logs/app.log (used by telemetry_tail).
 * - Mirrors logs to console for local development.
 */
export function logArchEvent(
  level: ArchLogLevel,
  message: string,
  context: ArchLogContext = {}
): void {
  const ts = new Date().toISOString();
  const entry = {
    ts,
    level,
    message,
    archNodeId: context.archNodeId ?? null,
    filePath: context.filePath ?? null,
    requestId: context.requestId ?? null,
    workspaceId: context.workspaceId ?? null,
    ...context,
  };

  // Console mirror (useful in tests and local runs).
  const base = `[arch][${level}] ${ts} – ${message}`;
  const extra =
    entry.archNodeId || entry.requestId
      ? ` (${JSON.stringify({
          archNodeId: entry.archNodeId,
          requestId: entry.requestId,
        })})`
      : "";
  // eslint-disable-next-line no-console
  console.log(base + extra);

  // Structured log file used by executeTelemetryTail.
  try {
    const root = process.cwd();
    const logPath =
      process.env.ARCHY_LOG_PATH?.trim() ||
      path.join(root, "logs", "app.log");
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Logging must never crash the agent.
  }
}


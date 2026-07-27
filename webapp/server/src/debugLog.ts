import * as fs from "fs";

const LOG_PATH = "/Users/ojrichard/Architect/arch-visualizer/.cursor/debug-2a19a3.log";

export function debugLog(entry: {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  runId?: string;
}): void {
  try {
    const line = JSON.stringify({
      sessionId: "2a19a3",
      timestamp: Date.now(),
      ...entry,
    });
    fs.appendFileSync(LOG_PATH, line + "\n", "utf-8");
  } catch {
    // ignore
  }
}

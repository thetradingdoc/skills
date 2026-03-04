/**
 * update_jira — AGENT_ROADMAP v4 §10
 * Retag (update fingerprint), Archive (transition to Done), Keep (no-op).
 */

import type { JiraConfig } from "../jira/client";
import { getIssue, updateIssueDescription, transitionIssue } from "../jira/client";
import { descriptionToString } from "./staleJiraDetector";

export type JiraAction = "retag" | "archive" | "keep";

/** Strip arch-* footer lines from description text */
function stripArchFooter(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^arch-[a-z]+:\s*.+/.test(line.trim()) && line.trim() !== "---")
    .join("\n")
    .replace(/\n---\s*$/, "")
    .trim();
}

export interface UpdateJiraResult {
  success: boolean;
  error?: string;
}

export async function updateJira(
  config: JiraConfig,
  issueKey: string,
  action: JiraAction,
  context?: { newFingerprint: string; newModule: string }
): Promise<UpdateJiraResult> {
  if (action === "keep") return { success: true };

  if (action === "archive") {
    return transitionIssue(config, issueKey);
  }

  if (action === "retag" && context) {
    const issue = await getIssue(config, issueKey);
    if (!issue) return { success: false, error: "Issue not found" };
    const currentText = descriptionToString(issue.description);
    const stripped = stripArchFooter(currentText);
    const footer = `\n\n---\narch-fingerprint: ${context.newFingerprint}\narch-module: ${context.newModule}`;
    const newDesc = stripped + footer;
    return updateIssueDescription(config, issueKey, newDesc);
  }

  return { success: false, error: "Invalid action or missing context for retag" };
}

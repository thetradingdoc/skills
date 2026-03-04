"use strict";
/**
 * update_jira — AGENT_ROADMAP v4 §10
 * Retag (update fingerprint), Archive (transition to Done), Keep (no-op).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateJira = updateJira;
const client_1 = require("../jira/client");
const staleJiraDetector_1 = require("./staleJiraDetector");
/** Strip arch-* footer lines from description text */
function stripArchFooter(text) {
    return text
        .split("\n")
        .filter((line) => !/^arch-[a-z]+:\s*.+/.test(line.trim()) && line.trim() !== "---")
        .join("\n")
        .replace(/\n---\s*$/, "")
        .trim();
}
async function updateJira(config, issueKey, action, context) {
    if (action === "keep")
        return { success: true };
    if (action === "archive") {
        return (0, client_1.transitionIssue)(config, issueKey);
    }
    if (action === "retag" && context) {
        const issue = await (0, client_1.getIssue)(config, issueKey);
        if (!issue)
            return { success: false, error: "Issue not found" };
        const currentText = (0, staleJiraDetector_1.descriptionToString)(issue.description);
        const stripped = stripArchFooter(currentText);
        const footer = `\n\n---\narch-fingerprint: ${context.newFingerprint}\narch-module: ${context.newModule}`;
        const newDesc = stripped + footer;
        return (0, client_1.updateIssueDescription)(config, issueKey, newDesc);
    }
    return { success: false, error: "Invalid action or missing context for retag" };
}

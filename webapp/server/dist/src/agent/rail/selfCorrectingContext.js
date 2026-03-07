"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSelfCorrectingContext = buildSelfCorrectingContext;
const context_1 = require("./context");
const manager_1 = require("./manager");
function buildSelfCorrectingContext(rootPath, railId, taskId, fullHistory, tokenBudget, retryCount, retryLimit, failureSummary) {
    const rail = (0, manager_1.getRail)(rootPath, railId);
    const task = (0, manager_1.getTask)(taskId);
    if (!rail || !task) {
        return fullHistory;
    }
    const base = (0, context_1.buildRailContext)(rail, fullHistory, tokenBudget);
    const critiqueLines = [];
    if (rail.lastCritique?.message) {
        critiqueLines.push(`Last critique (${rail.lastCritique.source}): ${rail.lastCritique.message}`);
    }
    if (failureSummary) {
        critiqueLines.push(`Failure summary: ${failureSummary}`);
    }
    critiqueLines.push(`Retry ${retryCount + 1} of ${retryLimit} for task ${task.description}.`);
    return [
        ...base,
        {
            role: "user",
            content: critiqueLines.join("\n"),
        },
    ];
}

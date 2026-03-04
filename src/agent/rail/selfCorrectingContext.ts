import type { ArchitectureChatHistory } from "../../types";
import type { Rail, Task } from "../types";
import { buildRailContext } from "./context";
import { getRail, getTask } from "./manager";

export function buildSelfCorrectingContext(
  rootPath: string,
  railId: string,
  taskId: string,
  fullHistory: ArchitectureChatHistory,
  tokenBudget: number,
  retryCount: number,
  retryLimit: number,
  failureSummary: string
): ArchitectureChatHistory {
  const rail = getRail(rootPath, railId);
  const task = getTask(taskId);
  if (!rail || !task) {
    return fullHistory;
  }

  const base = buildRailContext(rail, fullHistory, tokenBudget);
  const critiqueLines: string[] = [];
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
      role: "user" as const,
      content: critiqueLines.join("\n"),
    },
  ];
}


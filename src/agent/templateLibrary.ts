import * as fs from "fs";
import * as path from "path";
import type { QuestionIntent } from "../ai/questionRouter";

export interface TemplateRecord {
  id: string;
  intent: QuestionIntent;
  model: "claude" | "openai";
  usedCritic: boolean;
  score: number;
  createdAt: string;
  questionSample: string;
}

interface TemplateStore {
  templates: TemplateRecord[];
}

function getTemplatePath(rootPath: string): string {
  return path.join(rootPath, ".agent", "templates.json");
}

function ensureDir(rootPath: string): void {
  const dir = path.join(rootPath, ".agent");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadTemplates(rootPath: string): TemplateStore {
  ensureDir(rootPath);
  const p = getTemplatePath(rootPath);
  if (!fs.existsSync(p)) {
    const empty: TemplateStore = { templates: [] };
    fs.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as TemplateStore;
    return parsed && Array.isArray(parsed.templates)
      ? parsed
      : { templates: [] };
  } catch {
    const empty: TemplateStore = { templates: [] };
    fs.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
    return empty;
  }
}

export function recordSuccessfulRun(params: {
  rootPath: string;
  intent: QuestionIntent;
  model: "claude" | "openai";
  usedCritic: boolean;
  score: number;
  question: string;
}): void {
  const store = loadTemplates(params.rootPath);
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rec: TemplateRecord = {
    id,
    intent: params.intent,
    model: params.model,
    usedCritic: params.usedCritic,
    score: params.score,
    createdAt: new Date().toISOString(),
    questionSample: params.question.slice(0, 200),
  };
  store.templates.push(rec);
  const p = getTemplatePath(params.rootPath);
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
}


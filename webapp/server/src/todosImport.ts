import * as fs from "fs";
import * as path from "path";
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

type ParsedTodo = {
  phase: number | null;
  title: string;
  description: string | null;
};

function normalizePhaseToken(token: string | null): number | null {
  if (!token) return null;
  const m = token.match(/(\d+)/);
  return m ? parseInt(m[1], 10) || null : null;
}

function parseDocLittleMarkdown(md: string): ParsedTodo[] {
  const lines = md.split(/\r?\n/);
  let currentPhase: number | null = null;
  const todos: ParsedTodo[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Headings like "## Phase 4", "## Phase 4c", "## Phase 4c — Matching"
    const phaseMatch =
      line.match(/^##\s*Phase\s+([0-9A-Za-z]+)/i) ||
      line.match(/^###\s*Phase\s+([0-9A-Za-z]+)/i);
    if (phaseMatch) {
      currentPhase = normalizePhaseToken(phaseMatch[1] ?? null);
      continue;
    }

    // Table rows: | 1 | Task title | Details |
    if (line.startsWith("|") && line.split("|").length >= 4) {
      const parts = line.split("|").map((p) => p.trim());
      // parts[0] is "", then "#", "Task", "Details", ...
      const numToken = parts[1] ?? "";
      const titleCell = parts[2] ?? "";
      const detailsCell = parts[3] ?? "";
      const title = titleCell.replace(/^\d+\.\s*/, "").trim();
      if (title && title !== "Task" && title !== "Tasks") {
        todos.push({
          phase: currentPhase,
          title,
          description: detailsCell || null,
        });
      }
      continue;
    }

    // Numbered list: "1. Do thing"
    const numberedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (numberedMatch) {
      const title = numberedMatch[1].trim();
      if (title) {
        todos.push({ phase: currentPhase, title, description: null });
      }
      continue;
    }

    // Checkbox bullets: "- [ ] Task"
    const todoMatch = line.match(/^[-*]\s+\[.\]\s+(.*)$/);
    if (todoMatch) {
      const title = todoMatch[1].trim();
      if (title) {
        todos.push({ phase: currentPhase, title, description: null });
      }
      continue;
    }
  }

  return todos;
}

router.post("/todos/import/preview", requireUser, async (req, res) => {
  const workspaceId = (req.body?.workspaceId as string | undefined)?.trim();
  const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : "";

  if (!workspaceId || !markdown) {
    res.status(400).json({ error: "workspaceId and markdown are required" });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const parsed = parseDocLittleMarkdown(markdown);
  const byPhase = new Map<number | null, number>();
  for (const t of parsed) {
    const key = t.phase ?? -1;
    byPhase.set(key, (byPhase.get(key) ?? 0) + 1);
  }

  const phases = Array.from(byPhase.entries()).map(([phase, count]) => ({
    phase: phase === -1 ? null : phase,
    count,
  }));

  const warnings: string[] = [];
  if (parsed.length === 0) {
    warnings.push("No todos detected. Check that the markdown uses tables, numbered lists, or checkboxes.");
  }

  res.json({
    total: parsed.length,
    phases,
    items: parsed.map((t) => ({ title: t.title, description: t.description, phase: t.phase })),
    warnings,
  });
});

router.post("/todos/import/confirm", requireUser, async (req, res) => {
  const workspaceId = (req.body?.workspaceId as string | undefined)?.trim();
  const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : "";

  if (!workspaceId || !markdown) {
    res.status(400).json({ error: "workspaceId and markdown are required" });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", req.user!.id)
    .single();

  if (!ws) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  const parsed = parseDocLittleMarkdown(markdown);
  if (parsed.length === 0) {
    res.status(400).json({ error: "No todos detected in markdown." });
    return;
  }
  const titles = parsed.map((t) => t.title);
  const { data: existing } = await supabaseAdmin
    .from("todos")
    .select("title, phase")
    .eq("workspace_id", workspaceId)
    .in("title", titles);
  const existingSet = new Set(
    (existing ?? []).map((r: { title?: string; phase?: number | null }) => `${r.title}@@${r.phase ?? "null"}`)
  );

  const toInsert = parsed
    .filter((t) => !existingSet.has(`${t.title}@@${t.phase ?? "null"}`))
    .map((t) => ({
      workspace_id: workspaceId,
      title: t.title,
      description: t.description,
      phase: t.phase,
      status: "pending",
      source: "doclittle-md",
      source_path: null,
    }));

  if (toInsert.length === 0) {
    res.json({ imported: [], skipped: parsed.length });
    return;
  }

  // Sort by phase (null → -1) so lower phases insert first for depends_on ordering.
  toInsert.sort((a, b) => (a.phase ?? -1) - (b.phase ?? -1));

  const imported: Array<{ id: string; phase: number | null; title: string }> = [];
  const batchSize = 500;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const slice = toInsert.slice(i, i + batchSize);
    const { data, error } = await supabaseAdmin
      .from("todos")
      .insert(slice)
      .select("id, phase, title");
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (data) imported.push(...(data as Array<{ id: string; phase: number | null; title: string }>));
  }

  // Stronger phase ordering: todos in phase N depend on all todos in phases < N.
  const byPhase = new Map<number | null, string[]>();
  for (const row of imported) {
    const p = row.phase ?? -1;
    if (!byPhase.has(p)) byPhase.set(p, []);
    byPhase.get(p)!.push(row.id);
  }
  const phasesAsc = Array.from(byPhase.keys()).sort((a, b) => a - b);
  for (let i = 1; i < phasesAsc.length; i++) {
    const currPhase = phasesAsc[i]!;
    const depIds: string[] = [];
    for (let j = 0; j < i; j++) depIds.push(...(byPhase.get(phasesAsc[j]!) ?? []));
    const currIds = byPhase.get(currPhase) ?? [];
    for (const id of currIds) {
      await supabaseAdmin.from("todos").update({ depends_on: depIds }).eq("id", id);
    }
  }

  res.json({ imported, skipped: parsed.length - toInsert.length });
});

export { router as todosImportRoutes };


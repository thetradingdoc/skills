/**
 * Extend dual audit: Workspace → Flow → Tasks
 * Seed trading spine, Import from Path, Run agent, Approve/Reject gates.
 * Creates a confirmed Supabase user (admin API), signs in, scans trading clone.
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { tradingLiveRoot, tradingScanClone } from "./lib/blanko-target";

const OUT = path.resolve("docs/ops/blanko-dual-audit");
const SCAN_CLONE = process.env.BLANKO_TARGET_ROOT?.trim()
  ? process.env.BLANKO_TARGET_ROOT.trim()
  : (() => {
      try {
        return tradingLiveRoot();
      } catch {
        return tradingScanClone();
      }
    })();
const API = process.env.API_URL ?? "http://localhost:4000";

type Finding = {
  id: string;
  target: "trading-agent" | "blanko" | "both";
  layer: "ui" | "backend" | "ui+backend";
  severity: "P0" | "P1" | "P2" | "P3";
  area: string;
  title: string;
  expected: string;
  actual: string;
  evidence: string;
};

const findings: Finding[] = [];

function shot(name: string) {
  return path.join(OUT, name);
}

function add(f: Finding) {
  findings.push(f);
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function openFlowTasks(page: Page) {
  const workRail = page.getByTestId("blanko-rail-work");
  if (await workRail.count()) {
    await workRail.click();
  } else {
    await page.getByTestId("blanko-rail-workspace").click();
    const workTab = page.getByTestId("blanko-dock-tab-work");
    if (await workTab.count()) {
      await workTab.click();
    } else {
      const flowTab = page.getByTestId("blanko-dock-tab-flow");
      if (await flowTab.count()) await flowTab.click();
      const tasksTab = page.getByTestId("flow-tab-tasks");
      if (await tasksTab.count()) await tasksTab.click();
    }
  }
  await expect(page.getByTestId("flow-tasks-board")).toBeVisible({ timeout: 15000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Flow Tasks audit extension", () => {
  test.afterAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const prevPath = path.join(OUT, "findings-flow-tasks.json");
    fs.writeFileSync(prevPath, JSON.stringify(findings, null, 2));
  });

  test("anon gate: Flow Tasks requires sign-in", async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.addInitScript(() => {
      (window as unknown as { __BLANKO_E2E__?: boolean }).__BLANKO_E2E__ = true;
    });
    await page.goto("/");
    await page.getByTestId("design-from-scratch").click();
    await expect(page.getByTestId("blanko-workspace")).toBeVisible({ timeout: 20000 });
    await openFlowTasks(page);
    await page.screenshot({ path: shot("30-flow-tasks-anon.png"), fullPage: true });
    const text = await page.getByTestId("flow-tasks-board").innerText();
    if (!/sign in|signed-in workspace/i.test(text)) {
      add({
        id: "BK-FLOW-001",
        target: "blanko",
        layer: "ui",
        severity: "P2",
        area: "Flow/Tasks",
        title: "Anon Flow Tasks gate copy missing",
        expected: "Sign-in required message",
        actual: text.slice(0, 200),
        evidence: "30-flow-tasks-anon.png",
      });
    }
    await expect(page.getByTestId("flow-seed-pipeline")).toHaveCount(0);
  });

  test("signed-in: Seed, Import, agent select, Run, Approve gates", async ({ page, request }) => {
    fs.mkdirSync(OUT, { recursive: true });
    test.setTimeout(300_000);

    const serverEnv = parseEnvFile(path.resolve("webapp/server/.env"));
    const clientEnv = parseEnvFile(path.resolve("webapp/client/.env"));
    const SUPABASE_URL = serverEnv.SUPABASE_URL ?? clientEnv.VITE_SUPABASE_URL ?? "";
    const SERVICE_ROLE = serverEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const ANON_KEY =
      clientEnv.VITE_SUPABASE_ANON_KEY ?? clientEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
    test.skip(!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY, "Supabase env missing");

    const email = `blanko.flow.audit+${Date.now()}@gmail.com`;
    const password = "e2e-flow-audit-12345";

    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    expect(created.ok, `createUser ${created.status}`).toBeTruthy();

    const signed = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const tokBody = (await signed.json()) as { access_token?: string };
    expect(signed.ok && tokBody.access_token, "password token").toBeTruthy();
    const token = tokBody.access_token!;

    // UI sign-in (lands in empty design shell — no landing scan field)
    await page.goto("/");
    await page.getByTestId("landing-sign-in").click();
    const modal = page.getByTestId("auth-modal");
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder("Email").fill(email);
    await modal.getByPlaceholder("Password").fill(password);
    await modal.getByRole("button", { name: /^Sign in$/ }).last().click();
    await expect(modal).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByTestId("blanko-chrome-bar")).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: shot("31-signed-in-shell.png"), fullPage: true });

    // Authenticated API scan → workspaceId, then reopen via lastWorkspaceId
    const scanRes = await request.post(`${API}/api/scan`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { repoUrl: SCAN_CLONE },
      timeout: 120_000,
    });
    const scanStatus = scanRes.status();
    const scanJson = (await scanRes.json().catch(() => ({}))) as {
      workspaceId?: string;
      projectRoot?: string;
      agents?: { agents?: Array<{ file?: string; kind?: string }> };
      persistError?: string;
      error?: string;
    };
    fs.writeFileSync(
      path.join(OUT, "flow-scan-auth.json"),
      JSON.stringify(
        {
          status: scanStatus,
          workspaceId: scanJson.workspaceId,
          persistError: scanJson.persistError,
          error: scanJson.error,
          agentFiles: (scanJson.agents?.agents ?? []).map((a) => a.file),
        },
        null,
        2
      )
    );

    if (scanStatus !== 200 || !scanJson.workspaceId) {
      add({
        id: "BK-FLOW-002",
        target: "blanko",
        layer: "backend",
        severity: "P1",
        area: "Flow/Tasks",
        title: "Authenticated scan of trading clone failed",
        expected: "200 with workspaceId + agents",
        actual: `${scanStatus} ${scanJson.error ?? scanJson.persistError ?? ""}`,
        evidence: "flow-scan-auth.json",
      });
      return;
    }

    const workspaceId = scanJson.workspaceId;

    await page.evaluate((id) => {
      localStorage.setItem("lastWorkspaceId", id);
    }, workspaceId);
    await page.reload();
    await expect(page.getByTestId("blanko-rail-workspace")).toBeVisible({ timeout: 60000 });
    // Wait for graph/project root to hydrate
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("31b-workspace-loaded.png"), fullPage: true });

    // —— Full UI path ——
    await openFlowTasks(page);
    await page.screenshot({ path: shot("32-flow-tasks-signed.png"), fullPage: true });

    // If still gated, fall through to API-only contracts using workspaceId
    const stillGated = await page.getByText(/Tasks need a signed-in workspace/i).isVisible().catch(() => false);
    if (stillGated) {
      add({
        id: "BK-FLOW-016",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "Flow/Tasks",
        title: "Flow Tasks still gated after loading scanned workspace (missing activeWorkspaceId/token in board)",
        expected: "Kanban with Seed / agent select",
        actual: "Sign-in workspace gate copy still shown",
        evidence: "32-flow-tasks-signed.png 31b-workspace-loaded.png",
      });

      const seedResults = [];
      const r = await request.post(`${API}/api/todos`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          workspaceId,
          title: "Task 1 — Payment (paper wallet)",
          description: "audit seed",
          agentFile: "middleware-platform/services/trading-rails/execute-turn.js",
          layerId: "ingress",
          assigneeLabel: "Cursor",
          kind: "task",
          source: "trading-spine",
          sourcePath: `trading-spine:p1-payment-audit-${Date.now()}`,
          fileScope: ["middleware-platform/services/paper-wallet-writer.js"],
          acceptanceCriteria: { functional: ["audit"] },
        },
      });
      seedResults.push({ status: r.status(), body: await r.json().catch(() => ({})) });
      fs.writeFileSync(path.join(OUT, "flow-api-seed.json"), JSON.stringify(seedResults, null, 2));
      if (seedResults.some((s) => s.status >= 400)) {
        add({
          id: "BK-FLOW-004",
          target: "blanko",
          layer: "backend",
          severity: "P1",
          area: "Flow/Tasks",
          title: "POST /todos seed (trading-spine) failed",
          expected: "2xx create",
          actual: JSON.stringify(seedResults),
          evidence: "flow-api-seed.json",
        });
      }

      const list = await request.get(`${API}/api/todos?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listBody = (await list.json().catch(() => ({}))) as {
        todos?: Array<{ id: string; title: string; status: string; rail_id?: string | null }>;
      };
      fs.writeFileSync(
        path.join(OUT, "flow-api-todos.json"),
        JSON.stringify({ status: list.status(), count: listBody.todos?.length, todos: listBody.todos }, null, 2)
      );

      const todo = listBody.todos?.[0];
      if (todo) {
        const run = await request.post(`${API}/api/todos/${encodeURIComponent(todo.id)}/run`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const runBody = await run.json().catch(() => ({}));
        fs.writeFileSync(path.join(OUT, "flow-api-run.json"), JSON.stringify({ status: run.status(), body: runBody }, null, 2));
        if (!run.ok()) {
          add({
            id: "BK-FLOW-005",
            target: "blanko",
            layer: "backend",
            severity: "P1",
            area: "Flow/Tasks",
            title: "POST /todos/:id/run failed",
            expected: "2xx agent start",
            actual: `${run.status()} ${JSON.stringify(runBody).slice(0, 400)}`,
            evidence: "flow-api-run.json",
          });
        } else {
          let finalStatus = todo.status;
          let railId: string | null = null;
          for (let i = 0; i < 20; i++) {
            await page.waitForTimeout(4000);
            const again = await request.get(`${API}/api/todos?workspaceId=${encodeURIComponent(workspaceId)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const body = (await again.json()) as {
              todos?: Array<{ id: string; status: string; rail_id?: string }>;
            };
            const row = body.todos?.find((t) => t.id === todo.id);
            finalStatus = row?.status ?? finalStatus;
            railId = row?.rail_id ?? railId;
            if (row && /needs_review|done|completed|error|failed/i.test(row.status)) break;
          }
          fs.writeFileSync(
            path.join(OUT, "flow-api-run-status.json"),
            JSON.stringify({ finalStatus, railId }, null, 2)
          );

          if (/needs_review/i.test(finalStatus)) {
            if (railId) {
              const diff = await request.get(
                `${API}/api/rails/${encodeURIComponent(railId)}/diff?workspaceId=${encodeURIComponent(workspaceId)}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              fs.writeFileSync(
                path.join(OUT, "flow-api-diff.json"),
                JSON.stringify({ status: diff.status(), body: await diff.json().catch(() => ({})) }, null, 2)
              );
            }
            const approve = await request.post(`${API}/api/todos/${encodeURIComponent(todo.id)}/approve`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const approveBody = await approve.json().catch(() => ({}));
            fs.writeFileSync(
              path.join(OUT, "flow-api-approve.json"),
              JSON.stringify({ status: approve.status(), body: approveBody }, null, 2)
            );
            if (!approve.ok()) {
              add({
                id: "BK-FLOW-006",
                target: "blanko",
                layer: "backend",
                severity: "P1",
                area: "Flow/Tasks",
                title: "POST /todos/:id/approve failed on needs_review task",
                expected: "2xx apply sandbox",
                actual: `${approve.status()} ${JSON.stringify(approveBody).slice(0, 300)}`,
                evidence: "flow-api-approve.json",
              });
            }
          } else if (!/done|completed/i.test(finalStatus)) {
            add({
              id: "BK-FLOW-007",
              target: "blanko",
              layer: "backend",
              severity: "P2",
              area: "Flow/Tasks",
              title: "Run agent did not reach needs_review within poll window",
              expected: "needs_review (or completed)",
              actual: `status=${finalStatus}`,
              evidence: "flow-api-run-status.json flow-api-run.json",
            });
          }
        }
      }

      if (fs.existsSync(path.join(OUT, "user-flow-tasks.png"))) {
        add({
          id: "BK-FLOW-015",
          target: "blanko",
          layer: "ui",
          severity: "P2",
          area: "Flow/Tasks",
          title: "Live dogfood board shows mixed micro-fix + spine issue cards (observed)",
          expected: "Spine filter isolates trading-spine seeds; Issues filter isolates issues",
          actual:
            "User session: dogfood micro-fix in To do/Doing/Needs review + 'Trading scan is missing the architecture spine' in Needs review",
          evidence: "user-flow-tasks.png",
        });
      }
      return;
    }

    // Agent select should prefer execute-turn when scan agents present
    const agentSelect = page.getByTestId("flow-tasks-agent");
    await expect(agentSelect).toBeVisible();
    const agentOptions = await agentSelect.locator("option").allTextContents();
    fs.writeFileSync(path.join(OUT, "flow-agent-options.json"), JSON.stringify(agentOptions, null, 2));
    if (!agentOptions.some((o) => /execute-turn/i.test(o))) {
      add({
        id: "BK-FLOW-008",
        target: "both",
        layer: "ui",
        severity: "P1",
        area: "Flow/Tasks",
        title: "Agent dropdown missing execute-turn.js on trading scan workspace",
        expected: "execute-turn.js option",
        actual: JSON.stringify(agentOptions),
        evidence: "32-flow-tasks-signed.png flow-agent-options.json",
      });
    } else {
      const value = await agentSelect.locator("option").evaluateAll((opts) => {
        const hit = opts.find((o) => /execute-turn/i.test((o as HTMLOptionElement).text || (o as HTMLOptionElement).value));
        return hit ? (hit as HTMLOptionElement).value : "";
      });
      if (value) await agentSelect.selectOption(value);
    }

    // Hint: Seed ≠ canvas spine
    await expect(page.getByTestId("flow-seed-hint")).toContainText(/does not apply the canvas spine/i);

    // Seed
    const seedBtn = page.getByTestId("flow-seed-pipeline");
    await expect(seedBtn).toBeVisible();
    const seedLabel = await seedBtn.innerText();
    if (!/Already seeded/i.test(seedLabel)) {
      await seedBtn.click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: shot("33-flow-seeded.png"), fullPage: true });
    const boardText = await page.getByTestId("flow-tasks-board").innerText();
    if (!/Payment|Broker|Policy|spine|Seeded|Already seeded/i.test(boardText)) {
      add({
        id: "BK-FLOW-009",
        target: "blanko",
        layer: "ui",
        severity: "P1",
        area: "Flow/Tasks",
        title: "Seed trading spine did not show spine cards on board",
        expected: "Payment/Broker/Policy spine todos visible",
        actual: boardText.slice(0, 400),
        evidence: "33-flow-seeded.png",
      });
    }

    // Filters
    for (const f of ["all", "spine", "issues"] as const) {
      const chip = page.getByTestId(`flow-tasks-filter-${f}`);
      if (await chip.isVisible().catch(() => false)) {
        await chip.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: shot(`34-filter-${f}.png`), fullPage: true });
      }
    }
    await page.getByTestId("flow-tasks-filter-all").click().catch(() => {});

    // Import from Path
    const importBtn = page.getByTestId("flow-import-path-issues");
    await expect(importBtn).toBeVisible();
    await importBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot("35-import-path.png"), fullPage: true });

    // Activity
    await expect(page.getByTestId("flow-tasks-activity")).toBeVisible();

    // Entitlements line
    const ent = page.getByTestId("flow-tasks-entitlements");
    if (await ent.isVisible().catch(() => false)) {
      fs.writeFileSync(path.join(OUT, "flow-entitlements.txt"), await ent.innerText());
    }

    // Run agent on first To do card
    const runBtn = page.getByRole("button", { name: /Run agent/i }).first();
    if (await runBtn.isVisible().catch(() => false)) {
      await runBtn.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: shot("36-run-agent.png"), fullPage: true });

      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(3000);
        const approveBtn = page
          .getByTestId(/flow-task-approve-/)
          .first()
          .or(page.getByRole("button", { name: /^Approve$/i }).first());
        if (await approveBtn.isVisible().catch(() => false)) {
          await page.screenshot({ path: shot("37-needs-review.png"), fullPage: true });
          const viewDiff = page.getByRole("button", { name: /View diff/i }).first();
          if (await viewDiff.isVisible().catch(() => false)) {
            await viewDiff.click();
            await page.waitForTimeout(1000);
            await page.screenshot({ path: shot("38-view-diff.png"), fullPage: true });
          }
          await approveBtn.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: shot("39-after-approve.png"), fullPage: true });
          const notice = await page.getByTestId("flow-tasks-notice").innerText().catch(() => "");
          if (!/Approved|Completed|applied/i.test(notice + (await page.getByTestId("flow-tasks-board").innerText()))) {
            add({
              id: "BK-FLOW-012",
              target: "blanko",
              layer: "ui+backend",
              severity: "P1",
              area: "Flow/Tasks",
              title: "Approve did not show success / Completed state",
              expected: "Approved notice or Completed column",
              actual: notice.slice(0, 200),
              evidence: "39-after-approve.png",
            });
          }
          break;
        }
      }
    } else {
      const readiness = page.getByTestId("flow-run-readiness");
      if (await readiness.isVisible().catch(() => false)) {
        add({
          id: "BK-FLOW-013",
          target: "blanko",
          layer: "ui",
          severity: "P2",
          area: "Flow/Tasks",
          title: "Run agent not ready banner shown — no Run button",
          expected: "Run agent available with BILLING_DEV_UNLIMITED + scanned root",
          actual: await readiness.innerText(),
          evidence: "32-flow-tasks-signed.png",
        });
      } else {
        add({
          id: "BK-FLOW-014",
          target: "blanko",
          layer: "ui",
          severity: "P2",
          area: "Flow/Tasks",
          title: "No Run agent button on To do cards after seed",
          expected: "Run agent on To do",
          actual: "button missing",
          evidence: "33-flow-seeded.png",
        });
      }
    }

    if (fs.existsSync(path.join(OUT, "user-flow-tasks.png"))) {
      add({
        id: "BK-FLOW-015",
        target: "blanko",
        layer: "ui",
        severity: "P2",
        area: "Flow/Tasks",
        title: "Live dogfood board shows mixed micro-fix + spine issue cards (observed)",
        expected: "Spine filter isolates trading-spine seeds; Issues filter isolates issues",
        actual:
          "User session: dogfood micro-fix in To do/Doing/Needs review + 'Trading scan is missing the architecture spine' in Needs review",
        evidence: "user-flow-tasks.png",
      });
    }
  });

  test("source contracts: Seed ≠ canvas spine; Approve owns done", async () => {
    const board = fs.readFileSync(path.join(process.cwd(), "webapp/client/src/FlowTasksBoard.tsx"), "utf8");
    const seed = fs.readFileSync(path.join(process.cwd(), "webapp/client/src/flowTradingSeed.ts"), "utf8");
    const gate = fs.readFileSync(path.join(process.cwd(), "webapp/client/src/todoStatusGate.ts"), "utf8");

    expect(board).toMatch(/flow-seed-pipeline/);
    expect(board).toMatch(/flow-import-path-issues/);
    expect(board).toMatch(/Does not apply the canvas spine/);
    expect(board).toMatch(/flow-task-approve-/);
    expect(board).toMatch(/canManualAdvanceTodo/);
    expect(seed).toMatch(/trading-spine:p1-payment/);
    expect(seed).toMatch(/execute-turn\.js/);
    expect(gate).toMatch(/Use Approve to apply sandbox changes/);

    fs.writeFileSync(
      path.join(OUT, "flow-source-contracts.json"),
      JSON.stringify({ seedCards: (seed.match(/trading-spine:p\d+/g) ?? []).length, ok: true }, null, 2)
    );
  });
});

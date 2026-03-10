/**
 * E2E integration tests for rails API:
 * - POST /api/rails/from-violation
 * - POST /api/rails/:railId/execute
 * - POST /api/rails/:railId/materialize (gating)
 *
 * Uses mocks for Supabase and auth; fixture directory for project root.
 * Run: npm run test -- webapp/server/src/rails.integration.test.ts
 */

import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

const FIXTURE_ROOT = path.join(process.cwd(), ".tmp-rails-integration");
const TEST_USER_ID = "test-user-rails-integration";
const TEST_WS_ID = "test-ws-rails-integration";

beforeAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE_ROOT, ".agent", "rails"), { recursive: true });
  fs.mkdirSync(path.join(FIXTURE_ROOT, "src"), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_ROOT, "src", "index.ts"), "export const x = 1;\n", "utf-8");
});

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

// Mock requireUser to inject test user when X-Test-User-Id header present
vi.mock("./middleware/requireUser.js", () => ({
  requireUser: (_req: any, _res: any, next: () => void) => {
    (_req as any).user = { id: (_req.get?.("X-Test-User-Id") as string) || TEST_USER_ID };
    next();
  },
}));

// Mock optionalUser to inject test user
vi.mock("./middleware/optionalUser.js", () => ({
  optionalUser: (_req: any, _res: any, next: () => void) => {
    (_req as any).user = { id: (_req.get?.("X-Test-User-Id") as string) || TEST_USER_ID };
    next();
  },
}));

// Mock supabaseAdmin for workspace resolution and from-violation
vi.mock("./supabaseAdmin.js", () => {
  const FIXTURE_ROOT_MOCK = path.join(process.cwd(), ".tmp-rails-integration");
  const TEST_WS_ID_MOCK = "test-ws-rails-integration";
  const wsRow = { id: TEST_WS_ID_MOCK, project_root: FIXTURE_ROOT_MOCK, owner_id: "test-user" };
  const violRow = { id: "viol-test-1", workspace_id: TEST_WS_ID_MOCK };
  const chain = (data: unknown) => ({
    select: () => chain(data),
    eq: () => chain(data),
    order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { repo_url: null }, error: null }) }) }),
    single: () => Promise.resolve({ data: wsRow, error: null }),
    maybeSingle: () => Promise.resolve({ data, error: null }),
  });
  return {
    supabaseAdmin: {
      from: (table: string) => {
        const data = table === "workspaces" ? wsRow : table === "violations" ? violRow : table === "graphs" ? { repo_url: null } : null;
        return {
          ...chain(data),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          insert: () => Promise.resolve({ error: null }),
        };
      },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "test-user" } }, error: null }) },
    },
  };
});

describe("rails integration", () => {
  it("POST /api/rails/from-violation creates rail and returns 201", async () => {
    const { app } = await import("./index.js");
    const res = await request(app)
      .post("/api/rails/from-violation")
      .set("X-Test-User-Id", TEST_USER_ID)
      .send({
        workspaceId: TEST_WS_ID,
        violation: {
          id: "viol-test-1",
          type: "layer_violation",
          severity: "critical",
          sourceNodeId: "src/index",
          description: "Fix the layer violation",
          suggestedFix: "Refactor to correct layer",
        },
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("railId");
    expect(typeof res.body.railId).toBe("string");
    expect(res.body.railId).toContain("rail-violation");
  });

  it("POST /api/rails/from-violation returns 400 when violation missing", async () => {
    const { app } = await import("./index.js");
    const res = await request(app)
      .post("/api/rails/from-violation")
      .set("X-Test-User-Id", TEST_USER_ID)
      .send({ workspaceId: TEST_WS_ID });
    expect(res.status).toBe(400);
    expect(res.body?.error || res.body?.message || "").toMatch(/violation/i);
  });

  it("POST /api/rails/:railId/execute returns 202 when rail exists and has code_change tasks", async () => {
    const railId = "rail-execute-test-" + Date.now();
    const railPath = path.join(FIXTURE_ROOT, ".agent", "rails", `${railId}.json`);
    const rail = {
      id: railId,
      version: 1,
      outcome: "Test rail",
      trigger: { source: "chat", userMessage: "Test" },
      archetype: "analysis-chat",
      logicPath: [{ step: 1, layer: "Service", nodeId: "src/index", filePath: "src/index.ts", action: "modify" }],
      state: "AWAITING_APPROVAL",
      tasks: [
        {
          id: `task-${railId}-1`,
          railId,
          kind: "code_change",
          description: "Update index",
          files: ["src/index.ts"],
          autoCapable: true,
          status: "pending",
          agent: "executor",
          logicStep: 1,
          createdAt: Date.now(),
        },
      ],
      jiraKeys: [],
      traceIds: [],
      overlaps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "human",
      sessionId: TEST_USER_ID,
    };
    fs.writeFileSync(railPath, JSON.stringify(rail), "utf-8");

    const { app } = await import("./index.js");
    const res = await request(app)
      .post(`/api/rails/${railId}/execute`)
      .query({ workspaceId: TEST_WS_ID })
      .set("X-Test-User-Id", TEST_USER_ID);
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty("taskId");
    expect(res.body).toHaveProperty("railId", railId);

    fs.unlinkSync(railPath);
  });

  it("POST /api/rails/:railId/materialize returns 409 when verification not passed", async () => {
    const railId = "rail-materialize-gate-" + Date.now();
    const railPath = path.join(FIXTURE_ROOT, ".agent", "rails", `${railId}.json`);
    const rail = {
      id: railId,
      version: 1,
      outcome: "Test rail",
      trigger: { source: "chat", userMessage: "Test" },
      archetype: "analysis-chat",
      logicPath: [{ step: 1, layer: "Service", nodeId: "src/index", filePath: "src/index.ts", action: "modify" }],
      state: "EXECUTING",
      tasks: [
        {
          id: `task-${railId}-1`,
          railId,
          kind: "code_change",
          description: "Update",
          files: [],
          autoCapable: true,
          status: "completed",
          agent: "executor",
          logicStep: 1,
          createdAt: Date.now(),
        },
        {
          id: `task-${railId}-2`,
          railId,
          kind: "verification",
          description: "Verify",
          files: [],
          autoCapable: true,
          status: "pending",
          agent: "executor",
          logicStep: 2,
          createdAt: Date.now(),
        },
      ],
      jiraKeys: [],
      traceIds: [],
      overlaps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "human",
      sessionId: TEST_USER_ID,
    };
    fs.writeFileSync(railPath, JSON.stringify(rail), "utf-8");
    fs.mkdirSync(path.join(FIXTURE_ROOT, ".agent", "sandboxes", railId, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(FIXTURE_ROOT, ".agent", "sandboxes", railId, "src", "index.ts"),
      "export const y = 2;",
      "utf-8"
    );

    const { app } = await import("./index.js");
    const res = await request(app)
      .post(`/api/rails/${railId}/materialize`)
      .query({ workspaceId: TEST_WS_ID })
      .set("X-Test-User-Id", TEST_USER_ID);
    expect(res.status).toBe(409);
    expect(res.body?.error || res.body?.message || JSON.stringify(res.body)).toMatch(/verification|Verification/i);

    fs.unlinkSync(railPath);
    fs.rmSync(path.join(FIXTURE_ROOT, ".agent", "sandboxes", railId), { recursive: true, force: true });
  });

  it("error responses use standard ApiError shape (error, code)", async () => {
    const { app } = await import("./index.js");
    const res = await request(app)
      .post("/api/rails/from-violation")
      .set("X-Test-User-Id", TEST_USER_ID)
      .send({ workspaceId: TEST_WS_ID });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
  });

  it("POST /api/rails/:railId/materialize returns 200 when verification passed", async () => {
    const railId = "rail-materialize-success-" + Date.now();
    const railPath = path.join(FIXTURE_ROOT, ".agent", "rails", `${railId}.json`);
    const rail = {
      id: railId,
      version: 1,
      outcome: "Test rail",
      archetype: "analysis-chat",
      logicPath: [{ step: 1, layer: "Service", nodeId: "src/index", filePath: "src/index.ts", action: "modify" }],
      state: "VERIFYING",
      tasks: [
        { id: `t1-${railId}`, railId, kind: "code_change", status: "completed", agent: "executor", logicStep: 1, createdAt: Date.now() },
        { id: `t2-${railId}`, railId, kind: "verification", status: "completed", agent: "executor", logicStep: 2, createdAt: Date.now() },
      ],
      jiraKeys: [],
      traceIds: [],
      overlaps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "human",
      sessionId: TEST_USER_ID,
    };
    fs.writeFileSync(railPath, JSON.stringify(rail), "utf-8");
    const sandboxDir = path.join(FIXTURE_ROOT, ".agent", "sandboxes", railId, "src");
    fs.mkdirSync(sandboxDir, { recursive: true });
    fs.writeFileSync(path.join(sandboxDir, "index.ts"), "export const z = 3;", "utf-8");
    fs.writeFileSync(path.join(FIXTURE_ROOT, "src", "index.ts"), "export const x = 1;", "utf-8");

    const { app } = await import("./index.js");
    const res = await request(app)
      .post(`/api/rails/${railId}/materialize`)
      .query({ workspaceId: TEST_WS_ID })
      .set("X-Test-User-Id", TEST_USER_ID);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("railId", railId);
    expect(res.body).toHaveProperty("state", "ARCHIVED");

    fs.unlinkSync(railPath);
    fs.rmSync(path.join(FIXTURE_ROOT, ".agent", "sandboxes", railId), { recursive: true, force: true });
  });
});

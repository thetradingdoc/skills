import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  isMissingGithubFullNameError,
  updateWorkspaceRepoMeta,
  findWorkspaceIdByGithubFullName,
  loadWorkspaceRepoFields,
} from "../webapp/server/src/workspaceRepoMeta";
import { getModuleId } from "../src/analyzer/scanner";
import { buildAgentInventory } from "../scripts/agent-inventory";

describe("workspaceRepoMeta github_full_name soft-gate", () => {
  it("detects missing-column errors", () => {
    expect(isMissingGithubFullNameError({ message: "Could not find the 'github_full_name' column" })).toBe(
      true
    );
    expect(isMissingGithubFullNameError({ message: "PGRST204" })).toBe(true);
    expect(isMissingGithubFullNameError({ message: "permission denied" })).toBe(false);
  });

  it("retries update without github_full_name when column missing", async () => {
    const updates: unknown[] = [];
    const supabaseAdmin = {
      from: () => ({
        update: (payload: unknown) => {
          updates.push(payload);
          return {
            eq: async () => {
              if (updates.length === 1) {
                return {
                  error: { message: "Could not find the 'github_full_name' column of 'workspaces'" },
                };
              }
              return { error: null };
            },
          };
        },
      }),
    };
    const res = await updateWorkspaceRepoMeta(supabaseAdmin, "ws-1", {
      repo_url: "https://github.com/acme/app",
      project_root: "/tmp/app",
      github_full_name: "acme/app",
    });
    expect(res).toEqual({ ok: true, wroteGithubFullName: false });
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual({
      repo_url: "https://github.com/acme/app",
      project_root: "/tmp/app",
    });
  });

  it("falls back to repo_url when github_full_name lookup fails", async () => {
    let lookups = 0;
    const supabaseAdmin = {
      from: () => ({
        select: () => ({
          eq: (_col: string, _val: string) => ({
            is: () => ({
              maybeSingle: async () => {
                lookups += 1;
                if (lookups === 1) {
                  return { data: null, error: { message: "PGRST204 github_full_name" } };
                }
                return { data: { id: "ws-fallback" }, error: null };
              },
            }),
          }),
          ilike: () => ({
            is: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    };
    const id = await findWorkspaceIdByGithubFullName(supabaseAdmin, "acme/app");
    expect(id).toBe("ws-fallback");
  });

  it("loadWorkspaceRepoFields omits missing column", async () => {
    let calls = 0;
    const supabaseAdmin = {
      from: () => ({
        select: (cols: string) => ({
          eq: () => ({
            single: async () => {
              calls += 1;
              if (cols.includes("github_full_name")) {
                return { data: null, error: { message: "github_full_name schema cache" } };
              }
              return { data: { id: "ws-1", repo_url: "https://github.com/a/b" }, error: null };
            },
          }),
        }),
      }),
    };
    const ws = await loadWorkspaceRepoFields(supabaseAdmin, "ws-1");
    expect(calls).toBe(2);
    expect(ws).toEqual({
      id: "ws-1",
      repo_url: "https://github.com/a/b",
      github_full_name: null,
    });
  });
});

describe("scanner trading services split", () => {
  const root = "/repo";

  it("does not emit bare middleware-platform/services for nested folders", () => {
    expect(
      getModuleId(root, path.join(root, "middleware-platform/services/compliance/live0.js"))
    ).toBe("middleware-platform/services/compliance");
    expect(
      getModuleId(root, path.join(root, "middleware-platform/services/strategy/pead.js"))
    ).toBe("middleware-platform/services/strategy");
  });

  it("aliases residual flat service files away from mega node", () => {
    expect(
      getModuleId(root, path.join(root, "middleware-platform/services/llm-router.js"))
    ).toBe("middleware-platform/services/agent-runtime");
    expect(
      getModuleId(root, path.join(root, "middleware-platform/services/logger.js"))
    ).toBe("middleware-platform/services/data_obs");
    expect(
      getModuleId(root, path.join(root, "middleware-platform/services/unknown-future.js"))
    ).toBe("middleware-platform/services/platform-utils");
  });
});

describe("agent inventory allowlists", () => {
  // In-repo audit dump (same tool-allowlists SSOT shape as live trading-agent)
  const fixtureRoot = path.resolve(__dirname, "../docs/ops/_audit_86a9ac1");

  it("merges tool-allowlists.js onto execute-turn (propose-only SSOT)", () => {
    const inv = buildAgentInventory(fixtureRoot);
    const exec = inv.agents.find((a) =>
      /trading-rails\/execute-turn/i.test(a.file.replace(/\\/g, "/"))
    );
    expect(exec, "execute-turn surface").toBeTruthy();
    const names = new Set((exec?.tools ?? []).map((t) => t.name));
    expect(names.has("get_quote")).toBe(true);
    expect(names.has("propose_action")).toBe(true);
    expect(names.has("paper_preview_order")).toBe(true);
    expect([...names].some((n) => /submit_order|paper_submit/i.test(n))).toBe(false);
    const notes = (exec?.tools ?? []).filter((t) => /lane allowlist/i.test(t.note ?? ""));
    expect(notes.length).toBeGreaterThan(0);
  });
});

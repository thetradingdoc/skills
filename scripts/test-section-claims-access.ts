/**
 * Table-driven unit checks for the P2a collaboration role gates: who may
 * edit a workspace (assertCanEdit) and who may release a section claim
 * (canReleaseClaim). No network, no Supabase — pure functions only.
 *
 * Run with: npx tsx scripts/test-section-claims-access.ts
 */
import assert from "node:assert/strict";
import { assertCanEdit, type WorkspaceAccessRow } from "../webapp/server/src/workspaceAccess.ts";
import { canReleaseClaim } from "../webapp/server/src/sectionClaims.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    throw err;
  }
}

function accessOf(role: WorkspaceAccessRow["role"]): WorkspaceAccessRow {
  return { id: "ws1", owner_id: "owner-user", role };
}

// ── assertCanEdit ───────────────────────────────────────────────────────

check("assertCanEdit: allows an owner", () => {
  assert.doesNotThrow(() => assertCanEdit(accessOf("owner")));
});

check("assertCanEdit: allows an editor", () => {
  assert.doesNotThrow(() => assertCanEdit(accessOf("editor")));
});

check("assertCanEdit: rejects a viewer with a 403", () => {
  assert.throws(
    () => assertCanEdit(accessOf("viewer")),
    (err: unknown) => {
      const e = err as { statusCode?: number; message?: string };
      return e.statusCode === 403 && !!e.message;
    }
  );
});

// ── canReleaseClaim ───────────────────────────────────────────────────────

const ws = { owner_id: "owner-user" };

check("canReleaseClaim: the claimer may release their own claim", () => {
  assert.equal(canReleaseClaim({ claimer_id: "editor-user" }, ws, "editor-user"), true);
});

check("canReleaseClaim: the workspace owner may release anyone's claim", () => {
  assert.equal(canReleaseClaim({ claimer_id: "editor-user" }, ws, "owner-user"), true);
});

check("canReleaseClaim: a third party may not release someone else's claim", () => {
  assert.equal(canReleaseClaim({ claimer_id: "editor-user" }, ws, "another-user"), false);
});

check("canReleaseClaim: a viewer with no claim and no ownership is denied", () => {
  assert.equal(canReleaseClaim({ claimer_id: "editor-user" }, ws, "viewer-user"), false);
});

// ── Phase gate: viewers can look but not touch ─────────────────────────────
// This is the property the FE Claim button and BE claim/comment/finding
// routes all lean on: a viewer can always read, and assertCanEdit is the
// single gate that keeps them from writing.

check("phase gate: every non-viewer role passes assertCanEdit, only viewer fails", () => {
  const roles: WorkspaceAccessRow["role"][] = ["owner", "editor", "viewer"];
  const results = roles.map((role) => {
    try {
      assertCanEdit(accessOf(role));
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(results, [true, true, false]);
});

console.log(`\n${passed} section-claims access checks passed`);

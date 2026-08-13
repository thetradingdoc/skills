/**
 * Insights → todo payload helpers.
 */
import assert from "node:assert/strict";
import {
  buildInsightsTodoPayload,
  insightsTodoSourcePath,
} from "../webapp/client/src/insightsTodo.ts";
import type { ArchNode } from "../webapp/client/src/types.ts";
import type { NodeNextAction } from "../webapp/client/src/insightsBriefing.ts";

const node: ArchNode = {
  id: "middleware-platform",
  label: "Middleware Platform",
  path: "middleware-platform",
  layer: "Data Access",
  subsystem: "ingress",
  files: ["middleware-platform/server.js", "middleware-platform/database.js"],
};

const action: NodeNextAction = {
  id: "audit-server",
  title: "Review server boot",
  detail: "Port, env mode, CORS.",
  priority: "high",
  kind: "code",
  filePath: "middleware-platform/server.js",
  taskTitle: "Audit server.js boot & middleware",
};

const path = insightsTodoSourcePath(node.id, action.id);
assert.equal(path, "insights:middleware-platform:audit-server");

const payload = buildInsightsTodoPayload(node, action);
assert.equal(payload.source, "insights");
assert.equal(payload.sourcePath, path);
assert.equal(payload.sourceNodeId, node.id);
assert.equal(payload.kind, "task");
assert.equal(payload.assigneeLabel, "Cursor");
assert.equal(payload.agentFile, "middleware-platform/server.js");
assert.ok(payload.fileScope.includes("middleware-platform/server.js"));
assert.ok(payload.fileScope.includes("middleware-platform/database.js"));
assert.equal(payload.layerId, "ingress");
assert.match(payload.context, /Middleware Platform/);

console.log("ok: insights todo payload");

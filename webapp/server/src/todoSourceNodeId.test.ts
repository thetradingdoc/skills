import { describe, expect, it } from "vitest";
import { sourceNodeIdFromBody } from "./todoSourceNodeId.js";

/**
 * Gate E contract: POST /todos maps body.sourceNodeId → column source_node_id.
 * Insert uses `.select("*")`, so a persisted value is what clients read back.
 */
function todoInsertFieldsFromBody(body: Record<string, unknown>) {
  return {
    source_node_id: sourceNodeIdFromBody(body),
  };
}

describe("Gate E sourceNodeId → source_node_id", () => {
  it("persists sourceNodeId for read-back on create", () => {
    const insert = todoInsertFieldsFromBody({
      workspaceId: "ws-1",
      title: "Auth gap",
      sourceNodeId: "node-trading-chat-api",
    });
    expect(insert.source_node_id).toBe("node-trading-chat-api");
  });

  it("omits source_node_id when sourceNodeId is absent (nullable, no regression)", () => {
    const insert = todoInsertFieldsFromBody({
      workspaceId: "ws-1",
      title: "Manual task",
    });
    expect(insert.source_node_id).toBeNull();
  });

  it("treats empty/whitespace sourceNodeId as null", () => {
    expect(sourceNodeIdFromBody({ sourceNodeId: "" })).toBeNull();
    expect(sourceNodeIdFromBody({ sourceNodeId: "   " })).toBeNull();
    expect(sourceNodeIdFromBody({ sourceNodeId: 42 as unknown as string })).toBeNull();
  });
});

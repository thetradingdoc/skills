/**
 * Unit checks for greenfield design graph helpers (no browser).
 */
import assert from "node:assert/strict";
import {
  applyDesignCommandsToGraph,
  createBlankDesignGraph,
  createDesignArchNode,
  isDesignGraph,
  paletteItemToNode,
} from "../webapp/client/src/greenfieldDesign.ts";

const blank = createBlankDesignGraph();
assert.equal(blank.nodes.length, 0);
assert.equal(isDesignGraph(blank), true);
assert.equal(isDesignGraph({ ...blank, projectRoot: "/tmp/repo" }), false);
assert.equal(
  isDesignGraph({ ...blank, architectureBoard: true, projectRoot: "" }),
  true,
  "scratch spine without projectRoot stays greenfield"
);
assert.equal(
  isDesignGraph({ ...blank, architectureBoard: true, projectRoot: "/Users/x/trading-agent" }),
  false,
  "spine + scanned projectRoot uses analysis mode"
);

const withChat = applyDesignCommandsToGraph(blank, [
  {
    action: "create_node",
    id: "a",
    label: "API",
    layer: "Presentation",
  },
  {
    action: "create_node",
    id: "b",
    label: "DB",
    layer: "Data Access",
  },
  { action: "connect", fromId: "a", toId: "b" },
  { action: "update_node", id: "a", label: "Login API" },
]);

assert.equal(withChat.nodes.length, 2);
assert.equal(withChat.nodes.find((n) => n.id === "a")?.label, "Login API");
assert.equal(withChat.edges.length, 1);
assert.equal(withChat.edges[0]?.source, "a");
assert.ok(
  ["calls", "uses"].includes(String(withChat.edges[0]?.relation)),
  `unexpected relation ${withChat.edges[0]?.relation}`
);

const withRel = applyDesignCommandsToGraph(withChat, [
  { action: "connect", fromId: "b", toId: "a", relation: "reads" },
]);
assert.equal(withRel.edges.find((e) => e.source === "b")?.relation, "reads");

const dnd = paletteItemToNode("auth");
assert.ok(dnd);
assert.equal(dnd!.label, "Auth");
assert.ok(dnd!.id.startsWith("design-auth-"));

const manual = createDesignArchNode({ id: "x", label: "X", layer: "Memory" });
assert.equal(manual.status, "new");
assert.deepEqual(manual.files, []);

console.log("greenfieldDesign helpers OK");

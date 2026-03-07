"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RAIL_GRAPH_EDGES = exports.RAIL_GRAPH_NODES = void 0;
exports.RAIL_GRAPH_NODES = [
    { id: "plan_node", label: "Plan" },
    { id: "hitl_approve_plan", label: "Approve plan (HITL)" },
    { id: "executor_node", label: "Execute" },
    { id: "hitl_gate_node", label: "Gate (HITL)" },
    { id: "reviewer_node", label: "Review (checks)" },
    { id: "materialize_node", label: "Materialize" },
    { id: "archive_node", label: "Archive" },
];
exports.RAIL_GRAPH_EDGES = [
    { from: "plan_node", to: "hitl_approve_plan" },
    { from: "hitl_approve_plan", to: "executor_node" },
    { from: "executor_node", to: "hitl_gate_node" },
    { from: "hitl_gate_node", to: "reviewer_node" },
    { from: "reviewer_node", to: "materialize_node" },
    { from: "materialize_node", to: "archive_node" },
];

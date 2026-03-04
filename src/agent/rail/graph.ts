import type { Rail, RailStateSnapshot } from "../types";

export type RailGraphNodeId =
  | "plan_node"
  | "hitl_approve_plan"
  | "executor_node"
  | "hitl_gate_node"
  | "reviewer_node"
  | "materialize_node"
  | "archive_node";

export interface RailGraphNode {
  id: RailGraphNodeId;
  label: string;
}

export interface RailGraphEdge {
  from: RailGraphNodeId;
  to: RailGraphNodeId;
}

export const RAIL_GRAPH_NODES: RailGraphNode[] = [
  { id: "plan_node", label: "Plan" },
  { id: "hitl_approve_plan", label: "Approve plan (HITL)" },
  { id: "executor_node", label: "Execute" },
  { id: "hitl_gate_node", label: "Gate (HITL)" },
  { id: "reviewer_node", label: "Review (checks)" },
  { id: "materialize_node", label: "Materialize" },
  { id: "archive_node", label: "Archive" },
];

export const RAIL_GRAPH_EDGES: RailGraphEdge[] = [
  { from: "plan_node", to: "hitl_approve_plan" },
  { from: "hitl_approve_plan", to: "executor_node" },
  { from: "executor_node", to: "hitl_gate_node" },
  { from: "hitl_gate_node", to: "reviewer_node" },
  { from: "reviewer_node", to: "materialize_node" },
  { from: "materialize_node", to: "archive_node" },
];

export interface RailGraphContext {
  rail: Rail;
  snapshot: RailStateSnapshot;
}


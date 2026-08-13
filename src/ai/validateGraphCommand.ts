/**
 * Shared GraphCommand validation — used by greenfield enricher and webapp server middleware.
 * No heavy dependencies (only types).
 */

import type { EdgeRelation, GraphCommand, NodeLayer } from "../types";

export const VALID_LAYERS: NodeLayer[] = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized",
];

export const VALID_EDGE_RELATIONS: EdgeRelation[] = [
  "calls",
  "uses",
  "retrieves",
  "reads",
  "writes",
  "publishes",
  "subscribes",
  "authenticates_via",
  "caches",
  "depends_on",
  "channel_to",
];

function isValidLayer(v: string): v is NodeLayer {
  return VALID_LAYERS.includes(v as NodeLayer);
}

function isValidRelation(v: string): v is EdgeRelation {
  return VALID_EDGE_RELATIONS.includes(v as EdgeRelation);
}

const ID_PATTERN = /^[a-zA-Z0-9_\-\/\.]+$/;
const PATH_TRAVERSAL = /\.\.|\\\\|\/\//;

function validateNodeId(id: string): string | null {
  if (id.length > 200) return "Node ID too long";
  if (PATH_TRAVERSAL.test(id)) return "Node ID must not contain path traversal (.. or //)";
  if (!ID_PATTERN.test(id))
    return "Node ID must use only alphanumeric, underscore, hyphen, slash, or dot";
  return null;
}

export type GraphCommandValidationResult =
  | { valid: true; command: GraphCommand }
  | { valid: false; error: string };

export function validateGraphCommand(raw: unknown): GraphCommandValidationResult {
  if (!raw || typeof raw !== "object") return { valid: false, error: "graphCommand must be an object" };
  const o = raw as Record<string, unknown>;

  if (o.action === "create_node") {
    if (typeof o.id !== "string") return { valid: false, error: "create_node requires string id" };
    if (typeof o.label !== "string") return { valid: false, error: "create_node requires string label" };
    if (typeof o.layer !== "string") return { valid: false, error: "create_node requires string layer" };
    if (!isValidLayer(o.layer))
      return { valid: false, error: `create_node requires valid layer: ${VALID_LAYERS.join(", ")}` };
    const idErr = validateNodeId(o.id);
    if (idErr) return { valid: false, error: `create_node id: ${idErr}` };
    return {
      valid: true,
      command: {
        action: "create_node",
        id: o.id,
        label: o.label,
        layer: o.layer as NodeLayer,
        description: typeof o.description === "string" ? o.description : undefined,
        archNodeId: typeof o.archNodeId === "string" ? o.archNodeId : undefined,
        skeletonCode: typeof o.skeletonCode === "string" ? o.skeletonCode : undefined,
        layoutHint: typeof o.layoutHint === "string" ? o.layoutHint : undefined,
        group: typeof o.group === "string" ? o.group : undefined,
      },
    };
  }

  if (o.action === "connect") {
    if (typeof o.fromId !== "string") return { valid: false, error: "connect requires string fromId" };
    if (typeof o.toId !== "string") return { valid: false, error: "connect requires string toId" };
    const fromErr = validateNodeId(o.fromId);
    if (fromErr) return { valid: false, error: `connect fromId: ${fromErr}` };
    const toErr = validateNodeId(o.toId);
    if (toErr) return { valid: false, error: `connect toId: ${toErr}` };
    return {
      valid: true,
      command: {
        action: "connect",
        fromId: o.fromId,
        toId: o.toId,
        edgeType:
          typeof o.edgeType === "string" ? (o.edgeType as "import" | "reexport" | "dynamic") : undefined,
        relation:
          typeof o.relation === "string" && isValidRelation(o.relation) ? o.relation : undefined,
      },
    };
  }

  if (o.action === "reset") return { valid: true, command: { action: "reset" } };
  return { valid: false, error: "graphCommand must have action: create_node, connect, or reset" };
}

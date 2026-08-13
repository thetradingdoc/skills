/**
 * Stable n8n node identity across re-imports and config variants.
 *
 * AEST/EST calendar fixtures share workflow id `lNyRohsNFjJGS02f`. A three-part
 * `n8n:{workflowId}:{nodeId}` would collide and silently overwrite. Always include
 * variantKey; only the default (or explicitly chosen) variant materializes nodes.
 */

export const DEFAULT_VARIANT_KEY = "default";

export function buildExternalId(
  workflowId: string,
  variantKey: string,
  n8nNodeId: string
): string {
  const wf = (workflowId || "unknown").trim() || "unknown";
  const vk = (variantKey || DEFAULT_VARIANT_KEY).trim() || DEFAULT_VARIANT_KEY;
  const nid = (n8nNodeId || "").trim();
  if (!nid) throw new Error("buildExternalId: n8nNodeId is required");
  return `n8n:${wf}:${vk}:${nid}`;
}

export function parseExternalId(externalId: string): {
  workflowId: string;
  variantKey: string;
  n8nNodeId: string;
} | null {
  if (!externalId.startsWith("n8n:")) return null;
  const rest = externalId.slice(4);
  const parts = rest.split(":");
  if (parts.length < 3) return null;
  const n8nNodeId = parts.slice(2).join(":");
  return { workflowId: parts[0]!, variantKey: parts[1]!, n8nNodeId };
}

/** True when this variant should emit ArchNodes into the merged graph. */
export function shouldMaterializeVariant(
  variantKey: string,
  materializeVariantKey: string = DEFAULT_VARIANT_KEY
): boolean {
  return (variantKey || DEFAULT_VARIANT_KEY) === materializeVariantKey;
}

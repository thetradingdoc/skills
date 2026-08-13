/**
 * Post-V1 — deploy/CI/env health aggregation (pure, unit-tested).
 *
 * Combines each node's requiredEnv gaps (vars used in code but missing from
 * .env.example, per src/agent/envScanner.ts) and CI status into the
 * node.deployHealth shape already declared in types.ts.
 */
export type DeployHealthNode = {
  id: string;
  label?: string;
  path?: string | null;
  files?: string[];
  requiredEnv?: string[];
};

/** An env var missing from .env.example, with the files that reference it. */
export type EnvGap = {
  varName: string;
  files: string[];
};

export type CiStatus = "success" | "failure" | "pending" | "unknown";
export type DeployHealthStatus = "healthy" | "degraded" | "failed" | "unknown";

export type DeployHealth = {
  status: DeployHealthStatus;
  summary?: string;
  checkedAt?: string;
  missingEnv?: string[];
  ciStatus?: CiStatus;
};

function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/\\/g, "/");
}

/** True when an env-gap file (relative to project root) belongs to this node. */
function fileMatchesNode(file: string, node: DeployHealthNode): boolean {
  const f = normalizePath(file);
  if (node.path) {
    const p = normalizePath(node.path).replace(/\/$/, "");
    if (f === p || f.startsWith(p + "/")) return true;
  }
  for (const raw of node.files ?? []) {
    const n = normalizePath(raw);
    if (n === f || f.endsWith("/" + n) || n.endsWith("/" + f)) return true;
  }
  return false;
}

/**
 * Env vars missing for this node: declared requiredEnv that are gapped,
 * plus any gap whose referencing files land inside this node's path/files.
 */
export function missingEnvForNode(node: DeployHealthNode, envGaps: EnvGap[]): string[] {
  const requiredSet = new Set(node.requiredEnv ?? []);
  const missing = new Set<string>();
  for (const gap of envGaps) {
    if (requiredSet.has(gap.varName)) {
      missing.add(gap.varName);
      continue;
    }
    if ((gap.files ?? []).some((f) => fileMatchesNode(f, node))) {
      missing.add(gap.varName);
    }
  }
  return [...missing];
}

function summarize(status: DeployHealthStatus, missingEnv: string[], ciStatus: CiStatus): string {
  const parts: string[] = [];
  if (ciStatus === "failure") parts.push("CI failing");
  if (missingEnv.length > 0) {
    parts.push(`${missingEnv.length} missing env var${missingEnv.length === 1 ? "" : "s"}`);
  }
  if (parts.length > 0) return parts.join(" · ");
  if (status === "healthy") return "Healthy — CI passing, env complete";
  return "No CI or env signal yet";
}

export function buildDeployHealth(input: {
  nodes: DeployHealthNode[];
  envGaps?: EnvGap[];
  ciByNode?: Record<string, CiStatus>;
  now?: Date;
}): { nodes: Array<{ nodeId: string; deployHealth: DeployHealth }>; hotspots: string[] } {
  const now = input.now ?? new Date();
  const envGaps = input.envGaps ?? [];
  const ciByNode = input.ciByNode ?? {};
  const checkedAt = now.toISOString();

  const results = (input.nodes ?? []).map((node) => {
    const missingEnv = missingEnvForNode(node, envGaps);
    const ciStatus: CiStatus = ciByNode[node.id] ?? "unknown";

    let status: DeployHealthStatus;
    if (ciStatus === "failure") {
      status = "failed";
    } else if (missingEnv.length > 0) {
      status = "degraded";
    } else if (ciStatus === "success") {
      status = "healthy";
    } else {
      status = "unknown";
    }

    const deployHealth: DeployHealth = {
      status,
      summary: summarize(status, missingEnv, ciStatus),
      checkedAt,
      missingEnv,
      ciStatus,
    };
    return { nodeId: node.id, deployHealth };
  });

  const hotspots = results
    .filter((r) => r.deployHealth.status === "failed" || r.deployHealth.status === "degraded")
    .map((r) => r.nodeId);

  return { nodes: results, hotspots };
}

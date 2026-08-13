/**
 * Strip pinData and redact secrets before persisting n8n raw JSON.
 * pinData holds live execution payloads (PII). Never retain it.
 */

const SECRET_KEY =
  /^(api[_-]?key|secret|token|password|pwd|authorization|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret)$/i;

const HIGH_ENTROPY = /\b([A-Za-z0-9+/_-]{32,}|[A-Fa-f0-9]{40,})\b/g;

export function redactSecretsInString(raw: string): string {
  if (!raw) return raw;
  let out = raw;
  out = out.replace(
    /^([A-Z0-9_]*(SECRET|TOKEN|KEY|PASSWORD|PWD)[A-Z0-9_]*\s*=\s*)(.+)$/gim,
    "$1[REDACTED]"
  );
  out = out.replace(
    /(["']?(apiKey|api_key|secret|token|password|pwd)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi,
    "$1[REDACTED]$4"
  );
  out = out.replace(HIGH_ENTROPY, "[REDACTED]");
  return out;
}

function redactValue(key: string | null, value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (key && SECRET_KEY.test(key)) return "[REDACTED]";
    return redactSecretsInString(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(null, v));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v);
    }
    return out;
  }
  return value;
}

/**
 * Returns a deep-cloned workflow JSON safe to persist:
 * - pinData removed entirely
 * - secret-like parameter values redacted
 * - does not mutate the input
 */
export function sanitizeWorkflowRaw(raw: unknown): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(raw ?? {})) as Record<string, unknown>;
  delete clone.pinData;
  if (Array.isArray(clone.nodes)) {
    clone.nodes = clone.nodes.map((node) => {
      if (!node || typeof node !== "object") return node;
      const n = node as Record<string, unknown>;
      if (n.parameters && typeof n.parameters === "object") {
        n.parameters = redactValue("parameters", n.parameters);
      }
      if (n.credentials && typeof n.credentials === "object") {
        // Keep credential *refs* (id/name) — never secret values. n8n exports are refs only.
        n.credentials = n.credentials;
      }
      return n;
    });
  }
  return clone;
}

/** True if any pinData keys exist with non-empty payloads. */
export function hasPinData(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const pin = (raw as { pinData?: unknown }).pinData;
  if (!pin || typeof pin !== "object") return false;
  return Object.keys(pin as object).length > 0;
}

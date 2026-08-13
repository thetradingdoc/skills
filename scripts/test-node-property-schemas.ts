/**
 * Post-V1 unit checks — polymorphic node property schema registry.
 * Run: node --import tsx scripts/test-node-property-schemas.ts
 */
import { schemaForNode } from "../webapp/client/src/nodePropertySchemas";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log("  ok -", name);
    passed++;
  } else {
    console.log("  FAIL -", name, detail ?? "");
    failed++;
  }
}

function hasField(fields: { key: string }[], key: string): boolean {
  return fields.some((f) => f.key === key);
}

console.log("node-property-schemas checks");

// postgres/db techKind → connectionString field
ok(
  "postgres node id → connectionString field",
  hasField(schemaForNode({ id: "design-postgres-1700000000000-0", label: "Postgres" }).fields, "connectionString")
);
ok(
  "db node id → connectionString field",
  hasField(schemaForNode({ id: "design-db-1700000000000-0", label: "Database" }).fields, "connectionString")
);
ok(
  "database techKind (scanned/materialized node) → connectionString field",
  hasField(schemaForNode({ techKind: "database", label: "Users DB" }).fields, "connectionString")
);
ok(
  "vector-db node id isn't shadowed by the shorter 'db' id",
  hasField(schemaForNode({ id: "design-vector-db-1700000000000-0", label: "Vector DB" }).fields, "connectionString")
);

// api → authType enum
{
  const schema = schemaForNode({ id: "design-api-1700000000000-0", label: "API / Gateway" });
  ok("api node id → authType field present", hasField(schema.fields, "authType"));
  const authType = schema.fields.find((f) => f.key === "authType");
  ok("api authType is an enum with none|apiKey|jwt|oauth", authType?.type === "enum" && ["none", "apiKey", "jwt", "oauth"].every((o) => authType!.options?.includes(o)));
}
ok(
  "http-api techKind → authType field",
  hasField(schemaForNode({ techKind: "http-api", label: "Orders API" }).fields, "authType")
);

// queue → topic
ok(
  "queue node id → topic field",
  hasField(schemaForNode({ id: "design-queue-1700000000000-0", label: "Queue" }).fields, "topic")
);
ok(
  "kafka node id → topic field",
  hasField(schemaForNode({ id: "design-kafka-1700000000000-0", label: "Kafka" }).fields, "topic")
);
ok(
  "queue techKind → topic field",
  hasField(schemaForNode({ techKind: "queue", label: "Jobs" }).fields, "topic")
);
ok(
  "message-bus techKind → topic field",
  hasField(schemaForNode({ techKind: "message-bus", label: "Event bus" }).fields, "topic")
);

// cache → ttlSeconds
ok(
  "cache node id → ttlSeconds field",
  hasField(schemaForNode({ id: "design-cache-1700000000000-0", label: "Cache" }).fields, "ttlSeconds")
);
ok(
  "redis node id → ttlSeconds field",
  hasField(schemaForNode({ id: "design-redis-1700000000000-0", label: "Redis" }).fields, "ttlSeconds")
);

// agent → systemPromptHint / maxTokens / temperature
{
  const schema = schemaForNode({ id: "design-agent-1700000000000-0", label: "Agent", kind: "agent" });
  ok(
    "agent node → systemPromptHint, maxTokens, temperature",
    ["systemPromptHint", "maxTokens", "temperature"].every((k) => hasField(schema.fields, k))
  );
}
ok(
  "kind=agent alone (no palette id) → agent schema",
  hasField(schemaForNode({ id: "custom-node-id", label: "Support Bot", kind: "agent" }).fields, "systemPromptHint")
);
ok(
  "label containing 'agent' with no palette id or kind → agent schema",
  hasField(schemaForNode({ id: "custom-node-id", label: "Trading Agent" }).fields, "systemPromptHint")
);

// auth / safety → protocol enum
{
  const schema = schemaForNode({ id: "design-auth-1700000000000-0", label: "Auth" });
  ok("auth node → protocol field", hasField(schema.fields, "protocol"));
  const protocol = schema.fields.find((f) => f.key === "protocol");
  ok("auth protocol is an enum with oidc|saml|apiKey", protocol?.type === "enum" && ["oidc", "saml", "apiKey"].every((o) => protocol!.options?.includes(o)));
  ok("auth node → issuerUrl field", hasField(schema.fields, "issuerUrl"));
}
ok(
  "label containing 'safety' with no palette id → auth/safety schema",
  hasField(schemaForNode({ id: "custom-node-id", label: "Safety Gateway" }).fields, "protocol")
);

// unknown → empty
ok("unrecognized node → empty fields", schemaForNode({ id: "design-cdn-1700000000000-0", label: "CDN" }).fields.length === 0);
ok("bare node with no hints → empty fields", schemaForNode({ label: "Something Bespoke" }).fields.length === 0);
ok("empty node object → empty fields", schemaForNode({}).fields.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

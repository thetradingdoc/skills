-- ============================================================
-- violations table  —  run in Supabase SQL editor or via CLI
-- v2: adds trigger for recurrence-safe upsert behavior
-- ============================================================

CREATE TABLE IF NOT EXISTS violations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE CASCADE,

  fingerprint       TEXT NOT NULL,
  rules_version     TEXT NOT NULL DEFAULT 'v1',
  type              TEXT NOT NULL,
  severity          TEXT NOT NULL,
  source_node_id    TEXT NOT NULL,
  target_node_id    TEXT,
  description       TEXT,
  suggested_fix     TEXT,

  structural_state  TEXT NOT NULL DEFAULT 'active',
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recurrence_count  INTEGER NOT NULL DEFAULT 1,

  policy_state      TEXT NOT NULL DEFAULT 'new',
  jira_key          TEXT,
  jira_status       TEXT,

  CONSTRAINT violations_workspace_fingerprint_uq
    UNIQUE (workspace_id, fingerprint, rules_version),

  CONSTRAINT violations_severity_chk
    CHECK (severity IN ('low','medium','high','critical'))
);

-- ── Trigger: preserve first_seen_at and jira linkage on upsert ──────────────
CREATE OR REPLACE FUNCTION violations_preserve_on_upsert()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.first_seen_at IS NOT NULL THEN
    NEW.first_seen_at := OLD.first_seen_at;
  END IF;
  IF OLD.jira_key IS NOT NULL AND NEW.jira_key IS NULL THEN
    NEW.jira_key    := OLD.jira_key;
    NEW.jira_status := OLD.jira_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS violations_upsert_preserve ON violations;
CREATE TRIGGER violations_upsert_preserve
  BEFORE UPDATE ON violations
  FOR EACH ROW
  EXECUTE FUNCTION violations_preserve_on_upsert();

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS violations_workspace_id_idx
  ON violations(workspace_id);

CREATE INDEX IF NOT EXISTS violations_jira_key_idx
  ON violations(jira_key)
  WHERE jira_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS violations_node_severity_idx
  ON violations(workspace_id, source_node_id, severity)
  WHERE structural_state = 'active';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY violations_owner_policy ON violations
  USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );

-- ── Atomic bump function for recurrence + severity ──────────────────────────

CREATE OR REPLACE FUNCTION bump_violation(
  p_workspace_id   uuid,
  p_fingerprint    text,
  p_rules_version  text,
  p_type           text,
  p_severity       text,
  p_source_node_id text,
  p_target_node_id text,
  p_description    text,
  p_suggested_fix  text,
  p_now            timestamptz
) RETURNS violations AS $$
DECLARE
  v violations;
BEGIN
  INSERT INTO violations (
    workspace_id,
    fingerprint,
    rules_version,
    type,
    severity,
    source_node_id,
    target_node_id,
    description,
    suggested_fix,
    structural_state,
    first_seen_at,
    last_seen_at,
    recurrence_count,
    policy_state
  )
  VALUES (
    p_workspace_id,
    p_fingerprint,
    p_rules_version,
    p_type,
    p_severity,
    p_source_node_id,
    p_target_node_id,
    p_description,
    p_suggested_fix,
    'active',
    p_now,
    p_now,
    1,
    'new'
  )
  ON CONFLICT (workspace_id, fingerprint, rules_version)
  DO UPDATE SET
    severity = GREATEST(violations.severity, EXCLUDED.severity),
    structural_state = 'active',
    last_seen_at = p_now,
    recurrence_count = CASE
      WHEN p_now - violations.last_seen_at >= interval '4 hours'
        THEN violations.recurrence_count + 1
      ELSE violations.recurrence_count
    END,
    policy_state = CASE
      WHEN violations.policy_state = 'resolved' THEN 'regressed'
      ELSE violations.policy_state
    END
  RETURNING * INTO v;

  RETURN v;
END;
$$ LANGUAGE plpgsql;

-- ── Scan audit table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS violation_scans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  rules_version    text NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  violations_count integer NOT NULL DEFAULT 0,
  regressed_count  integer NOT NULL DEFAULT 0,
  health_score     numeric,
  status           text NOT NULL DEFAULT 'completed'
);

ALTER TABLE violation_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY violation_scans_owner_policy ON violation_scans
  USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );

-- ── Policy audit trail ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS violation_policy_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id   uuid REFERENCES violations(id) ON DELETE CASCADE,
  workspace_id   uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id       uuid,
  previous_state text,
  new_state      text NOT NULL,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE violation_policy_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY violation_policy_events_owner_policy ON violation_policy_events
  USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );



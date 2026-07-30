-- Findings become objects.
--
-- Until now a finding was recomputed from scratch on every scan and had
-- nowhere to hold a decision. Nothing could be assigned, accepted, waived or
-- discussed, so there was nothing for a second person to work on.
--
-- One row per (workspace, finding). The finding_id comes from the ranker and
-- is deliberately derived from things that survive a rescan — a layer name, a
-- rule's text, an agent's file path — rather than from a content hash, which
-- would change whenever any tool was added and orphan every decision attached
-- to it.
--
-- Comments and state changes share one append-only log. A comment is a
-- decision with no state change, and keeping them in one place means the
-- timeline is a single read rather than two queries stitched together.

CREATE TABLE IF NOT EXISTS workspace_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Stable across rescans. See the note above.
  finding_id text NOT NULL,

  -- Copied from the scan so a finding still reads correctly after the
  -- underlying scan is superseded.
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  title text NOT NULL,
  detail text,
  source text,
  agent_file text,

  -- open: nobody has decided anything yet
  -- accepted: acknowledged as real, work expected
  -- waived: deliberately not fixing, rationale required
  -- resolved: believed fixed; the next scan confirms or reopens
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open','accepted','waived','resolved')),

  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rationale text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,

  -- Append-only. Entries: { at, actor, actor_name, kind, from, to, text }
  -- kind is 'comment' | 'state' | 'assign' | 'rationale'
  log jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Scan bookkeeping, so a finding can be reopened when it comes back.
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- true when the most recent scan no longer reports it
  absent boolean NOT NULL DEFAULT false,
  recurrence_count integer NOT NULL DEFAULT 1,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, finding_id)
);

CREATE INDEX IF NOT EXISTS workspace_findings_workspace_idx
  ON workspace_findings (workspace_id);

CREATE INDEX IF NOT EXISTS workspace_findings_state_idx
  ON workspace_findings (workspace_id, state);

CREATE INDEX IF NOT EXISTS workspace_findings_assignee_idx
  ON workspace_findings (assignee_id)
  WHERE assignee_id IS NOT NULL;

-- Atomic append, so two people commenting at once cannot lose an entry.
-- Follows the pattern already used by append_todo_session_log.
CREATE OR REPLACE FUNCTION append_finding_log(
  p_workspace_id uuid,
  p_finding_id text,
  p_entry jsonb
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE workspace_findings
  SET log = COALESCE(log, '[]'::jsonb) || jsonb_build_array(p_entry),
      updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND finding_id = p_finding_id;
$$;

-- Upsert from a scan. Preserves every human decision: state, assignee,
-- rationale and log are never overwritten here. Only what the scan knows —
-- severity, title, detail — is refreshed, plus the bookkeeping.
--
-- A finding that was resolved and has come back is reopened and its
-- recurrence counted, because "we fixed that" needs contradicting when the
-- scan disagrees.
CREATE OR REPLACE FUNCTION upsert_finding_from_scan(
  p_workspace_id uuid,
  p_finding_id text,
  p_severity text,
  p_title text,
  p_detail text,
  p_source text,
  p_agent_file text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_state text;
BEGIN
  SELECT id, state INTO v_id, v_state
  FROM workspace_findings
  WHERE workspace_id = p_workspace_id AND finding_id = p_finding_id;

  IF v_id IS NULL THEN
    INSERT INTO workspace_findings (
      workspace_id, finding_id, severity, title, detail, source, agent_file
    ) VALUES (
      p_workspace_id, p_finding_id, p_severity, p_title, p_detail,
      p_source, p_agent_file
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  UPDATE workspace_findings
  SET severity = p_severity,
      title = p_title,
      detail = p_detail,
      source = p_source,
      agent_file = p_agent_file,
      last_seen_at = now(),
      absent = false,
      recurrence_count = CASE WHEN absent THEN recurrence_count + 1 ELSE recurrence_count END,
      -- A resolved finding that reappears is open again.
      state = CASE WHEN state = 'resolved' THEN 'open' ELSE state END,
      updated_at = now()
  WHERE id = v_id;

  -- Record the reopening in the log so the contradiction is visible rather
  -- than silent.
  IF v_state = 'resolved' THEN
    PERFORM append_finding_log(
      p_workspace_id,
      p_finding_id,
      jsonb_build_object(
        'at', now(),
        'actor', NULL,
        'actor_name', 'scan',
        'kind', 'state',
        'from', 'resolved',
        'to', 'open',
        'text', 'Reopened: this finding was marked resolved but the latest scan still reports it.'
      )
    );
  END IF;

  RETURN v_id;
END;
$$;

-- Mark everything the latest scan did not report as absent, without deleting
-- it. A finding that stops appearing might be fixed, or might be in code the
-- tracer could no longer follow — either way the decision history is kept.
CREATE OR REPLACE FUNCTION mark_findings_absent(
  p_workspace_id uuid,
  p_present_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE workspace_findings
  SET absent = true, updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND absent = false
    AND NOT (finding_id = ANY(p_present_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- RLS omitted: workspace_members is not present in this project, and all
-- access goes through the service role. Add policies when that table exists.

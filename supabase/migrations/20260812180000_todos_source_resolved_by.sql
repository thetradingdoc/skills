-- Blanko redesign v2 §1: source normalization, resolved_by, open source_path uniqueness.

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS resolved_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'todos_resolved_by_check'
  ) THEN
    ALTER TABLE todos
      ADD CONSTRAINT todos_resolved_by_check
      CHECK (resolved_by IS NULL OR resolved_by IN ('rescan', 'manual'));
  END IF;
END $$;

-- Normalize known legacy source strings before constraining.
UPDATE todos SET source = 'seed_spine' WHERE source = 'trading-spine';
UPDATE todos SET source = 'dogfood'
  WHERE source IS NULL AND title ILIKE '[dogfood]%';
UPDATE todos SET source = 'manual'
  WHERE source IS NULL OR trim(source) = '';

-- Allow v2 sources plus legacy greenfield/violation (must not break existing rows).
DO $$
BEGIN
  ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_source_check;
  ALTER TABLE todos
    ADD CONSTRAINT todos_source_check
    CHECK (
      source IS NULL
      OR source IN (
        'insights',
        'seed_spine',
        'import_from_path',
        'manual',
        'dogfood',
        'greenfield',
        'violation',
        'trading-spine'
      )
    );
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'todos_source_check skipped: %', SQLERRM;
END $$;

-- Prevent duplicate open auto-enqueued insights todos under race.
CREATE UNIQUE INDEX IF NOT EXISTS todos_open_source_path_uniq
  ON todos (workspace_id, source_path)
  WHERE status IN ('todo', 'in_progress', 'needs_review')
    AND source_path IS NOT NULL
    AND archived_at IS NULL;

-- todos.updated_at required by set_updated_at() trigger (todos_updated_at)

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE todos SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS DISTINCT FROM created_at AND updated_at = now();

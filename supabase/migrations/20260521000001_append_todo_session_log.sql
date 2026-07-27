-- Atomic append to todos.session_log (avoids read-then-write races)

CREATE OR REPLACE FUNCTION append_todo_session_log(p_todo_id uuid, p_entry jsonb)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE todos
  SET session_log = COALESCE(session_log, '[]'::jsonb) || jsonb_build_array(p_entry)
  WHERE id = p_todo_id;
$$;

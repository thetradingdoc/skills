-- Optional base64-encoded PNG thumbnail for workspace preview in "Open saved" list.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS thumbnail_base64 TEXT;

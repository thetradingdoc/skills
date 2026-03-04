-- Per-user integrations (Jira, Slack, Linear)
-- Run in Supabase SQL editor or via: supabase db push

CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,

  -- Jira-specific (nullable for other providers)
  base_url TEXT,
  email TEXT,
  api_token TEXT,
  default_project TEXT,

  -- Status
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  last_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),  -- set manually on upsert; no auto-trigger

  CONSTRAINT integrations_user_provider_uq UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS integrations_user_id_idx ON integrations(user_id);
CREATE INDEX IF NOT EXISTS integrations_provider_idx ON integrations(provider);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_users_manage_own ON integrations;
CREATE POLICY integrations_users_manage_own ON integrations
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

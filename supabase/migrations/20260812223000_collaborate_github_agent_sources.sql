-- Collaborate Phase 3: allow todos.source = github; usage_events.source = agent_run

ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_source_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_source_check
  CHECK (source IN (
    'chat',
    'scan',
    'greenfield',
    'provider_api',
    'app_credit',
    'manual',
    'broker_api',
    'market_data_api',
    'fda_api',
    'agent_run'
  ));

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
        'trading-spine',
        'github'
      )
    );
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'todos_source_check widen skipped: %', SQLERRM;
END $$;

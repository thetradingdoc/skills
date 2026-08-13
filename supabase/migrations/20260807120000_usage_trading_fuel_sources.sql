-- Widen usage_events.source for trading ops fuel (broker / market-data / FDA).
-- Keep existing LLM sources.

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
    'fda_api'
  ));

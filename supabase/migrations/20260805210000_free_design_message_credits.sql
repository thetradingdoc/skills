-- V1 launch gate: free-tier design chat allowance (separate from Pro canUseAiAgent).
ALTER TABLE usage_balances
  ADD COLUMN IF NOT EXISTS design_message_credits integer NOT NULL DEFAULT 20;

COMMENT ON COLUMN usage_balances.design_message_credits IS
  'Free-plan design/greenfield chat messages remaining; Pro/Team do not consume this.';

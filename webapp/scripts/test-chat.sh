#!/usr/bin/env bash
# Test chat API: ask, path search, insights.
# Usage: ./webapp/scripts/test-chat.sh [bearer_token]
#
# Option A (no token): Add CHAT_DEV_BYPASS=1 to webapp/server/.env, restart server, then run:
#   ./webapp/scripts/test-chat.sh
#
# Option B (with token): Sign in at app, DevTools Console:
#   JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes("auth-token"))))?.session?.access_token

API="${API_BASE:-http://localhost:4000}"
ENDPOINT="$API/api/chat"
TOKEN="${1:-}"

# Minimal graph with path a -> b -> c
GRAPH='{"nodes":[{"id":"auth","label":"Auth","layer":"Presentation"},{"id":"api","label":"API","layer":"Orchestration"},{"id":"db","label":"Database","layer":"Data Access"}],"edges":[{"source":"auth","target":"api"},{"source":"api","target":"db"}],"projectRoot":"/tmp","projectName":"test","generatedAt":0}'

chat() {
  local q="$1"
  local extra="$2"
  echo "Q: $q"
  if [ -n "$TOKEN" ]; then
    curl -s -X POST "$ENDPOINT" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"question\":\"$q\",\"graph\":$GRAPH$extra}"
  else
    curl -s -X POST "$ENDPOINT" \
      -H "Content-Type: application/json" \
      -d "{\"question\":\"$q\",\"graph\":$GRAPH$extra}"
  fi
}

echo "=== Chat API tests (API=$API) ==="
echo ""

if [ -z "$TOKEN" ]; then
  echo "No token. To run without a token: start server with CHAT_DEV_BYPASS=1"
  echo "  (add CHAT_DEV_BYPASS=1 to webapp/server/.env, or: CHAT_DEV_BYPASS=1 npm run dev)"
  echo "Or pass token: ./webapp/scripts/test-chat.sh YOUR_TOKEN"
  echo ""
fi

echo "--- 1. Ask (general question) ---"
chat "What is the architecture of this graph?" | jq -c '{answer: .answer, hasGraphCommands: (.graphCommands != null)}' 2>/dev/null || chat "What is the architecture?" | tail -1
echo ""

echo "--- 2. Path search (path from auth to database) ---"
chat "path from auth to database" | jq -c '{answer: .answer, pathNodeIds: .graphCommands[0].nodeIds}' 2>/dev/null || chat "path from auth to database" | tail -1
echo ""

echo "--- 3. Insights ---"
chat "show insights" | jq -c '{answer: .answer, showInsightsPanel: .showInsightsPanel}' 2>/dev/null || chat "show insights" | tail -1
echo ""

echo "Done."

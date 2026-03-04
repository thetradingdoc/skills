#!/usr/bin/env bash
# Debug auth flow — run with server at localhost:4000
# Usage:
#   ./webapp/scripts/debug-auth.sh                    # config + chat test
#   ./webapp/scripts/debug-auth.sh "YOUR_JWT_TOKEN"   # full validation

API="${API_BASE:-http://localhost:4000}"

echo "=== 1. Server config ==="
curl -s "$API/api/auth/config" | jq . 2>/dev/null || curl -s "$API/api/auth/config"
echo ""

echo "=== 2. Chat without token (expect 401 missing) ==="
curl -s -w "\nHTTP %{http_code}\n" -X POST "$API/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"question":"test","graph":{"nodes":[{"id":"a","label":"a"}],"edges":[],"projectRoot":"/tmp","projectName":"x"}}'
echo ""

if [ -n "$1" ]; then
  echo "=== 3. Token validation (debug-validate) ==="
  curl -s -X POST "$API/api/auth/debug-validate" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$1\"}"
  echo ""

  echo "=== 4. Chat with your token ==="
  curl -s -w "\nHTTP %{http_code}" -X POST "$API/api/chat" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d '{"question":"test","graph":{"nodes":[{"id":"a","label":"a"}],"edges":[],"projectRoot":"/tmp","projectName":"x"}}'
  echo ""
else
  echo "=== 3. To test with a token ==="
  echo "   Sign in at http://localhost:5174, then in DevTools Console run:"
  echo '   JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes("auth-token"))))?.session?.access_token'
  echo "   Copy the token and run: ./webapp/scripts/debug-auth.sh \"<token>\""
fi

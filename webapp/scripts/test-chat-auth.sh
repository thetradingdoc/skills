#!/usr/bin/env bash
# Test chat API auth — run from project root
# Usage: ./webapp/scripts/test-chat-auth.sh [optional_bearer_token]

API="${API_BASE:-http://localhost:4000}"
ENDPOINT="$API/api/chat"

echo "Testing $ENDPOINT"
echo ""

# Test 1: No token
echo "1. No Authorization header (expect 401):"
curl -s -w "\nHTTP %{http_code}\n" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"question":"test","graph":{"nodes":[],"edges":[],"projectRoot":"","projectName":""}}' | tail -3
echo ""

# Test 2: Empty/malformed token
echo "2. Bearer with empty token (expect 401):"
curl -s -w "\nHTTP %{http_code}\n" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer " \
  -d '{"question":"test","graph":{"nodes":[],"edges":[],"projectRoot":"","projectName":""}}' | tail -3
echo ""

# Test 3: Invalid token
echo "3. Bearer with invalid token (expect 401 Unauthorized: invalid token):"
curl -s -w "\nHTTP %{http_code}\n" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.fake" \
  -d '{"question":"test","graph":{"nodes":[],"edges":[],"projectRoot":"","projectName":""}}' | tail -5
echo ""

# Test 4: With token from arg (if provided)
if [ -n "$1" ]; then
  echo "4. With provided token:"
  curl -s -w "\nHTTP %{http_code}\n" -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d '{"question":"create architecture","graph":{"nodes":[{"id":"a","label":"a"}],"edges":[],"projectRoot":"/tmp","projectName":"test"}}' | tail -5
fi

#!/usr/bin/env bash
#
# Mothership API smoke test script
# Runs against localhost:8787 in mock mode.
#
# Usage:
#   cd backend && bash scripts/test-api.sh
#
# Prerequisites:
#   - Worker running: bunx wrangler dev --port 8787
#   - MOCK_EXTERNAL_SERVICES=true in wrangler.jsonc or .dev.vars
#

set -euo pipefail

BASE="http://localhost:8787"
PASS=0
FAIL=0
TOTAL=0

# Read WORKFLOW_SECRET from .dev.vars
WF_SECRET=$(grep WORKFLOW_SECRET .dev.vars | cut -d= -f2 | tr -d '"' | tr -d ' ')

red()   { printf "\033[31m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
bold()  { printf "\033[1m%s\033[0m" "$1"; }

assert_status() {
  local label="$1" expected="$2" actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$actual" -eq "$expected" ]; then
    PASS=$((PASS + 1))
    echo "  $(green PASS) $label (HTTP $actual)"
  else
    FAIL=$((FAIL + 1))
    echo "  $(red FAIL) $label (expected $expected, got $actual)"
  fi
}

assert_json_field() {
  local label="$1" json="$2" field="$3" expected="$4"
  local actual
  actual=$(echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin)$field)" 2>/dev/null || echo "__PARSE_ERROR__")
  TOTAL=$((TOTAL + 1))
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
    echo "  $(green PASS) $label ($field = $actual)"
  else
    FAIL=$((FAIL + 1))
    echo "  $(red FAIL) $label ($field: expected '$expected', got '$actual')"
  fi
}

echo ""
bold "=== Mothership API Smoke Tests ==="
echo ""

# ─── 1. Health check ───
bold "1. Health Check"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/healthz")
assert_status "GET /healthz" 200 "$STATUS"
BODY=$(curl -s "$BASE/healthz")
assert_json_field "service name" "$BODY" "['status']" "ok"
echo ""

# ─── 2. Migrations ───
bold "2. Migrations"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/internal/migrate" -H "Authorization: Bearer ${WF_SECRET}")
assert_status "POST /internal/migrate (valid secret)" 200 "$STATUS"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/internal/migrate" -H "Authorization: Bearer wrong-secret")
assert_status "POST /internal/migrate (wrong secret)" 401 "$STATUS"
echo ""

# ─── 3. Public routes ───
bold "3. Public Routes"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/cloud/regions?provider=hetzner")
assert_status "GET /v1/cloud/regions?provider=hetzner" 200 "$STATUS"
BODY=$(curl -s "$BASE/v1/cloud/regions?provider=hetzner")
assert_json_field "provider field" "$BODY" "['provider']" "hetzner"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/cloud/regions")
assert_status "GET /v1/cloud/regions (missing param)" 400 "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/cloud/regions?provider=aws")
assert_status "GET /v1/cloud/regions?provider=aws (unsupported)" 400 "$STATUS"
echo ""

# ─── 4. Auth required ───
bold "4. Auth Required (no credentials)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/users/me")
assert_status "GET /v1/users/me (no auth)" 401 "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/bots")
assert_status "GET /v1/bots (no auth)" 401 "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/auth/tokens")
assert_status "GET /v1/auth/tokens (no auth)" 401 "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/billing/credits")
assert_status "GET /v1/billing/credits (no auth)" 401 "$STATUS"
echo ""

# ─── 5. Service token auth ───
bold "5. Service Token Auth"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/users/me" -H "Authorization: Bearer ${WF_SECRET}")
assert_status "GET /v1/users/me (service token, no user)" 403 "$STATUS"

# Service token can add credits for a user
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v1/billing/credits" \
  -H "Authorization: Bearer ${WF_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user-1","amount":100,"source":"test-topup"}')
assert_status "POST /v1/billing/credits (service token)" 201 "$STATUS"
echo ""

# ─── 6. CORS ───
bold "6. CORS Preflight"
CORS_HEADERS=$(curl -s -D - -o /dev/null -X OPTIONS "$BASE/v1/bots" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-api-key")
STATUS=$(echo "$CORS_HEADERS" | head -1 | grep -o '[0-9]\{3\}')
assert_status "OPTIONS /v1/bots (preflight)" 204 "$STATUS"

TOTAL=$((TOTAL + 1))
if echo "$CORS_HEADERS" | grep -qi "Access-Control-Allow-Origin: http://localhost:3000"; then
  PASS=$((PASS + 1))
  echo "  $(green PASS) CORS origin header present"
else
  FAIL=$((FAIL + 1))
  echo "  $(red FAIL) CORS origin header missing"
fi

# Reject unknown origin
CORS_BAD=$(curl -s -D - -o /dev/null -X OPTIONS "$BASE/v1/bots" \
  -H "Origin: http://evil.com" \
  -H "Access-Control-Request-Method: POST")
TOTAL=$((TOTAL + 1))
if echo "$CORS_BAD" | grep -qi "Access-Control-Allow-Origin: http://evil.com"; then
  FAIL=$((FAIL + 1))
  echo "  $(red FAIL) CORS should reject http://evil.com"
else
  PASS=$((PASS + 1))
  echo "  $(green PASS) CORS rejects unknown origin"
fi
echo ""

# ─── 7. 404 ───
bold "7. Not Found"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/nonexistent" -H "Authorization: Bearer ${WF_SECRET}")
assert_status "GET /v1/nonexistent (authenticated)" 404 "$STATUS"
echo ""

# ─── Summary ───
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
  echo "  $(green "ALL $TOTAL TESTS PASSED")"
else
  echo "  $(green "$PASS passed"), $(red "$FAIL failed") out of $TOTAL"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

exit "$FAIL"

#!/bin/bash
# Error handling verification tests for the A2A JS SDK.
# Tests that the server returns properly formatted enriched error responses
# (google.rpc.Status with ErrorInfo) across REST and JSON-RPC bindings.
#
# Starts a minimal A2A agent (no ITK dependencies) and sends requests
# that trigger various error conditions, validating the response format.

set -e

cd "$(dirname "$0")/.."

HTTP_PORT=10199
BASE_REST="http://127.0.0.1:${HTTP_PORT}/rest"
BASE_JSONRPC="http://127.0.0.1:${HTTP_PORT}/jsonrpc"
AGENT_PID=""
PASSED=0
FAILED=0
RESULT=1

cleanup() {
  if [ -n "$AGENT_PID" ]; then
    kill "$AGENT_PID" 2>/dev/null || true
    wait "$AGENT_PID" 2>/dev/null || true
  fi
  echo "--------------------------------------------------------"
  echo "Error Tests: ${PASSED} passed, ${FAILED} failed"
  echo "--------------------------------------------------------"
}
trap cleanup EXIT

# Start the minimal error test agent
echo "Starting error test agent on HTTP port ${HTTP_PORT}..."
npx tsx itk/error_test_agent.ts --httpPort "$HTTP_PORT" &
AGENT_PID=$!

# Wait for agent to be ready
MAX_RETRIES=15
for i in $(seq 1 $MAX_RETRIES); do
  if curl -s "http://127.0.0.1:${HTTP_PORT}/jsonrpc/.well-known/agent-card.json" > /dev/null 2>&1; then
    echo "Agent is ready."
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "Error: Agent failed to start"
    exit 1
  fi
  sleep 1
done

# Test helper: check a JSON field value using python
check_json() {
  local response="$1"
  local jq_path="$2"
  local expected="$3"
  local test_name="$4"

  actual=$(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
path = '$jq_path'.split('.')
obj = data
for key in path:
  if isinstance(obj, dict):
    obj = obj.get(key)
  elif isinstance(obj, list) and key.isdigit():
    idx = int(key)
    obj = obj[idx] if idx < len(obj) else None
  else:
    obj = None
    break
print(obj if obj is not None else '')
" 2>/dev/null)

  if [ "$actual" = "$expected" ]; then
    echo "  ✓ ${test_name}"
    PASSED=$((PASSED + 1))
  else
    echo "  ✗ ${test_name} (expected '${expected}', got '${actual}')"
    FAILED=$((FAILED + 1))
  fi
}

echo ""
echo "========================================================"
echo "REST (HTTP+JSON) Error Response Tests"
echo "========================================================"

# --- REST: TaskNotFoundError ---
echo ""
echo "--- GET /tasks/nonexistent (TaskNotFoundError) ---"
RESP=$(curl -s -w "\n%{http_code}" \
  -H "A2A-Version: 1.0" \
  "${BASE_REST}/tasks/nonexistent-task-id")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "404" ]; then
  echo "  ✓ HTTP status code is 404"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ HTTP status code (expected 404, got ${HTTP_CODE})"
  FAILED=$((FAILED + 1))
fi

# Check enriched format: { error: { code, status, message, details } }
check_json "$BODY" "error.code" "404" "error.code matches HTTP status"
check_json "$BODY" "error.status" "NOT_FOUND" "error.status is NOT_FOUND"

# Check error.message is non-empty
ERR_MSG=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message',''))" 2>/dev/null)
if [ -n "$ERR_MSG" ]; then
  echo "  ✓ error.message is present"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ error.message is empty"
  FAILED=$((FAILED + 1))
fi

# Check ErrorInfo in details (google.rpc.ErrorInfo per §11.6)
check_json "$BODY" "error.details.0.@type" "type.googleapis.com/google.rpc.ErrorInfo" "ErrorInfo @type in details"
check_json "$BODY" "error.details.0.reason" "TASK_NOT_FOUND" "ErrorInfo reason"
check_json "$BODY" "error.details.0.domain" "a2a-protocol.org" "ErrorInfo domain"

# --- REST: VersionNotSupportedError ---
echo ""
echo "--- GET /tasks/any with unsupported version ---"
RESP=$(curl -s -w "\n%{http_code}" \
  -H "A2A-Version: 99.0" \
  "${BASE_REST}/tasks/any-task")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
  echo "  ✓ HTTP status code is 400"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ HTTP status code (expected 400, got ${HTTP_CODE})"
  FAILED=$((FAILED + 1))
fi

check_json "$BODY" "error.status" "FAILED_PRECONDITION" "error.status is FAILED_PRECONDITION"
check_json "$BODY" "error.details.0.reason" "VERSION_NOT_SUPPORTED" "ErrorInfo reason"

# --- REST: Content-Type on error response ---
echo ""
echo "--- Error response Content-Type ---"
CT=$(curl -s -o /dev/null -w "%{content_type}" \
  -H "A2A-Version: 1.0" \
  "${BASE_REST}/tasks/nonexistent-task-id")

if echo "$CT" | grep -q "application/a2a+json"; then
  echo "  ✓ Content-Type is application/a2a+json"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ Content-Type (expected application/a2a+json, got ${CT})"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "========================================================"
echo "JSON-RPC Error Response Tests"
echo "========================================================"

# --- JSON-RPC: TaskNotFoundError ---
echo ""
echo "--- GetTask for nonexistent task ---"
BODY=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "A2A-Version: 1.0" \
  -d '{"jsonrpc":"2.0","id":1,"method":"GetTask","params":{"id":"nonexistent-task-id"}}' \
  "${BASE_JSONRPC}")

check_json "$BODY" "error.code" "-32001" "JSON-RPC error code is -32001 (TaskNotFound)"
check_json "$BODY" "jsonrpc" "2.0" "JSON-RPC version"

# Check error.message is non-empty
MSG=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('message',''))" 2>/dev/null)
if [ -n "$MSG" ]; then
  echo "  ✓ Error message is present: ${MSG}"
  PASSED=$((PASSED + 1))
else
  echo "  ✗ Error message is empty"
  FAILED=$((FAILED + 1))
fi

# --- JSON-RPC: VersionNotSupportedError ---
echo ""
echo "--- GetTask with unsupported version ---"
BODY=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "A2A-Version: 99.0" \
  -d '{"jsonrpc":"2.0","id":2,"method":"GetTask","params":{"id":"any"}}' \
  "${BASE_JSONRPC}")

check_json "$BODY" "error.code" "-32009" "JSON-RPC error code is -32009 (VersionNotSupported)"

# --- JSON-RPC: UnsupportedOperationError (streaming disabled) ---
echo ""
echo "--- SubscribeToTask when streaming is disabled ---"
BODY=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "A2A-Version: 1.0" \
  -d '{"jsonrpc":"2.0","id":3,"method":"SubscribeToTask","params":{"id":"any-task"}}' \
  "${BASE_JSONRPC}")

check_json "$BODY" "error.code" "-32004" "JSON-RPC error code is -32004 (UnsupportedOperation)"

echo ""

# Final result
if [ "$FAILED" -eq 0 ]; then
  echo "All error handling tests passed!"
  RESULT=0
else
  echo "Some error handling tests failed."
  RESULT=1
fi

exit $RESULT

#!/bin/bash
set -ex

cd "$(dirname "$0")"

# Set default log level
export ITK_LOG_LEVEL="${ITK_LOG_LEVEL:-INFO}"

# Initialize default exit code
RESULT=1

# Cleanup function to be called on exit
cleanup() {
  set +x
  echo "Cleaning up artifacts..."
  docker stop itk-service > /dev/null 2>&1 || true
  docker rm itk-service > /dev/null 2>&1 || true
  docker rmi itk_service > /dev/null 2>&1 || true
  rm -rf a2a-itk > /dev/null 2>&1 || true
  rm -rf pyproto > /dev/null 2>&1 || true
  rm -f instruction.proto > /dev/null 2>&1 || true
  rm -f raw_results.json > /dev/null 2>&1 || true
  echo "Done. Final exit code: $RESULT"
}

# Register cleanup function to run on script exit
trap cleanup EXIT

# 1. Pull a2a-itk and checkout revision. We use a2a-itk (not a2a-samples) so
# the ITK proto includes the newer `ResubscribeBehavior` / `hold_task` fields
# the v0.3 reference baselines (go_v03, python_v03) already consume — required
# for the resubscribe behavior scenarios below. a2a-itk is also the
# repository used by the a2a-python / a2a-go ITK harnesses (see
# `a2a-python/itk/run_itk.sh`), so all SDKs run against the same source of
# truth.
: "${A2A_ITK_REVISION:?A2A_ITK_REVISION environment variable must be set}"

if [ ! -d "a2a-itk" ]; then
  git clone -b "$A2A_ITK_REVISION" https://github.com/a2aproject/a2a-itk.git a2a-itk --depth 1
fi

# 2. Copy instruction.proto from a2a-itk
cp a2a-itk/protos/instruction.proto ./instruction.proto

# 3. Build pyproto library
mkdir -p pyproto
touch pyproto/__init__.py
uv run --with grpcio-tools python -m grpc_tools.protoc \
    -I. \
    --python_out=pyproto \
    --grpc_python_out=pyproto \
    instruction.proto

# Fix imports in generated file
sed -i 's/^import instruction_pb2 as instruction__pb2/from . import instruction_pb2 as instruction__pb2/' pyproto/instruction_pb2_grpc.py

# 3a. Regenerate the TypeScript proto bindings consumed by itk_agent.ts.
# The committed `pb/instruction.ts` in a2a-itk can lag behind the source
# `.proto` (e.g. when fields like `CallAgent.behavior` are added), so always
# regenerate from the authoritative `instruction.proto` we just copied. Buf
# requires the proto to live under the directory referenced by `buf.gen.yaml`
# (`./protos`); we stage it there for generation and clean up afterwards.
# Path is `a2a-itk/agents/ts/v10/`, four levels deep from the script — buf
# is invoked from that directory so the `../../../..` prefix resolves to the
# script's own working directory, and then `../node_modules` reaches the
# a2a-js SDK root.
TS_PB_DIR="a2a-itk/agents/ts/v10"
mkdir -p "${TS_PB_DIR}/protos"
cp instruction.proto "${TS_PB_DIR}/protos/instruction.proto"
(cd "${TS_PB_DIR}" && ../../../../../node_modules/.bin/buf generate)
rm -rf "${TS_PB_DIR}/protos"

# 4. Build jit itk_service docker image from a2a-itk root (the Dockerfile
# lives at the repo root in a2a-itk, not under a subdirectory like in
# a2a-samples).
docker build -t itk_service a2a-itk

# 5. Start docker service
# Mount the repo root (a2a-js) and the itk directory
A2A_JS_ROOT="$(pwd)/.."
ITK_DIR="$(pwd)"

# Stop existing container if any
docker rm -f itk-service || true

# Create logs directory if debug
DOCKER_MOUNT_LOGS=""
if [ "${ITK_LOG_LEVEL^^}" = "DEBUG" ]; then
  mkdir -p "$ITK_DIR/logs"
  DOCKER_MOUNT_LOGS="-v $ITK_DIR/logs:/app/logs"
fi

docker run -d --name itk-service \
  -v "$A2A_JS_ROOT:/app/agents/repo" \
  -v "$ITK_DIR:/app/agents/repo/itk" \
  $DOCKER_MOUNT_LOGS \
  -e ITK_LOG_LEVEL="$ITK_LOG_LEVEL" \
  -p 8000:8000 \
  itk_service

# 5.1. Fix dubious ownership for git (needed for uv-dynamic-versioning)
docker exec itk-service git config --global --add safe.directory /app/agents/repo
docker exec itk-service git config --global --add safe.directory /app/agents/repo/itk

# 6. Verify service is up and send post request
MAX_RETRIES=30
echo "Waiting for ITK service to start on 127.0.0.1:8000..."
set +e
for i in $(seq 1 $MAX_RETRIES); do
  if curl -s http://127.0.0.1:8000/ > /dev/null; then
    echo "Service is up!"
    break
  fi
  echo "Still waiting... ($i/$MAX_RETRIES)"
  sleep 2
done

# If we reached the end of the loop without success
if ! curl -s http://127.0.0.1:8000/ > /dev/null; then
  echo "Error: ITK service failed to start on port 8000"
  docker logs itk-service
  exit 1
fi

# 7. Pick the scenarios file. The PR set (`scenarios.json`) is the small,
# fast matrix that runs on every PR — currently a 22-scenario coverage of
# v1.0 native + v0.3 compat + resubscribe across all three transports,
# end-to-end with the go_v10 / go_v03 / python_v03 baselines. The nightly
# set (`scenarios_full.json`) adds tri-SDK and quad-SDK star topologies
# (every peer talks to current) on top of the PR set — exercising
# heterogeneous-SDK mixtures that are too expensive to run on every PR
# but catch cross-SDK regressions that the PR set's 2-node euler cycles
# cannot.
SCENARIO_FILE="scenarios.json"
if [ "${ITK_NIGHTLY_RUN^^}" = "TRUE" ]; then
  SCENARIO_FILE="scenarios_full.json"
fi

echo "ITK Service is up! Sending compatibility test request using $SCENARIO_FILE..."
RESPONSE=$(curl -s -X POST http://127.0.0.1:8000/run \
  -H "Content-Type: application/json" \
  -d "@$SCENARIO_FILE")

if [ "${ITK_NIGHTLY_RUN^^}" = "TRUE" ]; then
  # Nightly path: persist raw results and let a2a-itk's metrics processor
  # merge them into the rolling history JSON published as a release asset
  # on the `nightly-metrics` tag. Matches a2a-python's and a2a-go's
  # nightly artifact format so downstream dashboards can ingest all three
  # SDKs uniformly.
  echo "Nightly run detected. Saving raw results and running process_results.py..."
  echo "$RESPONSE" > raw_results.json
  python3 a2a-itk/scripts/process_results.py \
    --history_output_file itk_js.json \
    --history_url https://github.com/a2aproject/a2a-js/releases/download/nightly-metrics/itk_js.json
  RESULT=$?
  # Also print a human-readable summary so the GHA log still shows what
  # passed / failed, even though the canonical record is in itk_js.json.
  echo "--------------------------------------------------------"
  echo "NIGHTLY ITK SUMMARY:"
  echo "--------------------------------------------------------"
  echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    all_passed = data.get('all_passed', False)
    results = data.get('results', {})
    for test, passed in results.items():
        status = 'PASSED' if (passed.get('passed') if isinstance(passed, dict) else passed) else 'FAILED'
        print(f'{test}: {status}')
    print('--------------------------------------------------------')
    print(f'OVERALL STATUS: {\"PASSED\" if all_passed else \"FAILED\"}')
except Exception as e:
    print(f'Error parsing results: {e}')
"
else
  echo "--------------------------------------------------------"
  echo "ITK TEST RESULTS:"
  echo "--------------------------------------------------------"
  echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    all_passed = data.get('all_passed', False)
    results = data.get('results', {})
    for test, passed in results.items():
        status = 'PASSED' if (passed.get('passed') if isinstance(passed, dict) else passed) else 'FAILED'
        print(f'{test}: {status}')
    print('--------------------------------------------------------')
    print(f'OVERALL STATUS: {\"PASSED\" if all_passed else \"FAILED\"}')
    if not all_passed:
        sys.exit(1)
except Exception as e:
    print(f'Error parsing results: {e}')
    print(f'Raw response: {data if \"data\" in locals() else \"no data\"}')
    sys.exit(1)
"
  RESULT=$?
fi
set -e

if [ $RESULT -ne 0 ]; then
  echo "Tests failed. Container logs:"
  docker logs itk-service
fi
echo "--------------------------------------------------------"

# Final exit result will be captured by trap cleanup
exit $RESULT

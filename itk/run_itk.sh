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
  rm -rf a2a-samples > /dev/null 2>&1 || true
  rm -rf pyproto > /dev/null 2>&1 || true
  rm -f instruction.proto > /dev/null 2>&1 || true
  echo "Done. Final exit code: $RESULT"
}

# Register cleanup function to run on script exit
trap cleanup EXIT

# 1. Pull a2a-samples and checkout revision
: "${A2A_SAMPLES_REVISION:?A2A_SAMPLES_REVISION environment variable must be set}"

if [ ! -d "a2a-samples" ]; then
  git clone https://github.com/a2aproject/a2a-samples.git a2a-samples
fi
cd a2a-samples
git fetch origin
git checkout "$A2A_SAMPLES_REVISION"

# Only pull if it's a branch (not a detached HEAD)
if git symbolic-ref -q HEAD > /dev/null; then
  git pull origin "$A2A_SAMPLES_REVISION"
fi
cd ..

# 2. Copy instruction.proto from a2a-samples
cp a2a-samples/itk/protos/instruction.proto ./instruction.proto

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

# 4. Build jit itk_service docker image from root of a2a-samples/itk
docker build -t itk_service a2a-samples/itk

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

echo "ITK Service is up! Sending compatibility test request..."
RESPONSE=$(curl -s -X POST http://127.0.0.1:8000/run \
  -H "Content-Type: application/json" \
  -d '{
    "tests": [
      {
        "name": "Current vs Go v10 - JSONRPC & GRPC (Non-Streaming)",
        "sdks": ["current", "go_v10"],
        "traversal": "euler",
        "edges": ["0->1", "1->0"],
        "protocols": ["jsonrpc", "grpc"],
        "behavior": "send_message"
      },
      {
        "name": "Current vs Go v10 - HTTP_JSON (Non-Streaming)",
        "sdks": ["current", "go_v10"],
        "traversal": "euler",
        "edges": ["0->1", "1->0"],
        "protocols": ["http_json"],
        "behavior": "send_message"
      },
      {
        "name": "Current vs Go v10 - JSONRPC & GRPC (Streaming)",
        "sdks": ["current", "go_v10"],
        "traversal": "euler",
        "edges": ["0->1", "1->0"],
        "protocols": ["jsonrpc", "grpc"],
        "streaming": true,
        "behavior": "send_message"
      },
      {
        "name": "Current vs Go v10 - HTTP_JSON (Streaming)",
        "sdks": ["current", "go_v10"],
        "traversal": "euler",
        "edges": ["0->1", "1->0"],
        "protocols": ["http_json"],
        "streaming": true,
        "behavior": "send_message"
      },
      {
        "name": "Push Notification - JSONRPC & GRPC",
        "sdks": ["current", "go_v10"],
        "traversal": "euler",
        "edges": ["0->1", "1->0"],
        "protocols": ["jsonrpc", "grpc"],
        "behavior": "push_notification"
      },
      {
        "name": "Push Notification - HTTP_JSON",
        "sdks": ["current", "go_v10"],
        "traversal": "euler",
        "edges": ["0->1", "1->0"],
        "protocols": ["http_json"],
        "behavior": "push_notification"
      }
    ]
  }')

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
        status = 'PASSED' if passed else 'FAILED'
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
set -e

if [ $RESULT -ne 0 ]; then
  echo "Tests failed. Container logs:"
  docker logs itk-service
fi
echo "--------------------------------------------------------"

# Final exit result will be captured by trap cleanup
exit $RESULT

#!/bin/bash
# ITK harness for a2a-js — a thin shim over a2a-itk's shared driver.

set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

ITK_SDK_NAME=js
# This SDK is keyed as `ts` in matrix.yaml — its agent ids are ts_v10 / ts_v03
# — so the shared driver has to be told, or `sut_sdk` would name an SDK the
# matrix has never heard of.
ITK_MATRIX_SDK=ts
ITK_SCENARIO_SET=shared

itk_generate_protos() {
  # Python stubs: the launcher's own tooling reads these when it drives a
  # mounted checkout.
  mkdir -p pyproto
  touch pyproto/__init__.py
  uv run --with grpcio-tools python -m grpc_tools.protoc \
      -I. \
      --python_out=pyproto \
      --grpc_python_out=pyproto \
      instruction.proto
  sed -i 's/^import instruction_pb2 as instruction__pb2/from . import instruction_pb2 as instruction__pb2/' \
      pyproto/instruction_pb2_grpc.py

  # TS bindings for itk_agent.ts, via this repo's own buf.gen.yaml
  # (out: ./pb, inputs: ./protos).
  mkdir -p protos
  cp instruction.proto protos/instruction.proto
  ../node_modules/.bin/buf generate
  rm -rf protos
}

itk_extra_cleanup() {
  rm -rf pyproto pb protos
}

# --- bootstrap -------------------------------------------------------------
: "${A2A_ITK_REVISION:?A2A_ITK_REVISION environment variable must be set}"
if [ ! -d a2a-itk ]; then
  git clone https://github.com/a2aproject/a2a-itk.git a2a-itk
  git -C a2a-itk checkout "$A2A_ITK_REVISION"
fi

source a2a-itk/scripts/run_itk_shared.sh

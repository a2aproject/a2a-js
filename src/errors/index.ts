/**
 * Transport-agnostic A2A error hierarchy: base class, semantic
 * subclasses, plus the REST and JSON-RPC transport variants (both
 * Workers-safe, no pb runtime dependency).
 *
 * gRPC errors live at `@a2a-js/sdk/errors/grpc` because their
 * encode/decode helpers pull `@bufbuild/protobuf`.
 */

export * from './base.js';
export * from './rest.js';
export * from './json_rpc.js';

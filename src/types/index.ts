/**
 * Public entry point for the A2A v1.0 message types.
 *
 * Import protocol types and their JSON codecs from here rather than reaching
 * into `./pb/a2a.js` directly.
 *
 * Layering:
 * - `./pb/a2a.ts` is generated from `a2a.proto` by `buf generate` and must not
 *   be edited. It declares the message shapes, the enums and the package name.
 * - `./protojson.ts` is maintained by hand. It holds the ProtoJSON `fromJSON` /
 *   `toJSON` codecs and re-exports every message type, so a type and its codec
 *   share a single name.
 *
 * The generator runs with `outputJsonMethods=false`, so a change to the proto
 * needs the codecs updated by hand. See `./README.md`.
 */

// Message types and their codecs. Both halves of each name come from here, so
// this cannot be a second `export *` alongside the generated file: the shared
// names would become ambiguous star exports and drop out of the public API.
export * from './protojson.js';

// The enums and the package name have no codec and stay in the generated file.
export { protobufPackage, Role, TaskState } from './pb/a2a.js';

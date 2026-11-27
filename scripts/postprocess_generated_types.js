// Post-processes the ts-proto output after `buf generate`. Idempotent.
//
// 1. src/types/pb/a2a.ts: ts-proto ignores `google.api.field_behavior` and types
//    every field without the proto `optional` keyword as required. Fields added
//    after 1.0 without `REQUIRED` are marked optional here, so 1.0-era code that
//    builds these objects keeps compiling (spec §5.7; additive minor versions).
// 2. src/grpc/pb/a2a.ts: replaces the generated message interfaces and enums with
//    aliases of the canonical types in src/types/pb/a2a.ts, and makes the binary
//    codecs tolerate the fields in (1) being unset.
//
// Generated files are never edited by hand: `npm run generate` must reproduce
// the checked-in output exactly.
import fs from 'fs';
import path from 'path';

const OPTIONAL_FIELDS = {
  Task: ['timeline', 'generation'],
  Artifact: ['startGeneration', 'endGeneration', 'role'],
  TaskStatusUpdateEvent: ['generation'],
  TaskArtifactUpdateEvent: ['generation'],
  TaskPushNotificationConfig: ['protocolVersion'],
  SendMessageRequest: ['artifactUpdates'],
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const typesFile = path.join(root, 'src/types/pb/a2a.ts');
const grpcFile = path.join(root, 'src/grpc/pb/a2a.ts');

function markOptional(src) {
  for (const [iface, fields] of Object.entries(OPTIONAL_FIELDS)) {
    const start = src.indexOf(`\nexport interface ${iface} {\n`);
    if (start < 0) throw new Error(`interface ${iface} not found in ${typesFile}`);
    const end = src.indexOf('\n}\n', start);
    let body = src.slice(start, end);
    for (const field of fields) {
      if (body.includes(`\n  ${field}?:`)) continue;
      if (!body.includes(`\n  ${field}:`)) throw new Error(`${iface}.${field} not found`);
      body = body.replace(`\n  ${field}:`, `\n  ${field}?:`);
    }
    src = src.slice(0, start) + body + src.slice(end);
  }
  return src;
}

function aliasGrpcTypes(src) {
  const pbImport = 'import * as pb from "../../types/pb/a2a.js";';
  if (src.includes(pbImport)) return src;
  const pkgLine = 'export const protobufPackage = "lf.a2a.v1";';
  const pkg = src.indexOf(pkgLine);
  const firstFn = src.indexOf('\nfunction createBase');
  if (pkg < 0 || firstFn < 0) throw new Error(`unexpected layout in ${grpcFile}`);
  const names = [...src.slice(pkg, firstFn).matchAll(/^export (?:interface|enum) (\w+)/gm)].map(
    (m) => m[1]
  );
  const aliases = names.map((n) => `export type ${n} = pb.${n};`).join('\n');
  return `${src.slice(0, pkg)}${pbImport}\n\n${pkgLine}\n\n${aliases}\n${src.slice(firstFn)}`;
}

// Makes the binary codecs treat the fields in (1) as optional: the encoder skips
// them when unset, and the decoder leaves them out unless they are on the wire,
// as the JSON codecs do. A message from a 1.0 peer then decodes to the same
// object over either binding.
function patchOptionalCodecs(src) {
  const section = (startMarker, endMarker, name) => {
    const start = src.indexOf(startMarker);
    if (start < 0) throw new Error(`${name} not found in ${grpcFile}`);
    return [start, src.indexOf(endMarker, start)];
  };
  const edit = ([start, end], fn) => {
    src = src.slice(0, start) + fn(src.slice(start, end)) + src.slice(end);
  };
  for (const [iface, fields] of Object.entries(OPTIONAL_FIELDS)) {
    edit(
      section(`\nfunction createBase${iface}(): ${iface} {\n`, '\n}\n', `createBase${iface}`),
      (body) => {
        for (const field of fields) {
          body = body.replace(new RegExp(`\\s*\\b${field}: (?:\\[\\]|0|""),?`), '');
        }
        return body.replace(/,(\s*)\}/, '$1}');
      }
    );
    edit(
      section(`\nexport const ${iface}: MessageFns<${iface}> = {\n`, '\n};\n', iface),
      (body) => {
        for (const field of fields) {
          const f = `message.${field}`;
          const before = body;
          body = body
            .replace(
              new RegExp(`if \\(${f} !== (0|"")\\)`),
              `if (${f} !== undefined && ${f} !== $1)`
            )
            .replace(`for (const v of ${f}) {`, `for (const v of ${f} ?? []) {`)
            .replace(`${f}.push(`, `(${f} ??= []).push(`);
          if (
            body === before &&
            !body.includes(`${f} !== undefined`) &&
            !body.includes(`${f} ??`)
          ) {
            throw new Error(`no encoder/decoder site for ${iface}.${field}`);
          }
        }
        return body;
      }
    );
  }
  return src;
}

// a2a.proto imports google/api annotations, so buf also emits their codecs, but
// nothing in the SDK uses them.
function removeUnusedOutputs() {
  const pb = path.join(root, 'src/grpc/pb/google');
  fs.rmSync(path.join(pb, 'api'), { recursive: true, force: true });
  fs.rmSync(path.join(pb, 'protobuf/descriptor.ts'), { force: true });
}

fs.writeFileSync(typesFile, markOptional(fs.readFileSync(typesFile, 'utf8')));
if (fs.existsSync(grpcFile)) {
  fs.writeFileSync(
    grpcFile,
    patchOptionalCodecs(aliasGrpcTypes(fs.readFileSync(grpcFile, 'utf8')))
  );
  removeUnusedOutputs();
}

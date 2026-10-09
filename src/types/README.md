# A2A v1.0 Types

This directory holds the protocol message types and their JSON codecs.

Import both from the entry point:

```ts
import { Task, TaskState, Message } from '@a2a-js/sdk';
// internally: src/types/index.js
```

## Layout

| Path            | Maintained by | Contents                                                                             |
| :-------------- | :------------ | :----------------------------------------------------------------------------------- |
| `index.ts`      | hand          | Public entry point. Re-exports `protojson.ts` plus the enums from `pb/a2a.ts`.        |
| `protojson.ts`  | **hand**      | ProtoJSON `fromJSON` / `toJSON` codecs, `MessageFns`, and a re-export of every message type. |
| `pb/a2a.ts`     | **generated** | `DO NOT EDIT`. Message interfaces, the `TaskState` / `Role` enums, `protobufPackage`. |
| `converters/`   | hand          | `from_proto` / `to_proto` oneof (un)wrappers. Legacy; slated for removal.             |

`index.ts` deliberately re-exports the enums by name rather than adding a
second `export *`. Both it and `protojson.ts` export the same 51 message-type
names, so a second star export would make every one of them ambiguous and drop
it from the public API.

## Why the codecs are hand-maintained

`buf.gen.yaml` runs `ts-proto` with `outputJsonMethods=false`, so the generator
emits types only. The codecs live in `protojson.ts` instead, which lets us fix
ProtoJSON conformance bugs without the fix being erased by the next
regeneration.

## Regenerating

```bash
cd src/types
npx buf generate
```

This rewrites `./pb/a2a.ts` only, from the proto pinned in `buf.gen.yaml`.

> [!IMPORTANT]
> `protojson.ts` is **not** regenerated. After any proto change you must update
> it by hand, otherwise a new message ships with no codec and a new field is
> silently dropped on both parse and serialize. Keep the set of `export type`
> re-exports and the set of `MessageFns` implementations in step with the
> `export interface` declarations in `pb/a2a.ts` — currently 51 of each.

## Adding a message type

1. `npx buf generate` to pick up the new interface in `pb/a2a.ts`.
2. In `protojson.ts`, add `export type X = pb.X;` next to the other re-exports.
3. In `protojson.ts`, add `export const X: MessageFns<X>` with `fromJSON` /
   `toJSON`, following the ProtoJSON rules the neighbouring codecs use
   (camelCase and snake_case keys accepted on read, default values omitted on
   write).
4. Nothing to do in `index.ts` — it star-exports `protojson.ts`. Only a new
   *enum* needs adding there by name.

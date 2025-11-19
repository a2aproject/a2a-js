import { compile } from 'json-schema-to-typescript';
import fs from 'fs';
import path from 'path';

const typeSchemaContents = fs.readFileSync(path.join(process.cwd(), 'spec.json'), 'utf8');
const typeSchema = JSON.parse(typeSchemaContents.toString());

compile(typeSchema, 'MySchema', {
  additionalProperties: false,
  enableConstEnums: false,
  unreachableDefinitions: true,
  unknownAny: true,
}).then((ts) => fs.writeFileSync('src/types.ts', ts));

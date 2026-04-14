import type { DataPart, Part } from '../../src/types.js';

const arrayDataPart: DataPart = {
  kind: 'data',
  data: ['foo', { nested: true }, 3],
};

const scalarDataPart: DataPart = {
  kind: 'data',
  data: 7,
};

const arrayPart: Part = arrayDataPart;
const scalarPart: Part = scalarDataPart;

void arrayPart;
void scalarPart;

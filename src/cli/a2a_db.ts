#!/usr/bin/env node
import { run } from './run.js';

run(process.argv.slice(2), process.env)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

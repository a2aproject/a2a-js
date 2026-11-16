#!/usr/bin/env node

/**
 * kysely is an optional peer, and everything the CLI does imports it at the top level.
 * Loading that on demand keeps a missing install reportable.
 */
async function main(): Promise<number> {
  try {
    await import('kysely');
  } catch (error) {
    console.error(
      `a2a-db needs the "kysely" package, which could not be loaded.\n` +
        `${String(error)}\n` +
        `If it is missing: npm install kysely`
    );
    return 1;
  }

  const { run } = await import('./run.js');
  return run(process.argv.slice(2), process.env);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

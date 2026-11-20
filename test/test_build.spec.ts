import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkProfile, classifyExports, PROFILES } from '../scripts/test_build.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const requiredDeps = Object.keys(pkg.dependencies ?? {});

describe('test_build', () => {
  describe('classifyExports', () => {
    it('classifies every package.json export into its expected profile', () => {
      const grouped = classifyExports(pkg.exports);

      expect(grouped.grpc).toEqual([
        './dist/errors/grpc/index.js',
        './dist/server/grpc/index.js',
        './dist/client/transports/grpc/index.js',
        './dist/compat/v0_3/server/grpc/index.js',
        './dist/compat/v0_3/client/transports/grpc/index.js',
      ]);
      expect(grouped.express).toEqual([
        './dist/server/express/index.js',
        './dist/compat/v0_3/server/express/index.js',
      ]);
      expect(grouped.database).toEqual(['./dist/server/database/index.js']);
      expect(grouped['workers-safe']).toEqual([
        './dist/index.js',
        './dist/errors/index.js',
        './dist/server/index.js',
        './dist/client/index.js',
        './dist/plugins/index.js',
        './dist/compat/v0_3/index.js',
        './dist/compat/v0_3/server/index.js',
        './dist/compat/v0_3/client/index.js',
      ]);

      const total = Object.values(grouped).reduce((sum, list) => sum + list.length, 0);
      expect(total).toBe(Object.keys(pkg.exports).length);
    });
  });

  describe('checkProfile', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'a2a-test-build-'));
    });

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeFixture(filename: string, code: string): string {
      const filePath = path.join(tmpDir, filename);
      writeFileSync(filePath, code, 'utf8');
      return filePath;
    }

    function runCheck(profileName: keyof typeof PROFILES, entryPoint: string) {
      const { platform, peers } = PROFILES[profileName];
      return checkProfile({
        name: profileName,
        platform,
        entryPoints: [entryPoint],
        allowedPackages: [...requiredDeps, ...peers],
        distDir: tmpDir,
      });
    }

    it.each([
      ['workers-safe', 'ok-workers.js', "export * from 'jose';\n"],
      [
        'grpc',
        'ok-grpc.js',
        "export * as grpc from '@grpc/grpc-js';\nexport * as wkt from '@bufbuild/protobuf/wkt';\nexport * as crypto from 'node:crypto';\n",
      ],
      [
        'express',
        'ok-express.js',
        "export * as express from 'express';\nexport * as http from 'node:http';\n",
      ],
      ['database', 'ok-database.js', "export * from 'kysely';\n"],
    ] as const)('%s allows declared dependencies (%s)', async (profile, filename, code) => {
      const entry = writeFixture(filename, code);
      await expect(runCheck(profile, entry)).resolves.toBeDefined();
    });

    it.each([
      [
        'workers-safe',
        'bad-workers-express.js',
        "import 'express';\n",
        /Disallowed import "express"/,
      ],
      [
        'workers-safe',
        'bad-workers-grpc.js',
        "import '@grpc/grpc-js';\n",
        /Disallowed import "@grpc\/grpc-js"/,
      ],
      ['workers-safe', 'bad-workers-node.js', "import 'node:fs';\n", /Disallowed import "node:fs"/],
      [
        'grpc',
        'bad-grpc-express.js',
        "import 'express';\n",
        /Disallowed import "express" in "grpc" profile \(allowed: .*, Node built-ins\)/,
      ],
      ['database', 'bad-db-node.js', "import 'node:fs';\n", /Disallowed import "node:fs"/],
      ['database', 'bad-db-express.js', "import 'express';\n", /Disallowed import "express"/],
    ] as const)(
      '%s rejects disallowed import (%s)',
      async (profile, filename, code, expectedError) => {
        const entry = writeFixture(filename, code);
        await expect(runCheck(profile, entry)).rejects.toThrow(expectedError);
      }
    );
  });
});

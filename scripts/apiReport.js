import { mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CompilerState, Extractor, ExtractorConfig } from '@microsoft/api-extractor';

const projectFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFilePath = path.join(projectFolder, 'config', 'api-extractor.json');
const packageJsonPath = path.join(projectFolder, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const localBuild = process.argv.includes('--local');
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--local');

if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
}

const entryPoints = Object.entries(packageJson.exports).map(([subpath, conditions]) => {
  if (
    typeof conditions !== 'object' ||
    conditions === null ||
    !('types' in conditions) ||
    typeof conditions.types !== 'string'
  ) {
    throw new Error(`Package export "${subpath}" does not define a types entry point.`);
  }

  return {
    subpath,
    typesPath: conditions.types,
    reportName: subpath === '.' ? 'sdk' : subpath.replace(/^\.\//, '').replaceAll('/', '-'),
  };
});

const reportNames = entryPoints.map(({ reportName }) => reportName);
if (new Set(reportNames).size !== reportNames.length) {
  throw new Error('Package export paths produced duplicate API report names.');
}

const baseConfig = ExtractorConfig.loadFile(configFilePath);
const extractorConfigs = entryPoints.map(({ typesPath, reportName }) => {
  const configObject = structuredClone(baseConfig);
  configObject.mainEntryPointFilePath = `<projectFolder>/${typesPath.replace(/^\.\//, '')}`;
  configObject.apiReport.reportFileName = reportName;

  return ExtractorConfig.prepare({
    configObject,
    configObjectFullPath: configFilePath,
    packageJsonFullPath: packageJsonPath,
  });
});

const typescriptCompilerFolder = path.join(projectFolder, 'node_modules', 'typescript');
const reportFolder = extractorConfigs[0].reportFolder;
mkdirSync(reportFolder, { recursive: true });
mkdirSync(extractorConfigs[0].reportTempFolder, { recursive: true });

const expectedReportFiles = new Set(reportNames.map((reportName) => `${reportName}.api.md`));
const staleReportFiles = readdirSync(reportFolder).filter(
  (fileName) => fileName.endsWith('.api.md') && !expectedReportFiles.has(fileName)
);

if (localBuild) {
  for (const fileName of staleReportFiles) {
    console.log(`Removing stale API report ${fileName}`);
    unlinkSync(path.join(reportFolder, fileName));
  }
} else if (staleReportFiles.length > 0) {
  console.error(
    `Unexpected API report(s): ${staleReportFiles.join(', ')}. ` +
      'Run npm run api-report:update to remove stale reports.'
  );
}

const compilerState = CompilerState.create(extractorConfigs[0], {
  additionalEntryPoints: extractorConfigs
    .slice(1)
    .map((extractorConfig) => extractorConfig.mainEntryPointFilePath),
  typescriptCompilerFolder,
});

let succeeded = localBuild || staleReportFiles.length === 0;

for (const [index, extractorConfig] of extractorConfigs.entries()) {
  const { subpath } = entryPoints[index];
  console.log(
    `\nChecking public API for ${packageJson.name}${subpath === '.' ? '' : subpath.slice(1)}`
  );

  const result = Extractor.invoke(extractorConfig, {
    compilerState,
    localBuild,
    printApiReportDiff: !localBuild,
  });

  succeeded &&= result.succeeded;
}

if (!succeeded) {
  process.exitCode = 1;
}

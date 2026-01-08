const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2] || 'src/a2a.proto';
const outputDir = process.argv[3] || 'src/generated';

if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const content = fs.readFileSync(inputFile, 'utf8');
const lines = content.split('\n');

const messagesContent = [];
const imports = [];

// Header for both files
const header = [
  'syntax = "proto3";',
  'package a2a.v1;',
  '',
];

let inService = false;
let braceDepth = 0;
let serviceBuffer = [];
let options = [];

for (const line of lines) {
  const trimmed = line.trim();

  // Keep imports
  if (trimmed.startsWith('import ')) {
    imports.push(line);
    continue;
  }

  // Keep package and syntax (handled by header)
  if (trimmed.startsWith('syntax =') || trimmed.startsWith('package ')) {
    continue;
  }

  // Detect Service Start
  if (trimmed.startsWith('service ')) {
    inService = true;
    serviceBuffer.push(line);

    // Strip comments for brace counting
    const noExample = line.replace(/\/\/.*$/, '');
    braceDepth += (noExample.match(/{/g) || []).length;
    braceDepth -= (noExample.match(/}/g) || []).length;
    continue;
  }

  if (inService) {
    serviceBuffer.push(line);

    // Strip comments for brace counting
    const noExample = line.replace(/\/\/.*$/, '');
    braceDepth += (noExample.match(/{/g) || []).length;
    braceDepth -= (noExample.match(/}/g) || []).length;

    if (braceDepth <= 0) {
      inService = false;
      braceDepth = 0; // Reset just in case
    }
  } else {
    // Keep options only if NOT in service (handled by else block actually)
    if (trimmed.startsWith('option ')) {
      options.push(line);
      continue;
    }
    // Everything else (messages, enums, comments) goes to messages file
    messagesContent.push(line);
  }
}

// Construct Messages File
const messagesFileContent = [
  ...header,
  ...imports,
  ...options,
  ...messagesContent
].join('\n');

// Construct Service File
// Service file needs to import the messages file
const serviceFileContent = [
  ...header,
  ...imports,
  ...options,
  'import "a2a_messages.proto";', // Import the sibling messages file
  '',
  ...serviceBuffer
].join('\n');

const messagesPath = path.join(outputDir, 'a2a_messages.proto');
const servicePath = path.join(outputDir, 'a2a_service.proto');

fs.writeFileSync(messagesPath, messagesFileContent);
fs.writeFileSync(servicePath, serviceFileContent);

console.log(`Generated ${messagesPath}`);
console.log(`Generated ${servicePath}`);

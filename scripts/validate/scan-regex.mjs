#!/usr/bin/env node
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';

function parseArgs(argv) {
  const result = { pattern: '', maxFileBytes: 8 * 1024 * 1024, excludeDirs: new Set(), excludePaths: new Set(), paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--pattern') result.pattern = argv[++index] ?? '';
    else if (value === '--max-file-bytes') result.maxFileBytes = Number(argv[++index]);
    else if (value === '--exclude-dir') result.excludeDirs.add(argv[++index] ?? '');
    else if (value === '--exclude-path') result.excludePaths.add(path.normalize(argv[++index] ?? ''));
    else result.paths.push(value);
  }
  if (!result.pattern || result.paths.length === 0 || !Number.isFinite(result.maxFileBytes) || result.maxFileBytes < 1) {
    throw new Error('usage: scan-regex.mjs --pattern REGEX [--exclude-dir NAME] [--exclude-path PATH] PATH...');
  }
  return result;
}

function isExcluded(filePath, options) {
  const normalized = path.normalize(filePath);
  if (options.excludePaths.has(normalized)) return true;
  return normalized.split(path.sep).some(part => options.excludeDirs.has(part));
}

async function* walk(input, options) {
  const stats = await lstat(input);
  if (stats.isSymbolicLink()) return;
  if (stats.isFile()) {
    if (!isExcluded(input, options)) yield input;
    return;
  }
  if (!stats.isDirectory()) return;
  const entries = await readdir(input, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(input, entry.name);
    if (isExcluded(candidate, options) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(candidate, options);
    else if (entry.isFile()) yield candidate;
  }
}

async function scanFile(filePath, regex, maxFileBytes) {
  const stats = await lstat(filePath);
  if (stats.size > maxFileBytes) return false;
  const handle = await open(filePath, 'r');
  let found = false;
  try {
    const sample = Buffer.alloc(Math.min(4096, stats.size));
    if (sample.length > 0) {
      await handle.read(sample, 0, sample.length, 0);
      if (sample.includes(0)) return false;
    }
    const stream = handle.createReadStream({ encoding: 'utf8', autoClose: false, start: 0 });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      regex.lastIndex = 0;
      if (regex.test(line)) {
        console.log(`${filePath}:${lineNumber}:${line}`);
        found = true;
      }
    }
  } finally {
    await handle.close();
  }
  return found;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const regex = new RegExp(options.pattern, 'i');
  let matched = false;
  for (const input of options.paths) {
    for await (const filePath of walk(input, options)) {
      if (await scanFile(filePath, regex, options.maxFileBytes)) matched = true;
    }
  }
  process.exitCode = matched ? 0 : 1;
}

main().catch(error => {
  console.error(`scan error: ${error.message}`);
  process.exitCode = 2;
});

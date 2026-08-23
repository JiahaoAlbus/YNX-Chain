#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(65);
}

if (process.argv.length !== 5) fail('usage: finance-parent-preserving-observer.mjs <central-frozen-contract.json> <bytes> <sha256>');

let contract;
try {
  const path = process.argv[2];
  const expectedBytes = Number(process.argv[3]);
  const expectedSha256 = process.argv[4];
  const stat = lstatSync(path);
  const raw = readFileSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(expectedBytes) || raw.length !== expectedBytes) fail('observer contract identity mismatch');
  if (!/^[0-9a-f]{64}$/.test(expectedSha256) || createHash('sha256').update(raw).digest('hex') !== expectedSha256) fail('observer contract identity mismatch');
  contract = JSON.parse(raw.toString('utf8'));
} catch {
  fail('invalid observer contract');
}

if (contract.schemaVersion !== 'finance-parent-preserving-observer@1') fail('invalid observer schema');
if (!Array.isArray(contract.literalArgv) || contract.literalArgv.length !== 25 || contract.literalArgv.some((value) => typeof value !== 'string')) fail('invalid literal argv');
if (typeof contract.processWorkingDirectory !== 'string' || !contract.processWorkingDirectory.startsWith('/')) fail('invalid working directory');
if (JSON.stringify(contract.environment) !== '{}') fail('observer environment must be empty');
if (contract.shell !== false || contract.stdio !== 'inherit') fail('observer spawn options are not frozen');
if (JSON.stringify(contract.declaredOutputArgvIndexes) !== '[3,4,5]') fail('invalid declared output indexes');

const argvJson = JSON.stringify(contract.literalArgv);
const argvSha256 = createHash('sha256').update(argvJson).digest('hex');
if (argvSha256 !== contract.literalArgvJsonSha256) fail('literal argv identity mismatch');

// The observer deliberately does not inspect, open, create, truncate, redirect,
// or capture any declared output path. The reviewed launcher owns those paths.
const result = spawnSync(contract.literalArgv[0], contract.literalArgv.slice(1), {
  cwd: contract.processWorkingDirectory,
  env: {},
  shell: false,
  stdio: 'inherit'
});

const terminal = {
  observer: 'FINANCE_PARENT_PRESERVING_NODE_SPAWN',
  status: result.status,
  signal: result.signal,
  error: result.error?.code ?? null
};
process.stdout.write(`${JSON.stringify(terminal)}\n`);

if (result.error) process.exit(70);
if (result.status !== null) process.exit(result.status);
const signalExit = { SIGKILL: 137, SIGTERM: 143, SIGINT: 130 }[result.signal];
process.exit(signalExit ?? 70);

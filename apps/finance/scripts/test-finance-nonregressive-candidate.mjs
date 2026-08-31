#!/usr/bin/env node
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preservedFrontend, preservedFrontendSource, validateBuildIdentity, validatePreservedFrontend } from './finance-nonregressive-runtime.mjs';

const source = new URL('../web/', import.meta.url);
validatePreservedFrontend(source.pathname);
for (const name of Object.keys(preservedFrontend)) {
  const root = mkdtempSync(join(tmpdir(), 'finance-regression-'));
  cpSync(source, root, { recursive: true });
  writeFileSync(join(root, name), Buffer.concat([readFileSync(join(root, name)), Buffer.from('\nregression')]));
  assert.throws(() => validatePreservedFrontend(root), /FINANCE_FRONTEND_RESOURCE_REGRESSION/);
  rmSync(root, { recursive: true, force: true });
}
{
  const root = mkdtempSync(join(tmpdir(), 'finance-legacy-'));
  cpSync(source, root, { recursive: true });
  writeFileSync(join(root, 'wallet-connect.js'), 'legacy');
  assert.throws(() => validatePreservedFrontend(root), /FINANCE_LEGACY_WALLET_CONNECT_REINTRODUCED/);
  rmSync(root, { recursive: true, force: true });
}
const identity = { sourceCommit: 'a'.repeat(40), release: 'ynx-finance-test', buildTime: '2026-08-31T00:00:00.000Z', frontendSourceCommit: preservedFrontendSource };
validateBuildIdentity(identity, identity);
for (const key of Object.keys(identity)) assert.throws(() => validateBuildIdentity({ ...identity, [key]: `${identity[key]}-changed` }, identity), new RegExp(`FINANCE_BUILD_IDENTITY_MISMATCH:${key}`));
process.stdout.write('finance non-regressive candidate fixtures: pass\n');

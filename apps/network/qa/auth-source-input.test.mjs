import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {authSourceInput, captureAuthLink} from './auth-source-input.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const supplierPath = 'apps/network/internal/authresourcesource/SUPPLIER.json';
const supplier = JSON.parse(fs.readFileSync(path.join(root, supplierPath)));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const available = process.platform === 'darwin' && fs.existsSync(supplier.handoff.path);

test('Auth25 is explicitly absent without both independent build inputs', () => {
  assert.equal(authSourceInput(root), null);
  assert.throws(() => authSourceInput(root, supplier.handoff.path), /Exact Auth H/);
  assert.throws(() => authSourceInput(root, undefined, supplier.handoff.sha256), /Exact Auth H/);
  assert.throws(() => authSourceInput(root, 'relative/H.json', supplier.handoff.sha256), /Exact Auth H/);
});

test('Auth25 does not fall back to the retained original 19 ABI closure', () => {
  assert.throws(() => authSourceInput(root, supplier.inherited19.handoff.path, supplier.inherited19.handoff.sha256), /Exact Auth H/);
  if (available) assert.throws(() => authSourceInput(root, supplier.inherited19.handoff.path, supplier.handoff.sha256), /pin mismatch/);
});

test('actual pinned C-only Auth25 intake and static capture retain exact bytes', {skip: !available}, () => {
  const input = authSourceInput(root, supplier.handoff.path, supplier.handoff.sha256);
  assert.equal(input.symbols.length, 25);
  assert.deepEqual(input.symbols, supplier.ABI.symbols);
  assert.equal(input.secondGoRuntime, false);
  assert.equal(input.RootAdmission, false);
  assert.equal(input.SourceAdmission, false);
  assert.equal(input.typedSignerSupplied, false);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'auth25-intake-'));
  const captured = captureAuthLink(input, parent);
  for (const [name, pin] of [['libynx_network_resource_source.a', input.archive], ['libcrypto.a', input.cryptoArchive]]) {
    const output = path.join(captured.directory, name);
    const raw = fs.readFileSync(output);
    assert.equal(raw.length, pin.bytes);
    assert.equal(hash(raw), pin.sha256);
    assert.equal(fs.statSync(output).mode & 0o777, 0o400);
    fs.unlinkSync(output); // Only this test's exact known captures are removed.
  }
  assert.equal(captured.env.CGO_ENABLED, '1');
  assert.equal(captured.env.GOOS, 'darwin');
  assert.equal(captured.env.GOARCH, 'arm64');
  fs.rmdirSync(captured.directory);
  fs.rmdirSync(parent);
});

test('vendored private review header drift fails before a link is offered', {skip: !available}, () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'auth25-header-'));
  const files = [];
  for (const entry of supplier.vendored) {
    const output = path.join(copy, entry.path);
    fs.mkdirSync(path.dirname(output), {recursive: true, mode: 0o700});
    fs.copyFileSync(path.join(root, entry.path), output, fs.constants.COPYFILE_EXCL);
    files.push(output);
  }
  fs.writeFileSync(path.join(copy, supplierPath), JSON.stringify(supplier));
  files.push(path.join(copy, supplierPath));
  const header = path.join(copy, 'apps/network/internal/authresourcesource/source/network_review_private.h');
  fs.appendFileSync(header, '\n/* controlled drift negative; no original file changed */\n');
  assert.throws(() => authSourceInput(copy, supplier.handoff.path, supplier.handoff.sha256), /pin mismatch/);
  for (const file of files) fs.unlinkSync(file);
  for (const directory of ['apps/network/internal/authresourcesource/source', 'apps/network/internal/authresourcesource', 'apps/network/internal', 'apps/network', 'apps']) fs.rmdirSync(path.join(copy, directory));
  fs.rmdirSync(copy);
});

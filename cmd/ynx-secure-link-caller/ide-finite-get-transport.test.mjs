// PUBLIC transport controls only: no genuine Auth/DEVICE, installed Native,
// Source admission or second Go runtime. No old crypto/Native suite is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, chmod, lstat, realpath, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(source, '../..');
const bridge = path.join(repository, 'internal/securelink/native');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = [
  'seven-exact-get-targets-original-body-and-real-pq',
  'wrong-spki-and-certificate-digest-refused-before-http-write',
  'native-source-before-write-refusal-and-late-original-response',
  'partial-timeout-and-abort-unknown-without-replay',
  'packet-worker-socket-source-debt-and-physical-join',
  'close-progress-does-not-invent-first-cause',
];

test('finite7 GET original native PQ transport and held PUBLIC custody', {timeout: 150000}, async t => {
  assert.ok(['darwin', 'linux'].includes(process.platform), 'actual Darwin/Linux OS required; no skip or substitute');
  const root = process.env.YNX_LINK_IDE_FINITE_GET_TEST_ARTIFACTS;
  assert.ok(root && path.isAbsolute(root) && path.resolve(root) === root, 'explicit normalized absolute YNX_LINK_IDE_FINITE_GET_TEST_ARTIFACTS required');
  await mkdir(root, {recursive: true, mode: 0o700});
  const parent = await realpath(root), info = await lstat(root);
  assert.ok(parent === root && info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && !(info.mode & 0o022), 'owned, non-shared artifact root required');
  const owned = await mkdtemp(path.join(parent, 'fg-'));await chmod(owned, 0o700);
  t.diagnostic('Original finite7 transport inputs, generated PUBLIC certificates and first cause: ' + owned);
  const record = {version: 1, owned, status: 'STARTED', commands: [], sourceBefore: [], sourceAfter: [],
    actualPQ: false, originalCBridgeCompiles: 0, noGoArchive: true, publicTransportControls: true,
    actualAuthFence: false, RootAdmission: false, SourceAdmission: false, installed: false};
  let firstError;
  const pins = [
    ...['ide-finite-get-transport.hpp', 'ide-finite-get-transport.cpp', 'ide-finite-get-wire.hpp',
      'ide-finite-get-wire.cpp', 'ide-finite-get-wire.test.cpp', 'ide-finite-get-transport.test.cpp', 'ide-finite-get-transport.test.mjs'].map(leaf => path.join(source, leaf)),
    path.join(bridge, 'bridge.h'), path.join(bridge, 'bridge.c'),
  ];
  async function run(label, command, args, timeout = 15000) {
    const result = spawnSync(command, args, {cwd: repository,
      env: {...process.env, TMPDIR: owned}, encoding: 'utf8', timeout, maxBuffer: 2 << 20});
    const prefix = path.join(owned, `${String(record.commands.length + 1).padStart(2, '0')}-${label}`);
    for (const [suffix, text] of [['stdout', result.stdout ?? ''], ['stderr', result.stderr ?? '']])
      await writeFile(prefix + '.' + suffix, text, {flag: 'wx', mode: 0o600});
    const row = {label, command, args, timeoutMs: timeout, status: result.status, signal: result.signal,
      error: result.error ? {code: result.error.code, message: result.error.message} : null,
      stdout: prefix + '.stdout', stderr: prefix + '.stderr'};
    record.commands.push(row);
    await writeFile(prefix + '.json', JSON.stringify(row, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    assert.equal(result.error, undefined, `${label}: process error; retained ${prefix}`);
    assert.equal(result.status, 0, `${label}: original first cause retained ${prefix}\n${result.stderr}\n${result.stdout}`);
    return result;
  }
  try {
    for (const file of pins) { const bytes = await readFile(file);record.sourceBefore.push({path: file, bytes: bytes.length, sha256: sha(bytes)}); }
    await writeFile(path.join(owned, 'SOURCE-BEFORE.json'), JSON.stringify(record.sourceBefore, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    const pure = path.join(owned, 'finite7-wire-controls');
    await run('compile-pure-finite7-wire', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic',
      '-DYNX_IDE_FINITE_GET_PUBLIC_TEST', path.join(source, 'ide-finite-get-wire.cpp'), path.join(source, 'ide-finite-get-wire.test.cpp'), '-o', pure], 20000);
    const pureOutput = JSON.parse((await run('pure-finite7-wire-controls', pure, [])).stdout);
    assert.equal(pureOutput.status, 'PASS');assert.equal(pureOutput.groups, 7);
    assert.ok(Number.isSafeInteger(pureOutput.pureWireControls) && pureOutput.pureWireControls > 0);
    assert.equal(pureOutput.networkOrCryptoExecuted, false);assert.equal(pureOutput.RootAdmission, false);assert.equal(pureOutput.SourceAdmission, false);
    const pureBytes = await readFile(pure);record.pureWire = {output: pureOutput, binary: {path: pure, bytes: pureBytes.length, sha256: sha(pureBytes)}};
    assert.equal((await run('pkg-version', 'pkg-config', ['--modversion', 'openssl'])).stdout.trim(), '3.6.4', 'only actual OpenSSL 3.6.4 is supported');
    const prefix = (await run('pkg-prefix', 'pkg-config', ['--variable=prefix', 'openssl'])).stdout.trim();
    assert.ok(path.isAbsolute(prefix), 'OpenSSL pkg-config prefix must be absolute');
    const openssl = path.join(prefix, 'bin/openssl');
    assert.match((await run('openssl-version', openssl, ['version'])).stdout, /^OpenSSL 3\.6\.4 /);
    const splitFlags = text => {
      const flags = text.trim().split(/\s+/).filter(Boolean);
      assert.ok(flags.every(flag => flag.startsWith('-') && /^[-A-Za-z0-9_./+=,:@]+$/.test(flag)), 'unexpected pkg-config token; no shell parsing');
      return flags;
    };
    const cflags = splitFlags((await run('pkg-cflags', 'pkg-config', ['--cflags', 'openssl'])).stdout);
    const libs = splitFlags((await run('pkg-libs', 'pkg-config', ['--libs', 'openssl'])).stdout);
    record.openssl = {prefix, executable: openssl, cflags, libs};
    const certs = path.join(owned, 'public-certificates');await mkdir(certs, {mode: 0o700});
    const cert = name => path.join(certs, name);
    await run('public-root-key', openssl, ['genpkey', '-algorithm', 'ML-DSA-87', '-out', cert('root.key')]);
    await chmod(cert('root.key'), 0o600);
    await run('public-root-certificate', openssl, ['req', '-new', '-x509', '-key', cert('root.key'), '-subj', '/CN=PUBLIC-finite7-only', '-days', '1',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', cert('root.pem')]);
    await chmod(cert('root.pem'), 0o600);
    for (const [name, san, eku, serial] of [['server', 'localhost', 'serverAuth', '1'], ['client', 'wallet.ynx.test', 'clientAuth', '2']]) {
      await run(name + '-key', openssl, ['genpkey', '-algorithm', 'ML-DSA-87', '-out', cert(name + '.key')]);
      await chmod(cert(name + '.key'), 0o600);
      await run(name + '-csr', openssl, ['req', '-new', '-key', cert(name + '.key'), '-subj', '/CN=ignored', '-out', cert(name + '.csr')]);
      await writeFile(cert(name + '.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${eku}\nsubjectAltName=DNS:${san}\n`, {flag: 'wx', mode: 0o600});
      await run(name + '-certificate', openssl, ['x509', '-req', '-in', cert(name + '.csr'), '-CA', cert('root.pem'), '-CAkey', cert('root.key'),
        '-set_serial', serial, '-days', '1', '-extfile', cert(name + '.ext'), '-out', cert(name + '.pem')]);
      await chmod(cert(name + '.pem'), 0o600);
    }
    await run('server-public-key', openssl, ['x509', '-in', cert('server.pem'), '-pubkey', '-noout', '-out', cert('server-public.pem')]);
    await run('server-spki', openssl, ['pkey', '-pubin', '-in', cert('server-public.pem'), '-outform', 'DER', '-out', cert('server.spki.der')]);
    await run('server-certificate-der', openssl, ['x509', '-in', cert('server.pem'), '-outform', 'DER', '-out', cert('server.cert.der')]);
    await run('root-certificate-der', openssl, ['x509', '-in', cert('root.pem'), '-outform', 'DER', '-out', cert('root.cert.der')]);
    await run('client-certificate-der', openssl, ['x509', '-in', cert('client.pem'), '-outform', 'DER', '-out', cert('client.cert.der')]);
    const object = path.join(owned, 'original-pq-bridge.o');
    await run('compile-original-pq-c-bridge-once', 'clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic', ...cflags,
      '-I', bridge, '-c', path.join(bridge, 'bridge.c'), '-o', object], 30000);
    record.originalCBridgeCompiles = 1;
    const binary = path.join(owned, 'finite7-native-controls');
    await run('compile-finite7-native', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-pthread',
      '-DYNX_LINK_IDE_FINITE_GET_PUBLIC_CONTROLS', ...cflags, '-I', source, '-I', bridge,
      ...['ide-finite-get-transport.cpp', 'ide-finite-get-wire.cpp', 'ide-finite-get-transport.test.cpp'].map(leaf => path.join(source, leaf)),
      object, ...libs, '-o', binary], 45000);
    for (const [name, file] of [['native', binary], ['originalCBridge', object]]) {
      const bytes = await readFile(file);record[name] = {path: file, bytes: bytes.length, sha256: sha(bytes)};
    }
    const output = await run('real-pq-loopback-controls', binary, [certs], 45000);
    const rows = output.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(rows.filter(row => row.control).map(row => row.control), expected);
    assert.ok(rows.filter(row => row.control).every(row => row.passed === true));
    assert.equal(rows.at(-1).controls, expected.length);
    assert.equal(rows.at(-1).summary, true);
    assert.equal(rows.at(-1).fullModule, true, 'CI must execute the complete new module, never a targeted retry selector');
    assert.equal(rows.at(-1).actualPQ, true);
    assert.equal(rows.at(-1).actualAuthFence, false);
    assert.equal(rows.at(-1).RootAdmission, false);
    assert.equal(rows.at(-1).SourceAdmission, false);
    record.controls = rows;record.actualPQ = true;
  } catch (error) { firstError = error;record.firstCause = {name: error.name, message: error.message}; }
  finally {
    for (const before of record.sourceBefore) {
      try { const bytes = await readFile(before.path);record.sourceAfter.push({path: before.path, bytes: bytes.length, sha256: sha(bytes)}); }
      catch (error) { record.sourceAfter.push({path: before.path, error: error.message}); }
    }
    record.sourceUnchanged = record.sourceBefore.length === pins.length && record.sourceBefore.every((before, i) => JSON.stringify(before) === JSON.stringify(record.sourceAfter[i]));
    if (!record.sourceUnchanged && !firstError) { firstError = Error('source changed during finite7 controls');record.firstCause = {message: firstError.message}; }
    record.status = firstError ? 'RED_OR_UNKNOWN' : 'PUBLIC_REAL_PQ_TRANSPORT_PASS';
    await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  if (firstError) throw firstError;
});

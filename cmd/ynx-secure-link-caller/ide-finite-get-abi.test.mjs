// Actual Mother/CABI/PQ delta; four Origin methods are explicitly PUBLIC seams.
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
  'actual-mother-loan-cabi-pq-get-crosspacket-and-debt',
  'null-foreign-handles-adopt-partial-before-status',
  'actual-mother-post-publication-claim-failure-and-once-only-drain',
  'actor-source-current-and-partial-firstcause-abort-physical-drain',
];

test('finite7 actual Auth Mother, CABI and original FD/PQ delta', {timeout: 150000}, async t => {
  assert.ok(['darwin', 'linux'].includes(process.platform), 'actual Darwin/Linux required');
  const root = process.env.YNX_LINK_IDE_FINITE_GET_ABI_TEST_ARTIFACTS;
  assert.ok(root && path.isAbsolute(root) && path.resolve(root) === root, 'explicit absolute ABI_TEST_ARTIFACTS required');
  await mkdir(root, {recursive: true, mode: 0o700});
  const info = await lstat(root);
  assert.ok(await realpath(root) === root && info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && !(info.mode & 0o022), 'owned nonshared artifact root required');
  const owned = await mkdtemp(path.join(root, 'abi-'));await chmod(owned, 0o700);
  const temporary = path.join(owned, 'tmp');await mkdir(temporary, {mode: 0o700});
  t.diagnostic('Actual ABI delta and first cause: ' + owned);
  const record = {version: 1, owned, status: 'STARTED', commands: [], sourceBefore: [], sourceAfter: [],
    actualPQ: false, actualAuthMotherBody: true, publicOriginMethods: true, normalOriginMethodsImplemented: false,
    oldTransportControlsExecuted: 0, pureWireControlsExecuted: 0, oldGoControlsExecuted: 0,
    originalCBridgeCompiles: 0, RootAdmission: false, SourceAdmission: false, installed: false};
  const pins = [...['ide-finite-get-abi.test.cpp', 'ide-finite-get-abi.test.mjs', 'ide-finite-get-abi.cpp', 'ide_finite_get_transport_v1.h',
    'ide-finite-get-transport.hpp', 'ide-finite-get-transport.cpp', 'ide-finite-get-wire.hpp', 'ide-finite-get-wire.cpp',
    'ide-finite-get-transport.test.cpp'].map(leaf => path.join(source, leaf)), path.join(bridge, 'bridge.h'), path.join(bridge, 'bridge.c')];
  let firstError;
  async function run(label, command, args, timeout = 15000) {
    const result = spawnSync(command, args, {cwd: repository, env: {...process.env, TMPDIR: temporary, GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB'},
      encoding: 'utf8', timeout, maxBuffer: 2 << 20});
    const prefix = path.join(owned, `${String(record.commands.length + 1).padStart(2, '0')}-${label}`);
    for (const [suffix, text] of [['stdout', result.stdout ?? ''], ['stderr', result.stderr ?? '']])
      await writeFile(prefix + '.' + suffix, text, {flag: 'wx', mode: 0o600});
    const row = {label, command, args, timeoutMs: timeout, status: result.status, signal: result.signal,
      error: result.error ? {code: result.error.code, message: result.error.message} : null, stdout: prefix + '.stdout', stderr: prefix + '.stderr'};
    record.commands.push(row);await writeFile(prefix + '.json', JSON.stringify(row, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    assert.equal(result.error, undefined, `${label}: process error retained ${prefix}`);
    assert.equal(result.status, 0, `${label}: original first cause retained ${prefix}\n${result.stderr}\n${result.stdout}`);return result;
  }
  try {
    const inputPath = process.env.YNX_LINK_IDE_FINITE_GET_ABI_INPUTS;
    const inputBytes = process.env.YNX_LINK_IDE_FINITE_GET_ABI_INPUTS_BYTES;
    const inputSHA = process.env.YNX_LINK_IDE_FINITE_GET_ABI_INPUTS_SHA256;
    assert.ok(inputPath && path.isAbsolute(inputPath) && path.resolve(inputPath) === inputPath, 'explicit absolute ABI_INPUTS required');
    assert.match(inputBytes ?? '', /^[1-9][0-9]{0,7}$/);assert.match(inputSHA ?? '', /^[0-9a-f]{64}$/);
    const raw = await readFile(inputPath);assert.ok(raw.length <= 65536);assert.equal(raw.length, Number(inputBytes));assert.equal(sha(raw), inputSHA);
    const inputs = JSON.parse(raw.toString('utf8'));
    assert.deepEqual(Object.keys(inputs).sort(), ['authSources', 'version']);assert.equal(inputs.version, 1);
    assert.ok(Array.isArray(inputs.authSources) && inputs.authSources.length === 3, 'exact three actual Auth source pins required');
    assert.deepEqual(inputs.authSources.map(pin => path.basename(pin.path ?? '')).sort(),
      ['ide_finite_get_auth_mother.cpp', 'ide_finite_get_auth_mother_internal.hpp', 'ide_finite_get_auth_mother_v1.h']);
    let authDir;
    for (const pin of inputs.authSources) {
      assert.deepEqual(Object.keys(pin).sort(), ['bytes', 'path', 'sha256']);
      assert.ok(path.isAbsolute(pin.path) && path.resolve(pin.path) === pin.path && await realpath(pin.path) === pin.path);
      assert.ok(Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && pin.bytes <= 1048576);assert.match(pin.sha256, /^[0-9a-f]{64}$/);
      authDir ??= path.dirname(pin.path);assert.equal(path.dirname(pin.path), authDir, 'actual Auth sources must share one frozen include directory');
      const bytes = await readFile(pin.path);assert.equal(bytes.length, pin.bytes);assert.equal(sha(bytes), pin.sha256);pins.push(pin.path);
    }
    pins.push(inputPath);record.inputs = {path: inputPath, bytes: raw.length, sha256: sha(raw), authSources: inputs.authSources};
    for (const file of pins) { const bytes = await readFile(file);record.sourceBefore.push({path: file, bytes: bytes.length, sha256: sha(bytes)}); }
    await writeFile(path.join(owned, 'SOURCE-BEFORE.json'), JSON.stringify(record.sourceBefore, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    assert.equal((await run('pkg-version', 'pkg-config', ['--modversion', 'openssl'])).stdout.trim(), '3.6.4');
    const prefix = (await run('pkg-prefix', 'pkg-config', ['--variable=prefix', 'openssl'])).stdout.trim();assert.ok(path.isAbsolute(prefix));
    const openssl = path.join(prefix, 'bin/openssl');assert.match((await run('openssl-version', openssl, ['version'])).stdout, /^OpenSSL 3\.6\.4 /);
    const splitFlags = text => {
      const flags = text.trim().split(/\s+/).filter(Boolean);
      assert.ok(flags.every(flag => flag.startsWith('-') && /^[-A-Za-z0-9_./+=,:@]+$/.test(flag)), 'unexpected pkg-config token');return flags;
    };
    const cflags = splitFlags((await run('pkg-cflags', 'pkg-config', ['--cflags', 'openssl'])).stdout);
    const libs = splitFlags((await run('pkg-libs', 'pkg-config', ['--libs', 'openssl'])).stdout);record.openssl = {prefix, executable: openssl, cflags, libs};
    // Never read/hash key files. Commands and public certificates are evidence;
    // this entire subdirectory is excluded by the public CI collector.
    const certs = path.join(owned, 'private-certificates');await mkdir(certs, {mode: 0o700});const cert = leaf => path.join(certs, leaf);
    await run('public-root-key', openssl, ['genpkey', '-algorithm', 'ML-DSA-87', '-out', cert('root.key')]);await chmod(cert('root.key'), 0o600);
    await run('public-root-certificate', openssl, ['req', '-new', '-x509', '-key', cert('root.key'), '-subj', '/CN=PUBLIC-finite7-ABI-only', '-days', '1',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', cert('root.pem')]);
    for (const [name, san, eku, serial] of [['server', 'localhost', 'serverAuth', '1'], ['client', 'wallet.ynx.test', 'clientAuth', '2']]) {
      await run(name + '-key', openssl, ['genpkey', '-algorithm', 'ML-DSA-87', '-out', cert(name + '.key')]);await chmod(cert(name + '.key'), 0o600);
      await run(name + '-csr', openssl, ['req', '-new', '-key', cert(name + '.key'), '-subj', '/CN=ignored', '-out', cert(name + '.csr')]);
      await writeFile(cert(name + '.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${eku}\nsubjectAltName=DNS:${san}\n`, {flag: 'wx', mode: 0o600});
      await run(name + '-certificate', openssl, ['x509', '-req', '-in', cert(name + '.csr'), '-CA', cert('root.pem'), '-CAkey', cert('root.key'), '-set_serial', serial,
        '-days', '1', '-extfile', cert(name + '.ext'), '-out', cert(name + '.pem')]);
    }
    await run('server-public-key', openssl, ['x509', '-in', cert('server.pem'), '-pubkey', '-noout', '-out', cert('server-public.pem')]);
    await run('server-spki', openssl, ['pkey', '-pubin', '-in', cert('server-public.pem'), '-outform', 'DER', '-out', cert('server.spki.der')]);
    for (const name of ['server', 'root', 'client']) await run(name + '-certificate-der', openssl, ['x509', '-in', cert(name + '.pem'), '-outform', 'DER', '-out', cert(name + '.cert.der')]);
    const object = path.join(owned, 'original-pq-bridge.o');
    await run('compile-original-pq-c-bridge-once', 'clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic', ...cflags, '-I', bridge,
      '-c', path.join(bridge, 'bridge.c'), '-o', object], 30000);record.originalCBridgeCompiles = 1;
    const binary = path.join(owned, 'finite7-abi-controls');
    await run('compile-actual-mother-cabi-delta', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-pthread',
      '-DYNX_LINK_IDE_FINITE_GET_PUBLIC_CONTROLS', '-DYNX_LINK_IDE_FINITE_GET_ABI_PUBLIC_CONTROLS', ...cflags, '-I', authDir, '-I', source, '-I', bridge,
      path.join(authDir, 'ide_finite_get_auth_mother.cpp'), ...['ide-finite-get-abi.cpp', 'ide-finite-get-transport.cpp', 'ide-finite-get-wire.cpp', 'ide-finite-get-abi.test.cpp'].map(leaf => path.join(source, leaf)),
      object, ...libs, '-o', binary], 45000);
    for (const [name, file] of [['native', binary], ['originalCBridge', object]]) { const bytes = await readFile(file);record[name] = {path: file, bytes: bytes.length, sha256: sha(bytes)}; }
    const output = await run('actual-mother-cabi-pq-delta', binary, [certs], 45000);
    const rows = output.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(rows.filter(row => row.control).map(row => row.control), expected);assert.ok(rows.filter(row => row.control).every(row => row.passed === true));
    const summary = rows.at(-1);assert.equal(summary.summary, true);assert.equal(summary.controls, 4);assert.equal(summary.actualPQ, true);
    assert.equal(summary.actualAuthMotherBody, true);assert.equal(summary.normalOriginMethodsImplemented, false);assert.equal(summary.oldTransportControlsExecuted, 0);
    assert.equal(summary.RootAdmission, false);assert.equal(summary.SourceAdmission, false);record.controls = rows;record.actualPQ = true;
  } catch (error) { firstError = error;record.firstCause = {name: error.name, message: error.message}; }
  finally {
    for (const before of record.sourceBefore) {
      try { const bytes = await readFile(before.path);record.sourceAfter.push({path: before.path, bytes: bytes.length, sha256: sha(bytes)}); }
      catch (error) { record.sourceAfter.push({path: before.path, error: error.message}); }
    }
    record.sourceUnchanged = record.sourceBefore.length === pins.length && record.sourceBefore.every((before, i) => JSON.stringify(before) === JSON.stringify(record.sourceAfter[i]));
    if (!record.sourceUnchanged && !firstError) { firstError = Error('source changed during ABI delta');record.firstCause = {message: firstError.message}; }
    record.status = firstError ? 'RED_OR_UNKNOWN' : 'PUBLIC_ORIGINS_ACTUAL_AUTH_MOTHER_CABI_PQ_PASS';
    await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  if (firstError) throw firstError;
});

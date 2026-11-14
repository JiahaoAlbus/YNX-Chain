import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, writeFile, lstat, link, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareAcceptanceInputs } from '../acceptance-kit/prepare-inputs.mjs';
const execute = promisify(execFile);

function fixtureManifest() {
  const prefix = '/ynx-route-probe/input-fixture/';
  return { schema: 'P05_PUBLIC_NONCE_FIXTURE_V1', runID: 'input-fixture', origins: ['https://one.leak.test', 'https://two.leak.test'],
    paths: { proof: prefix + 'proof', download: prefix + 'download', wss: prefix + 'wss' }, expectedSHA256: { proof: 'a'.repeat(64) }, publicFixture: { nonce: 'input-fixture' },
    acceptance: { schema: 'P05_INFLIGHT_ACCEPTANCE_FLOWS_V1', paths: Object.fromEntries(['streamDownload', 'longWss', 'sameOriginRedirect', 'crossOriginRedirect', 'downgradeRedirect'].map(value => [value, prefix + value])), wss: { contentNonce: 'a'.repeat(32) } } };
}

test('launch generation materializes only private explicit open and empty event input, with no route permission', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ynx-native-launch-')));
  try {
    const manifest = fixtureManifest();
    const source = join(directory, 'format-only.json'); await writeFile(source, JSON.stringify(manifest));
    const receipt = await prepareAcceptanceInputs({ manifestPath: source, outputDirectory: join(directory, 'private-run'), stun4Port: 45678, stun6Port: 45679, mode: 'tor' });
    const launch = JSON.parse(await readFile(receipt.launchFile, 'utf8')), command = JSON.parse(await readFile(receipt.commandFile, 'utf8'));
    assert.equal(launch.mode, 'tor'); assert.equal(launch.manifestSHA256, receipt.expectedManifestSHA256); assert.equal(launch.bootstrapSHA256, receipt.expectedBootstrapSHA256);
    assert.equal(command.sequence, 1); assert.equal(command.operation, 'open'); assert.equal(command.runID, manifest.runID);
    assert.equal((await readFile(receipt.eventFile)).length, 0); assert.equal(receipt.productionRouteAdmission, false);
    for (const path of [receipt.launchFile, receipt.commandFile, receipt.eventFile]) assert.equal((await lstat(path)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(directory, 'private-run'))).mode & 0o777, 0o700);
    assert.equal(receipt.actualSignedRouteExecution, 'NOT_RUN'); assert.equal(receipt.fixtureTrustedTLS, 'NOT_VERIFIED_BY_INPUT_PREPARATION');
  } finally { await rm(directory, { recursive: true }); }
});

test('protected launch input bounds reject named pipes and manifests that Native cannot consume', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ynx-native-launch-bounds-')));
  t.after(() => rm(directory, { recursive: true }));
  const source = join(directory, 'manifest.json');
  const output = name => join(directory, name);
  const prepare = (manifestPath, name) => prepareAcceptanceInputs({ manifestPath, outputDirectory: output(name), stun4Port: 45678, stun6Port: 45679, mode: 'tor' });
  const noOutput = name => assert.rejects(lstat(output(name)), { code: 'ENOENT' });
  await t.test('no-writer FIFO refuses promptly without staging', async () => {
    const fifo = join(directory, 'no-writer.fifo');
    await execute('mkfifo', ['-m', '600', fifo], { timeout: 1000 });
    const cli = fileURLToPath(new URL('../acceptance-kit/prepare-inputs.mjs', import.meta.url));
    await assert.rejects(execute(process.execPath, [cli, fifo, output('fifo'), '45678', '45679', 'tor'], { timeout: 1000 }),
      error => !error.killed && error.code === 1 && /regular fixture manifest/.test(error.stderr));
    await noOutput('fifo');
  });
  await t.test('oversized raw bytes reject before staging', async () => {
    await writeFile(source, JSON.stringify({ ...fixtureManifest(), pad: 'x'.repeat(65536) }));
    await assert.rejects(prepare(source, 'raw-size'), /regular fixture manifest/);
    await noOutput('raw-size');
  });
  await t.test('serialization growth from a valid-size source rejects before staging', async () => {
    const input = { ...fixtureManifest(), pad: '' };
    input.pad = 'x'.repeat(65536 - Buffer.byteLength(JSON.stringify(input)));
    await writeFile(source, JSON.stringify(input));
    assert.equal((await lstat(source)).size, 65536);
    await assert.rejects(prepare(source, 'serialized-size'), /Native input byte limit/);
    await noOutput('serialized-size');
  });
  await t.test('symbolic and hard-link operands are refused without staging', async () => {
    await writeFile(source, JSON.stringify(fixtureManifest()));
    await symlink(source, join(directory, 'alias.json'));
    await assert.rejects(prepare(join(directory, 'alias.json'), 'symlink'), /regular fixture manifest/);
    await noOutput('symlink');
    await link(source, join(directory, 'second-link.json'));
    await assert.rejects(prepare(source, 'hardlink'), /regular fixture manifest/);
    await noOutput('hardlink');
  });
});

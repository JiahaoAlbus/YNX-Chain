import { constants } from 'node:fs';
import { lstat, open, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildInFlightAcceptanceBootstrap } from './bootstrap.mjs';

const maximumManifestBytes = 65536, maximumBootstrapBytes = 131072;

async function readFixtureManifest(path) {
  const invalid = () => Error('Expected one bounded owner-held regular fixture manifest');
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => { throw invalid(); });
  try {
    const valid = value => value.isFile() && value.uid === BigInt(process.getuid()) && value.nlink === 1n &&
      value.size > 0n && value.size <= BigInt(maximumManifestBytes);
    const before = await fd.stat({ bigint: true });
    if (!valid(before)) throw invalid();
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await fd.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw invalid();
      offset += bytesRead;
    }
    const current = await lstat(path, { bigint: true });
    const after = await fd.stat({ bigint: true });
    if (![current, after].every(value => valid(value) && value.dev === before.dev && value.ino === before.ino &&
      value.size === before.size && value.mtimeNs === before.mtimeNs && value.ctimeNs === before.ctimeNs)) throw invalid();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await fd.close(); }
}

// Materializes generated input files only. No process, listener, tunnel, DNS, TLS trust or GUI.
export async function prepareAcceptanceInputs({ manifestPath, outputDirectory, stun4Port, stun6Port, mode }) {
  if (!manifestPath?.startsWith('/') || !outputDirectory?.startsWith('/')) throw new Error('Explicit existing fixture manifest and fresh absolute output required');
  if (mode !== undefined && !['tor', 'nym'].includes(mode)) throw new Error('Exact test-only route mode required');
  const input = await readFixtureManifest(manifestPath);
  const built = buildInFlightAcceptanceBootstrap(input, { stun4: { host: '127.0.0.1', port: stun4Port }, stun6: { host: '::1', port: stun6Port } });
  if (mode !== undefined) input.trialScope = { schema: 'P05_STRICT_SYNTHETIC_SCOPE_V1', bootstrapSHA256: createHash('sha256').update(Buffer.from(built.html)).digest('hex'), ownedSTUN: [{ host: '127.0.0.1', port: stun4Port }, { host: '::1', port: stun6Port }] };
  const manifest = Buffer.from(JSON.stringify(input, null, 2) + '\n'), bootstrap = Buffer.from(built.html);
  if (manifest.length > maximumManifestBytes || bootstrap.length > maximumBootstrapBytes) throw Error('Prepared manifest or bootstrap exceeds Native input byte limit');
  await mkdir(outputDirectory, { mode: 0o700 });
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifestURL = join(outputDirectory, 'manifest.json'), bootstrapURL = join(outputDirectory, 'bootstrap.html');
  await writeFile(manifestURL, manifest, { mode: 0o600, flag: 'wx' }); await writeFile(bootstrapURL, bootstrap, { mode: 0o600, flag: 'wx' });
  const receipt = { schema: 'P05_PROTECTED_ACCEPTANCE_INPUTS_V1', runID: input.runID, manifestURL, expectedManifestSHA256: sha(manifest), bootstrapURL, expectedBootstrapSHA256: sha(bootstrap), requiredConsumer: 'YNX_PRIVACY_ACCEPTANCE build / actual BrowserRouteProtection + RoutedBrowserPage', actualSignedRouteExecution: 'NOT_RUN', fixtureTrustedTLS: 'NOT_VERIFIED_BY_INPUT_PREPARATION', productionRouteAdmission: false, createsNoNetworkOrProcess: true };
  if (mode !== undefined) {
    const command = join(outputDirectory, 'command.json'), eventFile = join(outputDirectory, 'native-events.jsonl'), launchFile = join(outputDirectory, 'launch.json');
    await writeFile(command, JSON.stringify({ schema: 'P05_PROTECTED_ACCEPTANCE_COMMAND_V1', runID: input.runID, sequence: 1, operation: 'open' }) + '\n', { mode: 0o600, flag: 'wx' });
    await writeFile(eventFile, '', { mode: 0o600, flag: 'wx' });
    await writeFile(launchFile, JSON.stringify({ schema: 'P05_PROTECTED_ACCEPTANCE_LAUNCH_V1', mode, manifest: manifestURL,
      manifestSHA256: sha(manifest), bootstrap: bootstrapURL, bootstrapSHA256: sha(bootstrap), command, timeoutSeconds: 600 }) + '\n', { mode: 0o600, flag: 'wx' });
    Object.assign(receipt, { mode, launchFile, commandFile: command, eventFile, initialExplicitOperation: 'open', normalAdmissionUnchanged: true });
  }
  await writeFile(join(outputDirectory, 'acceptance-inputs.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestPath, outputDirectory, stun4, stun6, mode] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(await prepareAcceptanceInputs({ manifestPath, outputDirectory, stun4Port: Number(stun4), stun6Port: Number(stun6), mode })) + '\n');
}

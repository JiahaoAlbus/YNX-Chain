import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

// One reviewed implementation is consumed by Native and by the extension build. A copied
// client drifting independently would invalidate the XPC/lease verification evidence.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../native/RouteProtectionSources.json', import.meta.url)));
const directory = resolve(root, manifest.sourceDirectory);
if (!directory.startsWith(resolve(root, 'apps/browser/privacy-routing/') + sep)) throw Error('Unexpected protection source directory');
const required = ['ControlProtocol.swift', 'ProtectionLease.swift', 'RoutedIsolationClient.swift', 'OwnedBackendAuditReader.swift', 'RootPreparationClient.swift', 'OwnedBackendStartGate.swift', 'RootClosureObserver.swift', 'SyntheticCanaryProtocol.swift', 'SyntheticTrialAuthority.swift', 'SyntheticProofProtocol.swift', 'SyntheticProofAuthority.swift', 'RoutedNormalProofProtocol.swift', 'RoutedNormalProofAuthority.swift', 'NormalCaptureProtocol.swift', 'SyntheticProviderFaultProtocol.swift', 'SyntheticProviderFaultAuthority.swift'];
if (!required.every(name => Object.hasOwn(manifest.files, name))) throw Error('Incomplete protection source bindings');
for (const [name, expected] of Object.entries(manifest.files)) {
  if (!/^[A-Za-z]+\.swift$/.test(name) || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Invalid protection source binding');
  for (const location of [resolve(directory, name), resolve(root, 'apps/browser/native/Sources/YNXBrowserCore', name)]) {
    const actual = createHash('sha256').update(await readFile(location)).digest('hex');
    if (actual !== expected) throw Error(`Reviewed protection source changed: ${location}`);
  }
}
for (const name of ['BackendStartGate.m', 'IdentityBridge.c', 'IdentityBridge.h']) {
  const expected = manifest.helperSources?.[name];
  if (!/^[a-f0-9]{64}$/.test(expected ?? '') || createHash('sha256').update(await readFile(resolve(directory, name))).digest('hex') !== expected) throw Error(`Owned start helper source changed: ${name}`);
}
console.log(`PASS ${Object.keys(manifest.files).length} Native/filter source bindings; health lease grants no platform admission`);

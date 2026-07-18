import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [binary, output] = process.argv.slice(2);
if (!binary || !output) throw new Error('usage: generate-shop-sbom.mjs BINARY OUTPUT');
const linked = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' })
  .split('\n').map(line => line.trim().split(/\s+/)).filter(parts => parts[0] === 'dep')
  .map(([, name, version]) => ({ name, version }));
const moduleRows = execFileSync('go', ['list', '-m', '-f', '{{.Path}}\t{{.Version}}\t{{.Dir}}', 'all'], { encoding: 'utf8' })
  .trim().split('\n').map(line => line.split('\t'));
const directories = new Map(moduleRows.map(([name, version, directory]) => [`${name}@${version}`, directory]));

function license(directory) {
  if (!directory || !existsSync(directory)) return 'NOASSERTION';
  const file = readdirSync(directory).find(name => /^licen[cs]e|^copying/i.test(name));
  if (!file) return 'NOASSERTION';
  const text = readFileSync(join(directory, file), 'utf8').slice(0, 20000).toLowerCase();
  if (text.includes('apache license') && text.includes('version 2.0')) return 'Apache-2.0';
  if (text.includes('mozilla public license') && text.includes('2.0')) return 'MPL-2.0';
  if (text.includes('permission is hereby granted, free of charge')) return 'MIT';
  if (text.includes('redistribution and use in source and binary forms')) return text.includes('neither the name') ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (text.includes('isc license')) return 'ISC';
  return 'NOASSERTION';
}

const components = linked.map(({ name, version }) => {
  const detected = license(directories.get(`${name}@${version}`));
  return {
    type: 'library',
    name,
    version,
    purl: `pkg:golang/${name}@${version}`,
    licenses: [{ license: { id: detected } }]
  };
});
components.push(
  { type: 'application', name: '@ynx/shop-web', version: '0.2.0', properties: [{ name: 'runtimeDependencies', value: '0' }] },
  { type: 'application', name: '@ynx/seller-console', version: '0.2.0', properties: [{ name: 'runtimeDependencies', value: '0' }] },
  { type: 'application', name: 'com.ynxweb4.shop', version: '0.2.0', properties: [{ name: 'androidRuntimeDependencies', value: 'Android platform APIs only' }] }
);
const document = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:82b52f7e-0c11-4ac5-9808-38e2f68deb91',
  version: 1,
  metadata: {
    timestamp: '2026-07-18T14:11:03Z',
    component: { type: 'application', name: 'YNX Shop + Seller Console', version: '0.2.0-testnet-preview' },
    properties: [
      { name: 'sourceCommit', value: '38e2f68deb91d5f26e5aeec2318e260cd0742115' },
      { name: 'binary', value: basename(binary) }
    ]
  },
  components
};
writeFileSync(output, JSON.stringify(document, null, 2) + '\n');
console.log(`wrote ${output} with ${components.length} components`);

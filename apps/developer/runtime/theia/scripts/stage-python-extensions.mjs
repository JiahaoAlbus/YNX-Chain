import { readFile, readdir, lstat, realpath, mkdir, cp, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { composedTreeDigest } from '../../../services/codeoss-service/src/composed-runtime.mjs';
const require = createRequire(import.meta.url), semver = require('semver');
const apiVersion = require('@theia/plugin-ext-vscode/lib/common/plugin-vscode-types').VSCODE_DEFAULT_API_VERSION;
const developer = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [destination, baseInput, extensionsInput] = process.argv.slice(2), candidates = join(developer, '.ynx-developer-candidates') + '/';
if (!destination?.startsWith(candidates) || resolve(destination) !== destination) throw Error('Use a new owned candidate destination.');
const base = await realpath(baseInput), extensions = await realpath(extensionsInput);
if (!base.startsWith(candidates) || extensions !== extensionsInput) throw Error('Use canonical retained inputs.');
async function regular(root) {
  for (const name of await readdir(root)) {
    const path = join(root, name), stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw Error('Nonregular extension entry.');
    if (stat.isDirectory()) await regular(path);
  }
}
const receipts = JSON.parse(await readFile(join(base, 'extension-inputs.json')));
await mkdir(destination, { mode: 0o700 });
for (const input of receipts) {
  const name = `${input.namespace}.${input.name}-${input.version}`;
  if (!/^[\w.-]+$/.test(name)) throw Error('Invalid inherited identity.');
  const source = join(base, name), bytes = await readFile(join(base, name + '.vsix'));
  if (createHash('sha256').update(bytes).digest('hex') !== input.sha256) throw Error('Inherited archive changed.');
  await regular(source); const digest = await composedTreeDigest(source);
  if (input.payloadTreeSha256 && input.payloadTreeSha256 !== digest) throw Error('Inherited payload changed.');
  await cp(source, join(destination, name), { recursive: true, errorOnExist: true, force: false });
  if (await composedTreeDigest(join(destination, name)) !== digest) throw Error('Copied payload differs.');
  await writeFile(join(destination, name + '.vsix'), bytes, { flag: 'wx' });
  input.inheritedPayload = input.installedPayload; input.installedPayload = join(destination, name); input.payloadTreeSha256 = digest;
}
for (const id of ['python', 'debugpy']) {
  const selected = (await readdir(extensions)).filter(name => name === `ms-python.${id}-2026.6.0-darwin-arm64`);
  if (selected.length !== 1) throw Error('Expected retained Python component is absent.');
  const source = join(extensions, selected[0]), metadata = JSON.parse(await readFile(join(source, 'package.json')));
  if (metadata.publisher !== 'ms-python' || metadata.name !== id || metadata.version !== '2026.6.0' || metadata.license !== 'MIT'
    || !semver.satisfies(apiVersion, metadata.engines.vscode)) throw Error('Python identity, license or engine mismatch.');
  const license = await readFile(join(source, 'LICENSE.txt'), 'utf8');
  if (!license.includes('Microsoft Corporation') || !license.includes('Permission is hereby granted')) throw Error('Original MIT notice required.');
  await regular(source); const digest = await composedTreeDigest(source), name = `ms-python.${id}-${metadata.version}`, target = join(destination, name);
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  if (await composedTreeDigest(target) !== digest || await composedTreeDigest(source) !== digest) throw Error('Installed component changed during copy.');
  const assembly = join(destination, 'archive-assembly', name); await mkdir(assembly, { recursive: true });
  await cp(target, join(assembly, 'extension'), { recursive: true, errorOnExist: true, force: false });
  await writeFile(join(assembly, '[Content_Types].xml'), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>', { flag: 'wx' });
  await writeFile(join(assembly, 'extension.vsixmanifest'), `<?xml version="1.0"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${id}" Version="${metadata.version}" Publisher="ms-python"/><DisplayName>${id}</DisplayName><Description>Locally assembled retained MIT Python component</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`, { flag: 'wx' });
  const archive = join(destination, name + '.vsix');
  execFileSync('/usr/bin/zip', ['-X', '-q', '-r', archive, '.'], { cwd: assembly, env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' } });
  const bytes = await readFile(archive);
  receipts.push({ namespace: 'ms-python', name: id, version: metadata.version, license: metadata.license, engines: metadata.engines,
    installedPayload: target, sourceTreeSha256: digest, payloadTreeSha256: digest, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), source: 'Locally assembled VSIX from unchanged retained MIT extension; not a registry archive.',
    lifecycleScriptsExecuted: false, activationVerified: false, apiVersionRangeMatched: apiVersion });
}
await writeFile(join(destination, 'extension-inputs.json'), JSON.stringify(receipts, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(destination, 'python-scope.json'), JSON.stringify({ included: ['ms-python.python', 'ms-python.debugpy'], excluded: ['ms-python.vscode-pylance', 'ms-python.vscode-python-envs'],
  policy: 'No downloads, lifecycle execution, extension modification, API-version spoofing or network isolation changes.',
  acceptance: 'Engine range and byte copy only; runtime activation, language service and debugging require separate real-flow evidence.' }, null, 2) + '\n');
console.log(JSON.stringify(receipts.slice(-2)));

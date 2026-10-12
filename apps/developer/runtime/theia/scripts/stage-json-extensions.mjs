import { readFile, readdir, lstat, writeFile, mkdir, cp, realpath } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { composedTreeDigest } from '../../../services/codeoss-service/src/composed-runtime.mjs';
const developer = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [destination, baseInput, installedApp, mitInput] = process.argv.slice(2), candidates = join(developer, '.ynx-developer-candidates') + '/';
if (!destination?.startsWith(candidates) || resolve(destination) !== destination) throw Error('Use a new owned candidate destination.');
const base = await realpath(baseInput), app = await realpath(installedApp);
if (!base.startsWith(candidates) || app !== installedApp) throw Error('Use canonical existing component inputs.');
async function regular(root) {
  for (const name of await readdir(root)) { const path = join(root, name), stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw Error('Nonregular component input.');
    if (stat.isDirectory()) await regular(path);
  }
}
const notices = await readFile(join(app, 'ThirdPartyNotices.txt'));
for (const item of ['vscode-json-languageservice 6.0.0-next.4 - MIT', 'vscode-languageclient 10.1.1 - MIT', 'vscode-languageserver 10.1.1 - MIT', 'request-light 0.8.0 - MIT'])
  if (!notices.toString('utf8').includes(item)) throw Error('Missing bundled dependency notices.');
const mit = await readFile(mitInput);
if (!mit.toString().includes('Microsoft Corporation') || !mit.toString().includes('Permission is hereby granted')) throw Error('Original Microsoft MIT notice required.');
const receipts = JSON.parse(await readFile(join(base, 'extension-inputs.json'), 'utf8'));
await mkdir(destination, { mode: 0o700 });
for (const input of receipts) {
  const name = `${input.namespace}.${input.name}-${input.version}`;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw Error('Invalid inherited component name.');
  const source = join(base, name), archive = await readFile(join(base, name + '.vsix'));
  if (createHash('sha256').update(archive).digest('hex') !== input.sha256) throw Error('Inherited archive changed.');
  await regular(source); const digest = await composedTreeDigest(source);
  if (input.payloadTreeSha256 && input.payloadTreeSha256 !== digest) throw Error('Inherited payload changed.');
  await cp(source, join(destination, name), { recursive: true, errorOnExist: true, force: false });
  if (await composedTreeDigest(join(destination, name)) !== digest || await composedTreeDigest(source) !== digest) throw Error('Inherited payload changed during copy.');
  await writeFile(join(destination, name + '.vsix'), archive, { flag: 'wx', mode: 0o600 });
  input.inheritedPayload = input.installedPayload; input.installedPayload = join(destination, name); input.payloadTreeSha256 = digest;
}
for (const id of ['json', 'json-language-features']) {
  const source = join(app, 'extensions', id), metadata = JSON.parse(await readFile(join(source, 'package.json')));
  if (metadata.name !== id || metadata.publisher !== 'vscode' || metadata.version !== '10.0.0' || metadata.license !== 'MIT') throw Error('Unexpected installed JSON component.');
  await regular(source); const sourceDigest = await composedTreeDigest(source), name = `vscode.${id}-${metadata.version}`, target = join(destination, name);
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  if (await composedTreeDigest(target) !== sourceDigest || await composedTreeDigest(source) !== sourceDigest) throw Error('Installed JSON component changed during staging.');
  await writeFile(join(target, 'ThirdPartyNotices.txt'), notices, { flag: 'wx' });
  await writeFile(join(target, 'MICROSOFT-MIT-NOTICE.txt'), mit, { flag: 'wx' });
  await writeFile(join(target, 'NOTICE.txt'), 'Unchanged installed MIT-declared VS Code JSON component and bundled dependencies. Original manifest, source bytes, embedded notices and full installed third-party notices retained. Locally assembled archive, not an upstream registry VSIX. No package lifecycle or network download.\n', { flag: 'wx' });
  const assembly = join(destination, 'archive-assembly', name); await mkdir(assembly, { recursive: true, mode: 0o700 });
  await cp(target, join(assembly, 'extension'), { recursive: true, errorOnExist: true, force: false });
  await writeFile(join(assembly, '[Content_Types].xml'), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>', { flag: 'wx' });
  await writeFile(join(assembly, 'extension.vsixmanifest'), `<?xml version="1.0"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${id}" Version="${metadata.version}" Publisher="vscode"/><DisplayName>${id}</DisplayName><Description xml:space="preserve">Locally assembled installed MIT JSON component</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`, { flag: 'wx' });
  const archivePath = join(destination, name + '.vsix');
  execFileSync('/usr/bin/zip', ['-X', '-q', '-r', archivePath, '.'], { cwd: assembly, env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' } });
  const archive = await readFile(archivePath);
  receipts.push({ namespace: 'vscode', name: id, version: metadata.version, license: metadata.license, engines: metadata.engines,
    installedPayload: target, payloadTreeSha256: await composedTreeDigest(target), sourceTreeSha256: sourceDigest,
    sha256: createHash('sha256').update(archive).digest('hex'), bytes: archive.length,
    source: 'Locally assembled VSIX from existing installed MIT-declared files; not an upstream registry archive.', lifecycleScriptsExecuted: false, activationVerified: false });
}
await writeFile(join(destination, 'extension-inputs.json'), JSON.stringify(receipts, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipts.slice(-2)));

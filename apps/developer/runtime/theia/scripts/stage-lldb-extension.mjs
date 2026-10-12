import { readFile, writeFile, mkdir, cp, realpath } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { composedTreeDigest } from '../../../services/codeoss-service/src/composed-runtime.mjs';
const require = createRequire(import.meta.url), decompress = require('decompress');
const developer = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [destination, baseInput, archiveInput] = process.argv.slice(2), candidates = join(developer, '.ynx-developer-candidates') + '/';
if (!destination?.startsWith(candidates) || resolve(destination) !== destination) throw Error('Use a new owned candidate destination.');
const base = await realpath(baseInput);
if (!base.startsWith(candidates)) throw Error('Base extensions must be owned immutable inputs.');
const receipts = JSON.parse(await readFile(join(base, 'extension-inputs.json'), 'utf8'));
const archive = await readFile(archiveInput);
if (archive.length > 64 * 1024 * 1024) throw Error('Cached archive exceeds its limit.');
const entries = await decompress(archive); let size = 0;
if (entries.length > 12000) throw Error('Cached extension contains too many files.');
for (const entry of entries) {
  if (!['file', 'directory'].includes(entry.type) || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').includes('..')) throw Error('Unsafe cached archive entry.');
  size += entry.data.length; if (size > 128 * 1024 * 1024) throw Error('Cached extension expands beyond its limit.');
}
const manifest = JSON.parse(entries.find(e => e.path === 'extension/package.json')?.data.toString('utf8') || '{}');
if (manifest.publisher !== 'llvm-vs-code-extensions' || manifest.name !== 'lldb-dap' || manifest.version !== '0.4.1' || manifest.license !== 'Apache 2.0 License with LLVM exceptions') throw Error('Unexpected cached LLDB extension identity.');
if (!entries.some(e => e.path === 'extension/LICENSE.TXT' && e.data.toString('utf8').includes('LLVM Exceptions'))) throw Error('Original LLVM license is required.');
await mkdir(destination, { mode: 0o700 });
for (const input of receipts) {
  const name = `${input.namespace}.${input.name}-${input.version}`, payload = join(base, name), bytes = await readFile(join(base, `${name}.vsix`));
  if (createHash('sha256').update(bytes).digest('hex') !== input.sha256) throw Error('Inherited archive changed.');
  const digest = await composedTreeDigest(payload);
  await cp(payload, join(destination, name), { recursive: true, errorOnExist: true, force: false });
  if (await composedTreeDigest(join(destination, name)) !== digest) throw Error('Inherited payload changed during staging.');
  await writeFile(join(destination, `${name}.vsix`), bytes, { flag: 'wx', mode: 0o600 });
  input.inheritedPayload = input.installedPayload; input.installedPayload = join(destination, name); input.payloadTreeSha256 = digest;
}
const name = `${manifest.publisher}.${manifest.name}-${manifest.version}`, plugin = join(destination, name);
await mkdir(plugin, { mode: 0o700 });
for (const entry of entries.filter(e => e.path.startsWith('extension/'))) {
  const relative = entry.path.slice('extension/'.length); if (!relative) continue;
  const target = join(plugin, relative);
  if (entry.type === 'directory') await mkdir(target, { recursive: true, mode: 0o700 });
  else { await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, entry.data, { flag: 'wx', mode: entry.mode & 0o100 ? 0o700 : 0o600 }); }
}
await writeFile(join(destination, `${name}.vsix`), archive, { flag: 'wx', mode: 0o600 });
receipts.push({ namespace: manifest.publisher, name: manifest.name, version: manifest.version, license: manifest.license,
  sha256: createHash('sha256').update(archive).digest('hex'), bytes: archive.length, installedPayload: plugin,
  payloadTreeSha256: await composedTreeDigest(plugin), engines: manifest.engines, source: 'Existing local LLVM VSIX; no network/package download',
  lifecycleScriptsExecuted: false, activationVerified: false });
await writeFile(join(destination, 'extension-inputs.json'), JSON.stringify(receipts, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipts.at(-1)));

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), decompress = require('decompress');
const destination = process.argv[2];
if (!destination || !destination.startsWith('/')) throw Error('Provide an absolute owned extension staging directory.');
const root = resolve(destination);
await mkdir(root, { recursive: true, mode: 0o700 });
const pins = [
  { namespace: 'vscode', name: 'javascript', version: '1.95.3' },
  { namespace: 'vscode', name: 'typescript', version: '1.95.3' },
  { namespace: 'vscode', name: 'typescript-language-features', version: '1.95.3' },
  { namespace: 'vscode', name: 'git', version: '1.95.3' },
  { namespace: 'vscode', name: 'git-base', version: '1.95.3' },
  { namespace: 'ms-vscode', name: 'js-debug', version: '1.140.0' },
];
const receipts = [];
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 64 * 1024 * 1024) throw Error('Extension exceeds the staging limit.');
  return bytes;
}
for (const pin of pins) {
  const api = `https://open-vsx.org/api/${pin.namespace}/${pin.name}/${pin.version}`;
  const metadata = JSON.parse((await fetchBytes(api)).toString('utf8'));
  if (metadata.version !== pin.version || metadata.namespace !== pin.namespace || metadata.name !== pin.name) throw Error('Extension identity mismatch.');
  const official = url => typeof url === 'string' && url.startsWith(`${api}/file/`);
  if (!official(metadata.files?.download) || !official(metadata.files?.sha256)) throw Error('Unexpected artifact source.');
  const expected = (await fetchBytes(metadata.files.sha256)).toString('utf8').trim().split(/\s/)[0];
  const archive = await fetchBytes(metadata.files.download);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== sha256) throw Error('Extension archive integrity mismatch.');
  const entries = await decompress(archive);
  if (entries.length > 12000) throw Error('Too many extension files.');
  let size = 0;
  for (const entry of entries) {
    if (!['file', 'directory'].includes(entry.type) || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').includes('..')) throw Error('Unsafe extension archive entry.');
    size += entry.data.length;
    if (size > 128 * 1024 * 1024) throw Error('Extension expands beyond its limit.');
  }
  const plugin = join(root, `${pin.namespace}.${pin.name}-${pin.version}`);
  await mkdir(plugin, { mode: 0o700 });
  // Extract only the extension payload. No dependency/package install hooks.
  for (const entry of entries.filter(item => item.path.startsWith('extension/'))) {
    const relative = entry.path.slice('extension/'.length);
    if (!relative) continue;
    const path = join(plugin, relative);
    if (entry.type === 'directory') await mkdir(path, { recursive: true, mode: 0o700 });
    else { await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 }); await writeFile(path, entry.data, { flag: 'wx', mode: entry.mode & 0o100 ? 0o700 : 0o600 }); }
  }
  const manifest = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'));
  if (manifest.publisher !== pin.namespace || manifest.name !== pin.name || manifest.version !== pin.version) throw Error('Unpacked extension manifest mismatch.');
  const archivePath = join(root, `${pin.namespace}.${pin.name}-${pin.version}.vsix`);
  await writeFile(archivePath, archive, { flag: 'wx', mode: 0o600 });
  receipts.push({ ...pin, api, sha256, bytes: archive.length, installedPayload: plugin, license: manifest.license,
    engines: manifest.engines, lifecycleScriptsExecuted: false, activationVerified: false });
}
await writeFile(join(root, 'extension-inputs.json'), JSON.stringify(receipts, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(receipts));

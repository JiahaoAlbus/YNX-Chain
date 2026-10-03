import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), decompress = require('decompress');
const destination = process.argv[2];
if (!destination?.startsWith('/')) throw Error('Provide an absolute owned debugger staging directory.');
const root = resolve(destination);
await mkdir(root, { mode: 0o700 });
const version = '1.140.0';
const url = `https://github.com/microsoft/vscode-js-debug/releases/download/v${version}/js-debug-dap-v${version}.tar.gz`;
const expected = '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968';
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw Error(`Debugger download failed: ${response.status}`);
const chunks = []; let size = 0;
for await (const chunk of response.body) {
  size += chunk.length;
  if (size > 64 * 1024 * 1024) throw Error('Debugger archive exceeds its limit.');
  chunks.push(chunk);
}
const archive = Buffer.concat(chunks);
const sha256 = createHash('sha256').update(archive).digest('hex');
if (sha256 !== expected) throw Error('Official debugger release digest mismatch.');
const entries = await decompress(archive), files = [];
if (entries.length > 12000) throw Error('Too many debugger entries.');
let total = 0;
for (const entry of entries) {
  if (!['file', 'directory'].includes(entry.type) || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').includes('..')) throw Error('Unsafe debugger archive entry.');
  total += entry.data.length;
  if (total > 128 * 1024 * 1024) throw Error('Debugger expands beyond its limit.');
  const path = join(root, entry.path);
  if (entry.type === 'directory') await mkdir(path, { recursive: true, mode: 0o700 });
  else {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, entry.data, { flag: 'wx', mode: 0o600 });
    files.push({ path: entry.path, sha256: createHash('sha256').update(entry.data).digest('hex') });
  }
}
await writeFile(join(root, 'release.tar.gz'), archive, { flag: 'wx', mode: 0o600 });
await writeFile(join(root, 'receipt.json'), JSON.stringify({ version, url, sha256, bytes: size, entries: entries.length, files, executed: false }, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ root, version, sha256, files: files.length }));

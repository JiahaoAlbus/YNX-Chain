// Generated, byte-bound unified vendor upgrade only. Never recreate a launcher.
import { readFileSync, lstatSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv.length !== 3) throw Error('Expected one frozen SDK directory');
const source = process.argv[2], destination = fileURLToPath(new URL('../src/vendor/', import.meta.url));
const entries = [
  ['application-actions-browser.mjs', 'application-actions-browser.mjs', 116695, '8e2db1a041dca2a9b61c081a9bb4d0da12d50b55e45008ab3b69e7d3b7c36d17'],
  ['application-actions-browser-manifest.json', 'native-runtime-manifest.json', 5122, '14b6604c909334d566b3213b5b81af9c3b66b61f436fabf1210e4a68da7b33b1'],
  ['product-session-registry.json', 'native-runtime-registry.json', 7590, 'e74e1668e631dd623a4364cc9580951a9fe96fcef0c66c5910d84c774f4fdc08'],
];
const prepared = entries.map(([input, output, bytes, sha]) => {
  const path = resolve(source, input), target = resolve(destination, output), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('SDK source must be a regular file');
  const body = readFileSync(path);
  if (body.length !== bytes || createHash('sha256').update(body).digest('hex') !== sha) throw Error('SDK identity mismatch');
  const replacing = output === 'application-actions-browser.mjs';
  if (replacing) {
    const priorStat=lstatSync(target),prior=readFileSync(target);
    if(!priorStat.isFile()||priorStat.isSymbolicLink()||priorStat.nlink!==1||prior.length!==110477||createHash('sha256').update(prior).digest('hex')!=='627d7c57e15bfc3a92c77fb58d11c2bdb0e54f8f20c5989d51091163b71f5d0f')throw Error('Upgrade requires exact reviewed ff5 preimage');
  } else if (existsSync(target)) throw Error('Never overwrite another SDK delivery');
  return { target, body, replacing };
});
const manifest = JSON.parse(prepared[1].body);
if (manifest.sourceCommit !== '3720cd63bcc89eef06162a1e6339635d16a8b06b' || manifest.sourceTree !== '156a655791df43eac4b8df3d1dcdb572174a091c' || manifest.inputs.length !== 24 || manifest.imports.length !== 0) throw Error('SDK source closure mismatch');
const previous = JSON.parse(readFileSync(resolve(destination, 'native-action-manifest.json')));
for (const name of ['application-action.js', 'application-action-request.js']) {
  const old = previous.inputs.find(input => input.path.endsWith('/src/' + name));
  const next = manifest.inputs.find(input => input.path.endsWith('/src/' + name));
  if (!old || !next || old.bytes !== next.bytes || old.sha256 !== next.sha256) throw Error('Pending request protocol changed; explicit migration required');
}
for (const { target, body, replacing } of prepared) writeFileSync(target, body, { flag: replacing ? 'w' : 'wx' });
console.log('Unified official action/launcher runtime imported; ff5 journal protocol bytes and namespace remain unchanged.');

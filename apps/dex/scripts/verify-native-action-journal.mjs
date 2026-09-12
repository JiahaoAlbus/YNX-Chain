import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../src/',import.meta.url));
for(const [name,bytes,sha] of [
  ['application-actions-browser.mjs',110477,'627d7c57e15bfc3a92c77fb58d11c2bdb0e54f8f20c5989d51091163b71f5d0f'],
  ['native-action-manifest.json',4760,'c3104b9ce935ba734fa706a60568c6154423e03ccbe0ac79a13ef170bdb1c5d1'],
  ['native-action-registry.json',7546,'85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3'],
]){
  const data=readFileSync(root+'vendor/'+name);
  if(data.length!==bytes||createHash('sha256').update(data).digest('hex')!==sha)throw Error('Frozen SDK identity mismatch: '+name);
}
const manifest=JSON.parse(readFileSync(root+'vendor/native-action-manifest.json'));
if(manifest.sourceCommit!=='ff5b7d49dd515d31d567c352dd049ac7b79d4139'||manifest.sourceTree!=='92bc40205167e80edcf10a31ff83db0fab592d08'||manifest.inputs.length!==23||manifest.imports.length!==0)throw Error('SDK source closure mismatch');
const consumer=readFileSync(root+'native-action-journal.ts','utf8');
for(const marker of ['createApplicationActionRequest(registry','encodeApplicationActionWalletURL(registry','parseApplicationActionReturnURL(registry','verifySignedApplicationAction(value.signed','applicationActionHash(result.signed)',"durability:'strict'",'NATIVE_SIGNED_INTENT_MUST_BE_RETAINED','NATIVE_INTENT_ALREADY_EXISTS'])if(!consumer.includes(marker))throw Error('Missing native journal boundary: '+marker);
if(/\bfetch\s*\(|\.request\s*\(|location\.(?:href|assign|replace)|window\.open|<iframe|createSignedApplicationAction|accountSecret|localStorage/.test(consumer.replace(/\/\*[\s\S]*?\*\//g,'')))throw Error('Intent journal must not transport, navigate, sign or fall back to plaintext storage');
console.log('Fixed native SDK 23-input closure and journal no-transport/no-sign boundary PASS; not installed or public evidence.');

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../src/',import.meta.url));
for(const [name,bytes,sha] of [
  ['application-actions-browser.mjs',116695,'8e2db1a041dca2a9b61c081a9bb4d0da12d50b55e45008ab3b69e7d3b7c36d17'],
  ['native-action-manifest.json',4760,'c3104b9ce935ba734fa706a60568c6154423e03ccbe0ac79a13ef170bdb1c5d1'],
  ['native-action-registry.json',7546,'85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3'],
  ['native-runtime-manifest.json',5122,'14b6604c909334d566b3213b5b81af9c3b66b61f436fabf1210e4a68da7b33b1'],
  ['native-runtime-registry.json',7590,'e74e1668e631dd623a4364cc9580951a9fe96fcef0c66c5910d84c774f4fdc08'],
]){
  const data=readFileSync(root+'vendor/'+name);
  if(data.length!==bytes||createHash('sha256').update(data).digest('hex')!==sha)throw Error('Frozen SDK identity mismatch: '+name);
}
const manifest=JSON.parse(readFileSync(root+'vendor/native-action-manifest.json'));
if(manifest.sourceCommit!=='ff5b7d49dd515d31d567c352dd049ac7b79d4139'||manifest.sourceTree!=='92bc40205167e80edcf10a31ff83db0fab592d08'||manifest.inputs.length!==23||manifest.imports.length!==0)throw Error('SDK source closure mismatch');
const launcher=JSON.parse(readFileSync(root+'vendor/native-runtime-manifest.json'));
if(launcher.sourceCommit!=='3720cd63bcc89eef06162a1e6339635d16a8b06b'||launcher.sourceTree!=='156a655791df43eac4b8df3d1dcdb572174a091c'||launcher.inputs.length!==24||launcher.imports.length)throw Error('Launcher source closure mismatch');
for(const name of ['application-action.js','application-action-request.js']){
  const old=manifest.inputs.find(input=>input.path.endsWith('/src/'+name)),next=launcher.inputs.find(input=>input.path.endsWith('/src/'+name));
  if(!old||!next||old.bytes!==next.bytes||old.sha256!==next.sha256)throw Error('Journal request/signature compatibility changed');
}
const previousRegistry=JSON.parse(readFileSync(root+'vendor/native-action-registry.json')),currentRegistry=JSON.parse(readFileSync(root+'vendor/native-runtime-registry.json'));
if(JSON.stringify(previousRegistry.products.find(product=>product.productId==='dex'))!==JSON.stringify(currentRegistry.products.find(product=>product.productId==='dex')))throw Error('Persisted DEX product binding changed');
const consumer=readFileSync(root+'native-action-journal.ts','utf8');
for(const marker of ['createApplicationActionRequest(registry','encodeApplicationActionWalletURL(registry','parseApplicationActionReturnURL(registry','verifySignedApplicationAction(value.signed','applicationActionHash(result.signed)',"durability:'strict'",'NATIVE_SIGNED_INTENT_MUST_BE_RETAINED','NATIVE_INTENT_ALREADY_EXISTS'])if(!consumer.includes(marker))throw Error('Missing native journal boundary: '+marker);
if(/\bfetch\s*\(|\.request\s*\(|location\.(?:href|assign|replace)|window\.open|<iframe|createSignedApplicationAction|accountSecret|localStorage/.test(consumer.replace(/\/\*[\s\S]*?\*\//g,'')))throw Error('Intent journal must not transport, navigate, sign or fall back to plaintext storage');
console.log('Fixed ff5 journal identity/no-transport/no-sign boundary PASS; not installed or public evidence.');
console.log('Official unified 3720cd63 runtime 24-input closure and original pending-protocol/product-binding byte compatibility PASS.');

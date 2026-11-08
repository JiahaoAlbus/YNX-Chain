import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const fixture=path.join(root,'packages/wallet-auth/test/fixtures/android-code-image-root-ci');
export const native=path.join(root,'apps/wallet/modules/ynx-pq-custody/native/android-code-image-root');
export function verifyInputs(base=root){
 const manifest=JSON.parse(fs.readFileSync(path.join(fixture,'INPUTS.json'),'utf8'));
 if(manifest.files.length!==11||manifest.nativeSource!=='5cb9ae32e55874914aa5ce354f57f06a1abd8a9c'||manifest.RootRows!==0)throw Error('INPUT_MANIFEST_ROLE');
 for(const item of manifest.files){
  const p=path.resolve(base,item.path);if(!p.startsWith(path.resolve(base)+path.sep)||fs.lstatSync(p).isSymbolicLink())throw Error('INPUT_PATH');
  const b=fs.readFileSync(p);if(b.length!==item.bytes||createHash('sha256').update(b).digest('hex')!==item.sha256)throw Error('INPUT_BYTES:'+item.path);
 }
 return manifest;
}
export function assertStrongNine(text,header,macho=false){
 const names=Array.from(header.matchAll(/\b(ynx_native_android_code_image_\w+_v1)\(/g),x=>x[1]);
 if(names.length!==9||new Set(names).size!==9)throw Error('EXPECTED_C9');
 for(const name of names){
  const rows=text.split('\n').filter(line=>line.trim().split(/\s+/).at(-1)===(macho?'_':'')+name);
  if(rows.length!==1||rows[0].trim().split(/\s+/).at(-2)!=='T')throw Error('STRONG_C9:'+name);
 }
 if(text.includes('ynx_android_code_image_PUBLIC_close'))throw Error('PUBLIC_HOOK_IN_NORMAL');
 return names;
}

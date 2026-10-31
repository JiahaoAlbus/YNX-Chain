// Public diagnostic bytes only; independent Noble v0.6.1, not fork verification.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=process.argv[2],file=process.argv[3];
const {slh_dsa_sha2_256f:slh}=await import(pathToFileURL(resolve(root,'node_modules/@noble/post-quantum/slh-dsa.js')));
const records=JSON.parse(readFileSync(file,'utf8'));
const seed=Uint8Array.from({length:96},(_,i)=>i);
const {publicKey,secretKey}=slh.keygen(seed);
try {
 for(const raw of records){
  const v=Object.fromEntries(Object.entries(raw).map(([k,b64])=>[k,Buffer.from(b64,'base64')]));
  assert.deepEqual(Buffer.from(publicKey),v.publicKey);
  for(const signature of [v.original,v.candidate])assert(slh.verify(signature,v.message,v.publicKey,{context:new Uint8Array()}));
  const signature=slh.sign(v.message,secretKey,{context:new Uint8Array(),extraEntropy:v.entropy});
  assert.deepEqual(Buffer.from(signature),v.original);
  assert.deepEqual(Buffer.from(signature),v.candidate);
  const bad=Uint8Array.from(v.candidate);bad[0]^=1;
  assert.equal(slh.verify(bad,v.message,v.publicKey,{context:new Uint8Array()}),false);
 }
}finally{secretKey.fill(0);seed.fill(0);}
console.log(JSON.stringify({independentProvider:'@noble/post-quantum@0.6.1',vectors:records.length,originalAndScheduledVerified:true,threeProviderSameKeyRBytesEqual:true,tamperRejected:true,publicDiagnosticOnly:true}));

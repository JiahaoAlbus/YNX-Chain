// Read only. Independently checks a public fixture emitted by TestRealSigner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]),fixture=JSON.parse(readFileSync(process.argv[3]));
const y=await import(pathToFileURL(resolve(root,'src/index.mjs')));
const {ml_dsa87}=await import(pathToFileURL(resolve(root,'node_modules/@noble/post-quantum/ml-dsa.js')));
const {slh_dsa_sha2_256f}=await import(pathToFileURL(resolve(root,'node_modules/@noble/post-quantum/slh-dsa.js')));
const cert=Buffer.from(fixture.certificate,'base64'),whole=Buffer.from(fixture.whole,'base64'),member=Buffer.from(fixture.member,'base64');
const c=y.decodeCertificate(cert),D=y.encodeDescriptor(c);
const r={algorithmVersion:y.VERSION,chainId:c.chainId,owner:c.owner,purpose:c.purpose,pkA:c.pkA,pkB:c.pkB,
enabled:true,policyRevision:'research-only-1',activeFrom:3,revokedAt:null};
const v=y.createVerifier({chainId:c.chainId,purpose:c.purpose,resolveTrustedOwner:()=>r});
assert.ok(v.verifyWhole(whole,{height:7}));assert.ok(v.verifyOne(member,{height:7}));
for(const [branch,algorithm] of [['A',ml_dsa87],['B',slh_dsa_sha2_256f]])
  assert.ok(algorithm.verify(c['sigma'+branch],y.encodeFields([y.VERSION+'/CERT/'+branch,D]),c['pk'+branch],{context:new Uint8Array()}));
console.log(JSON.stringify({GoToOpenSSLWhole:true,GoToOpenSSLMember:true,GoToNobleAND:true,N:c.N,certificateBytes:cert.length}));

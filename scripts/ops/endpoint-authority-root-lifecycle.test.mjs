import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {prepareEndpointAuthorityRootSuccessor,validateEndpointAuthorityLifecycleDraft} from './endpoint-authority-root-lifecycle.mjs';
import {canonicalAuthorityV2} from '../../sdk/js/endpoint-authority-v2.js';
import {prepareAuthorityV2Draft} from './endpoint-authority-v2.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
// Exact public-only retired Root2/54 evidence; no production key is read.
const baseline=JSON.parse(await fs.readFile(new URL('./testdata/root3-lifecycle/retired-root2-config54.json',import.meta.url),'utf8'));
const now=Date.parse('2026-10-02T17:00:00.000Z'),old=baseline.trustRoot,previous=baseline.serverCheckpoint;
const publicKey=generateKeyPairSync('ed25519').publicKey.export({format:'jwk'}).x;
const key={keyId:'ynx-test-only-finite-root3',algorithm:'Ed25519',publicKeyBase64url:publicKey,notBefore:new Date(now).toISOString(),notAfter:new Date(now+86400000).toISOString(),revoked:false};
const input=()=>({previousRoot:structuredClone(old),expectedPreviousRootSHA256:sha(canonicalAuthorityV2(old)),previousCheckpoint:structuredClone(previous),anchorManifest:structuredClone(baseline.manifest),consumer:{consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.0.0'},newPublicKey:structuredClone(key),nowMs:now});
test('expired root2 historical54 authenticates unchanged root3 floor without activating or signing',async()=>{
 const before=canonicalAuthorityV2(old),r=await prepareEndpointAuthorityRootSuccessor(input());
 assert.equal(r.trustRoot.rootVersion,3);assert.deepEqual(r.trustRoot.anchor,{...previous,rootVersion:3});assert.deepEqual(r.trustRoot.keys.slice(0,-1),old.keys);assert.equal(canonicalAuthorityV2(old),before);assert.equal(r.signed,false);assert.equal(r.activated,false);assert.equal(r.currentAuthorityVerified,false);
});
for(const [name,mutate] of [
 ['wrong previous pin',x=>x.expectedPreviousRootSHA256='f'.repeat(64)],['wrong checkpoint payload',x=>x.previousCheckpoint.payloadSha256='f'.repeat(64)],['same key reuse',x=>x.newPublicKey={...old.keys[1]}],['long key window',x=>x.newPublicKey.notAfter=new Date(now+86400001).toISOString()],['future key',x=>x.newPublicKey.notBefore=new Date(now+1).toISOString()],['old signature tamper',x=>x.anchorManifest.integrity.signature=Buffer.alloc(64).toString('base64url')],['scope substitution',x=>x.consumer.origin='https://other.invalid']
])test('root lifecycle rejects '+name,async()=>{const x=input();mutate(x);await assert.rejects(prepareEndpointAuthorityRootSuccessor(x));});
test('pure receipt validation rejects the exact old55 missing flags before any key read',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-root3-receipt-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const r=await prepareEndpointAuthorityRootSuccessor(input()),draft=structuredClone(baseline.manifest);
 draft.sequence=55;draft.manifestVersion='2.0.0.55';draft.previousPayloadSha256=previous.payloadSha256;draft.issuedAt=new Date(now).toISOString();draft.expiresAt=new Date(now+3600000).toISOString();
 const gateway=JSON.parse(await fs.readFile(new URL('./testdata/root3-lifecycle/retired55-gateway-receipt.json',import.meta.url),'utf8'));
 const finance=JSON.parse(await fs.readFile(new URL('./testdata/root3-lifecycle/retired55-finance-receipt-missing-boundaries.json',import.meta.url),'utf8'));
 draft.endpoints.walletGateway.evidence={...draft.endpoints.walletGateway.evidence,source:gateway.source,health:gateway.health.observation,version:gateway.version.observation,receiptSha256:sha(canonicalAuthorityV2(gateway)+'\n')};
 draft.products.finance.evidence={...finance.acceptance,receiptSha256:sha(canonicalAuthorityV2(finance)+'\n')};
 // Fresh observation timestamps are a controlled fixture, not new public facts.
 for(const kind of ['health','version']){gateway[kind].observation.observedAt=new Date(now-1000).toISOString();draft.endpoints.walletGateway.evidence[kind]=gateway[kind].observation;}
 finance.acceptance.observedAt=new Date(now-1000).toISOString();draft.products.finance.evidence.observedAt=finance.acceptance.observedAt;
 const write=async value=>{const bytes=canonicalAuthorityV2(value)+'\n',hash=sha(bytes);await fs.writeFile(path.join(dir,hash+'.json'),bytes);return hash;};
 draft.endpoints.walletGateway.evidence.receiptSha256=await write(gateway);draft.products.finance.evidence.receiptSha256=await write(finance);
 const options=()=>({draft:prepareAuthorityV2Draft(draft,key.keyId),trustRoot:r.trustRoot,checkpoint:previous,consumer:input().consumer,nowMs:now,evidenceDirectory:dir});
 assert.throws(()=>validateEndpointAuthorityLifecycleDraft(options()),/PROVIDER_BOUNDARY/);
 Object.assign(finance,{officialSandboxVerified:false,providerVerified:false,productionApproved:false});draft.products.finance.evidence.receiptSha256=await write(finance);
 const checked=validateEndpointAuthorityLifecycleDraft(options());assert.equal(checked.receiptValidatorPassed,true);assert.equal(checked.signed,false);assert.equal(checked.receiptHashes.length,2);
});

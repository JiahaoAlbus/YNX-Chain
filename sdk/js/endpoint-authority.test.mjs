import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalEndpointAuthorityPayload,validateEndpointAuthority,selectAuthorityEndpoint,assertEndpointAuthorityStructure} from './endpoint-authority.js';
import {endpointAuthorityPin,bundledEndpointAuthority,verifyBundledEndpointAuthority} from './endpoint-authority-bundle.js';
import {buildEndpointAuthority,sha256} from '../../scripts/ops/issue-endpoint-authority.mjs';
import {loadEndpointAuthorityRelease} from '../../scripts/lib/endpoint-authority-release.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const json=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const copy=()=>structuredClone(bundledEndpointAuthority);
const vectors=json('chain-metadata/endpoint-authority/consumer-vectors.json');
const nowMs=Date.parse(vectors.validAt);
const options={trustedPin:endpointAuthorityPin,nowMs,digestSHA256:sha256};
for(const vector of vectors.cases)test(`shared authority vector: ${vector.id}`,async()=>{
  const value=copy();if(vector.patch){let o=value;for(const key of vector.patch.slice(0,-1))o=o[key];o[vector.patch.at(-1)]=vector.value;}
  const result=validateEndpointAuthority(value,{...options,...(vector.now?{nowMs:Date.parse(vector.now)}:{}),source:vector.source??'bundled'});
  if(vector.expected==='PASS')assert.equal((await result).rpc,'https://rpc-testnet.ynxweb4.com');
  else await assert.rejects(result,new RegExp(vector.expected));
});
test('hash pin is independent; self-rehash and missing/version-rolled-back pins fail closed',async()=>{
  const v=copy();v.acceptanceBoundary='changed';v.integrity.payloadSha256=sha256(canonicalEndpointAuthorityPayload(v));
  await assert.rejects(validateEndpointAuthority(v,options),/PIN_MISMATCH/);
  await assert.rejects(validateEndpointAuthority(copy(),{nowMs}),/UNTRUSTED_PIN/);
  await assert.rejects(validateEndpointAuthority(copy(),{...options,trustedPin:{...endpointAuthorityPin,manifestVersion:'1.0.0-p0.2'}}),/UNTRUSTED_PIN/);
});
test('canonicalization ignores object key order, not evidence values or array order',async()=>{
  const reverse=v=>Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
  assert.equal(canonicalEndpointAuthorityPayload(reverse(copy())),canonicalEndpointAuthorityPayload(copy()));
  assert.equal((await validateEndpointAuthority(reverse(copy()),options)).manifestVersion,endpointAuthorityPin.manifestVersion);
  assert.throws(()=>canonicalEndpointAuthorityPayload({bad:NaN}),/NON_JSON/);
  assert.throws(()=>canonicalEndpointAuthorityPayload({bad:new Date()}),/NON_JSON/);
});
test('remote mode remains forbidden even when an exact hash or pretend signer is supplied',async()=>{
  await assert.rejects(validateEndpointAuthority(copy(),{...options,source:'remote'}),/REMOTE_FORBIDDEN/);
  const v=copy();v.integrity.remoteSignature={status:'VERIFIED',keyId:'untrusted',signature:'pretend',failClosed:true};
  await assert.rejects(validateEndpointAuthority(v,options),/REMOTE_SIGNER/);
  assert.equal((await verifyBundledEndpointAuthority({nowMs})).manifestVersion,endpointAuthorityPin.manifestVersion);
});
test('verified selection is brand-bound, immutable, expiry-checked and limited to RPC/Faucet',async()=>{
  const v=await validateEndpointAuthority(copy(),options);
  assert.equal(selectAuthorityEndpoint(v,'rpc',{nowMs}),v.rpc);assert.equal(selectAuthorityEndpoint(v,'faucet',{nowMs}),v.faucet);
  assert.throws(()=>selectAuthorityEndpoint(copy(),'rpc',{nowMs}),/NOT_VALIDATED/);
  assert.throws(()=>selectAuthorityEndpoint(v,'walletGateway',{nowMs}),/NOT_VERIFIED/);
  assert.throws(()=>selectAuthorityEndpoint(v,'rpc',{nowMs:Date.parse(v.expiresAt)}),/EXPIRED/);
  assert.throws(()=>{v.rpc='https://evil.invalid'});assert.throws(()=>{v.endpointStates.rpc.sourceCommit='0'.repeat(40)});
});
test('digest-await caller mutation cannot replace the accepted snapshot',async()=>{
  const v=copy();const result=await validateEndpointAuthority(v,{...options,digestSHA256:async text=>{v.rpc='https://evil.invalid';return sha256(text)}});
  assert.equal(result.rpc,'https://rpc-testnet.ynxweb4.com');
});
test('caller cannot switch the release pin during asynchronous digest verification',async()=>{
  const v=copy(),pin={...endpointAuthorityPin};v.acceptanceBoundary='tampered';
  await assert.rejects(validateEndpointAuthority(v,{...options,trustedPin:pin,digestSHA256:async text=>{pin.payloadSha256=sha256(text);return pin.payloadSha256}}),/HASH_MISMATCH/);
});
test('published JSON Schema and fixture share exact keys, endpoint allowlist and disabled Mainnet',()=>{
  const schema=json('chain-metadata/endpoint-authority/schema.json');
  assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required.sort(),Object.keys(copy()).sort());
  for(const key of ['rpc','evmRpc','faucet'])assert.equal(schema.properties[key].const,copy()[key]);
  assert.equal(schema.properties.mainnet.properties.enabled.const,false);
  assert.equal(schema.properties.integrity.properties.remoteSignature.properties.failClosed.const,true);
  assert.equal(schema.properties.endpointStates.properties.products.properties.finance.properties.status.const,'PENDING');
});
test('WebCrypto and injected native digest agree; unavailable/wrong digest fails closed',async()=>{
  assert.equal((await validateEndpointAuthority(copy(),{trustedPin:endpointAuthorityPin,nowMs})).integrity.payloadSha256,endpointAuthorityPin.payloadSha256);
  await assert.rejects(validateEndpointAuthority(copy(),{...options,digestSHA256:()=> '0'.repeat(64)}),/HASH_MISMATCH/);
});
test('native digest integration needs no Node Buffer or TextEncoder polyfill; absent crypto fails closed',async()=>{
  const encoder=globalThis.TextEncoder;
  try{globalThis.TextEncoder=undefined;
    assert.equal((await validateEndpointAuthority(copy(),options)).manifestVersion,endpointAuthorityPin.manifestVersion);
    await assert.rejects(validateEndpointAuthority(copy(),{trustedPin:endpointAuthorityPin,nowMs}),/SHA256_UNAVAILABLE/);
  }finally{globalThis.TextEncoder=encoder;}
});
test('unknown fields, URL lookalikes, oversized JSON, invalid timestamps and unverified promotion are rejected',async()=>{
  for(const [mutate,code] of [
    [v=>{v.rpc='https://rpc-testnet.ynxweb4.com.evil.invalid'},'ALLOWLIST'],
    [v=>{v.rpc='http://rpc-testnet.ynxweb4.com'},'ALLOWLIST'],
    [v=>{v.extra='x'},'FIELDS'],[v=>{v.endpointStates.extra={}},'ENDPOINT_KEYS'],
    [v=>{v.endpointStates.rpc.verifiedAt='2026-02-30T08:55:00.000Z'},'INVALID_TIME'],
    [v=>{v.endpointStates.rest.status='VERIFIED'},'UNVERIFIED_PROMOTION'],
    [v=>{v.acceptanceBoundary='x'.repeat(65536)},'TOO_LARGE'],
    [v=>{v.integrity.remoteSignature.failClosed=false},'REMOTE_SIGNER'],
    [v=>{v.legacyCompatibility.rpc.sourceCommit='0'.repeat(40)},'LEGACY_IDENTITY']
  ]){const v=copy();mutate(v);await assert.rejects(validateEndpointAuthority(v,options),new RegExp(code));}
  for(const now of [NaN,Infinity,'2026-09-20',-1])assert.throws(()=>assertEndpointAuthorityStructure(copy(),{nowMs:now}),/INVALID_NOW/);
});
test('release is reproducible from hash-bound evidence and bundled bytes are exact',async()=>{
  const {pin,manifest}=await loadEndpointAuthorityRelease(root);
  assert.deepEqual(manifest,bundledEndpointAuthority);assert.deepEqual(pin,endpointAuthorityPin);
  execFileSync(process.execPath,['scripts/ops/generate-endpoint-authority-bundle.mjs','--check'],{cwd:root});
});
const evidence=json(bundledEndpointAuthority.sourceEvidence.path);
const issue=(e=evidence)=>buildEndpointAuthority({evidence:e,evidencePath:bundledEndpointAuthority.sourceEvidence.path,evidenceSHA256:bundledEndpointAuthority.sourceEvidence.sha256,
  version:'20260920.1',sourceCommit:bundledEndpointAuthority.sourceCommit,issuedAt:bundledEndpointAuthority.issuedAt,expiresAt:bundledEndpointAuthority.expiresAt});
for(const [name,mutate] of [
  ['failed sample',e=>{e.refresh.probes[0].ready=false}],['incomplete',e=>{e.refresh.complete=false}],
  ['duplicate round',e=>{e.refresh.probes[4].round=1}],['version mismatch',e=>{e.refresh.probes[0].buildCommit='0'.repeat(40)}],
  ['proxy',e=>{e.refresh.probes[0].client.proxy_used=1}],['wrong chain',e=>{e.refresh.probes[0].chainId=1}],
  ['unverified TLS',e=>{e.refresh.probes[0].client.ssl_verify_result=1}],['pinned-origin-only',e=>{e.refresh.pathMode='pinned-public-origin'}],
  ['stale evidence',e=>{e.refresh.finishedAt='2026-08-20T08:55:00.000Z'}],['wrong deployment hash',e=>{e.priorControlledDeployment.sourceSHA256='0'.repeat(64)}],
  ['prior version drift',e=>{e.priorControlledDeployment.currentRPCCommit='0'.repeat(40)}],['missing chain continuity',e=>{e.priorControlledDeployment.comparisonStableAcrossGrowth=false}]
])test(`issuer rejects ${name}`,()=>{const e=structuredClone(evidence);mutate(e);assert.throws(()=>issue(e));});
test('issuance is exclusive: cannot rewrite an existing version',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-authority-issue-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  // Existing-version refusal uses the real fixed version. All write bytes must remain unchanged.
  const file=path.join(root,endpointAuthorityPin.manifestPath),before=fs.readFileSync(file);
  const result=spawnSync(process.execPath,['scripts/ops/issue-endpoint-authority.mjs','--version','20260920.1','--source-commit',bundledEndpointAuthority.sourceCommit,'--issued-at',bundledEndpointAuthority.issuedAt,'--expires-at',bundledEndpointAuthority.expiresAt],{cwd:root,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.deepEqual(fs.readFileSync(file),before);
});

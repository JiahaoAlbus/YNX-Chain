import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, realpath, chmod, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createProductSessionRequest, signProductSessionApproval, ProductSessionAuthority, signProductSessionChallengeWith } from '../../vendor/wallet-auth/src/product-session-v2.js';
import { createProductSessionProofV2With, productSessionProofV2SignBytes } from '../../vendor/wallet-auth/src/product-session-proof-v2.js';
import { canonicalJSON } from '../../vendor/wallet-auth/src/canonical.js';
import { httpBodyDigest } from '../../vendor/wallet-auth/src/session-proof.js';

const here = dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(readFileSync(join(here, '../../vendor/wallet-auth/product-session-registry.json')));
const encoded = value => Buffer.from(value).toString('base64url');

test('real Keychain P256 signer consumes retained SDK; binding refusals, callback ownership, restart continuity and cleanup', {timeout: 45000}, async () => {
  const root = await realpath(await mkdtemp('/private/tmp/ynx-native-wallet-QA-')); await chmod(root, 0o700);
  const binary = join(root, 'native-test'), id = randomUUID();
  const tag = `com.ynxweb4.developer.QA-device-${id}`, service = `com.ynxweb4.developer.QA-state-${id}`;
  execFileSync('/usr/bin/clang', ['-fobjc-arc', '-mmacosx-version-min=13.5', '-Werror=unguarded-availability', '-Werror=unguarded-availability-new', join(here, 'wallet-device-bridge-test.m'), '-o', binary, '-framework', 'Cocoa', '-framework', 'Security', '-framework', 'WebKit']);
  const run = mode => JSON.parse(execFileSync(binary, [mode, tag, service, root], {encoding:'utf8', timeout:10000}));
  let child;
  try {
    const device = run('device'); assert.equal(run('device').key, device.key, 'two process launches use the same Keychain public key');
    const at = new Date(), nonce = encoded(Buffer.alloc(32,1)), state = encoded(Buffer.alloc(32,2));
    const request = createProductSessionRequest(registry, {productId:'developer', platform:'macos', deviceId:device.id, deviceKey:device.key, scopes:['account:read','developer:deploy'], purpose:'Native QA SDK fixture, never a real account', nonce, state}, at);
    const approval = signProductSessionApproval(registry, request, {accountSecret:'01'.repeat(32), scopes:request.scopes, expiresAt:request.expiresAt}, at);
    const authority = new ProductSessionAuthority(registry);
    const challenge = authority.issueChallenge({request, approval, challenge:encoded(Buffer.alloc(32,3))}, at);
    const route = `ynxwallet://authorize?request=${encoded(canonicalJSON(request))}`;
    const callback = `${request.callback}?${new URLSearchParams({result:'approved', nonce, state, approval:encoded(canonicalJSON(approval))})}`;
    child = spawn(binary, ['scenario',tag,service,root], {stdio:['pipe','pipe','pipe']});
    let stderr = ''; child.stderr.on('data', data => {stderr += data;});
    const lines = [], pending = []; const reader = createInterface({input:child.stdout});
    reader.on('line', text => {const value=JSON.parse(text);pending.length?pending.shift().resolve(value):lines.push(value);});
    const done = new Promise((resolve,reject) => {child.on('error',reject);child.on('exit', code => {if(code===0)resolve();else {const error=new Error(`native fixture exit ${code}: ${stderr}`);for(const waiter of pending.splice(0))waiter.reject(error);reject(error);}});});
    done.catch(()=>{});
    const next = () => lines.length?Promise.resolve(lines.shift()):new Promise((resolve,reject)=>pending.push({resolve,reject}));
    const completion = await signProductSessionChallengeWith(challenge, async input => {
      child.stdin.write(JSON.stringify({request,route,callback,input,challenge})+'\n');
      const result=await next();assert.equal(result.publicKey,device.key);return result.signature;
    });
    // The actual retained SDK cryptographically checks the SecKey DER signature,
    // then its local authority fixture derives a legitimate synthetic session.
    const session = authority.complete({request,approval,completion}, at);
    const proofInput = {method:'POST',path:'/v2/product-sessions/introspect',bodyDigest:httpBodyDigest(canonicalJSON({requiredScopes:session.scopes})),nonce:encoded(Buffer.alloc(32,4)),issuedAt:at.toISOString(),expiresAt:new Date(at.getTime()+30000).toISOString()};
    let final;
    const proof = await createProductSessionProofV2With(session, proofInput, async input => {
      const unsigned=JSON.parse(Buffer.from(input.payload,'base64url').toString().split('\n')[1]);
      const resumeUnsigned={...unsigned,nonce:encoded(Buffer.alloc(32,5))};
      const resumeInput={...input,payload:encoded(productSessionProofV2SignBytes(resumeUnsigned))};
      child.stdin.write(JSON.stringify({session,proofInput:input,resumeInput,
        wrongPathPayload:encoded(productSessionProofV2SignBytes({...unsigned,path:'/ide/deploy',nonce:encoded(Buffer.alloc(32,6))})),
        wrongBodyPayload:encoded(productSessionProofV2SignBytes({...unsigned,bodyDigest:'0'.repeat(64),nonce:encoded(Buffer.alloc(32,7))}))})+'\n');
      final=await next();return final.proofSignature;
    });
    assert.equal(proof.deviceKey,device.key);
    const restored = await createProductSessionProofV2With(session,{...proofInput,nonce:encoded(Buffer.alloc(32,5))},async()=>final.resumeSignature);
    assert.equal(restored.sessionBinding,session.sessionBinding);
    child.stdin.end();await done;
    assert.equal(run('device').key,device.key, 'native device persists across another restart/loopback port assignment');
  } finally {
    if(child?.exitCode===null) {child.kill();await new Promise(resolve=>child.once('exit',resolve));}
    assert.deepEqual(run('cleanup'),{cleaned:true}); // deletes only this randomly tagged QA key/service
    await rm(root,{recursive:true,force:true});
  }
});

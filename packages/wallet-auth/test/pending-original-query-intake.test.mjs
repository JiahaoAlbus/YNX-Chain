// Normal SDK module composition only. Original Auth SQLite/DATA 15 groups are
// pinned and reused; do not create a DB/WAL or rerun those groups here.
import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import * as query from '../src/product-pair-pending-original-query-data.mjs';
import * as originalStore from '../src/product-pair-session-v4-store.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('actual same SDK module imports DATA port and original store without opening SQLite',async()=>{
 assert.equal(await import(new URL('../src/product-pair-pending-original-query-data.mjs',import.meta.url)),query);
 assert.equal(typeof originalStore.openProductPairSessionV4Store,'function');
 const c=query.PENDING_ORIGINAL_QUERY_CONTRACT;assert.equal(c.method,'POST');assert.equal(c.path,'/v4/product-pairs/original-query');assert.equal(c.domain,'YNX/PRODUCT-PAIR/PENDING-ORIGINAL-QUERY/V1');assert.equal(c.purpose,'product-device-pending-original-query-v1');assert.equal(c.sessionBinding,false);assert.equal(c.readOnly,true);assert.equal(Object.isFrozen(c),true);
 const operationId='ab'.repeat(32),actor='cd'.repeat(32),originalPairPost=Buffer.from('{"operationId":"'+operationId+'","registrationOriginal":"PUBLIC only","request":{"purpose":"normal package intake"}}'),originalRequestBodyDigest=sha(originalPairPost),raw=Buffer.from(JSON.stringify({operationId,originalRequestBodyDigest,version:'1'}));
 const d=query.decodePendingPairOriginalQueryDATA(raw);assert.equal(d.operationId,operationId);assert.equal(d.originalRequestBodyDigest,originalRequestBodyDigest);assert.equal(d.queryBodyDigest,sha(raw));
 const historical='{"challenge":{"expiresAt":"2000-01-01T00:00:00.000Z"}}',result=query.projectPendingPairOriginalQueryDATA(raw,originalPairPost,actor,{operation_id:operationId,actor_digest:actor,kind:'PAIR',input_sha256:originalRequestBodyDigest,input_original:originalPairPost.toString(),phase:'COMMITTED',result_original:historical});
 assert.equal(result.original,historical);assert.equal(result.state,'OBSERVED');for(const k of ['authorized','sourceAdmission','nativeAdmission','registered','connected','newSession','retryAuthorized'])assert.equal(result[k],false);
 assert.equal(Object.hasOwn(query,'acquireOriginalSource'),false);assert.equal(Object.hasOwn(query,'sign'),false);
});
test('normal store/source bytes match exact supplier CAS and unchanged schema',()=>{
 const relative=n=>readFileSync(new URL('../src/'+n,import.meta.url));
 assert.equal(sha(relative('product-pair-pending-original-query-data.mjs')),'50389aa1dcde64e2d1336ee4a37e72a395a45dce715c776f9a44b1a306e793ae');
 assert.equal(sha(relative('product-pair-session-v4-store.js')),'2c10d2fc8670d05af4877006db402833c1d38a11f0db7841a7efea645cda1a76');
 assert.equal(sha(relative('product-pair-session-v4-schema.sql')),'577420f566509bfcedb0fa0094a7d05a40fee0831cf156ab043c6769ec4bee6c');
});

test('normal transport module consumes actual independently expected service origin and explicit time',async()=>{
 const transport=await import('../src/product-pair-pending-query-transport-data.mjs'),at=Date.parse('2026-11-01T01:00:00.000Z'),origin='https://wallet-auth.ynxweb4.com',value={nonce:'N'.repeat(32),issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+30000).toISOString(),serviceOrigin:origin};
 assert.equal(transport,await import(new URL('../src/product-pair-pending-query-transport-data.mjs',import.meta.url)));assert.equal(sha(readFileSync(new URL('../src/product-pair-pending-query-transport-data.mjs',import.meta.url))),'91780b5643740b7269cedc2f39bf42091b49c1f5336bf1b65edcfc0a4b1f8033');
 const r=transport.inspectPendingPairQueryTransportDATA(value,origin,at);assert.equal(r.authorized,false);assert.equal(r.sourceAdmission,false);assert.equal(r.sessionGranted,false);assert.equal(transport.PENDING_QUERY_TRANSPORT_RULES.maxWindowMs,30000);
 assert.throws(()=>transport.inspectPendingPairQueryTransportDATA(value,'https://product.example',at),{code:'PENDING_QUERY_TRANSPORT_DATA_REFUSED'});
});

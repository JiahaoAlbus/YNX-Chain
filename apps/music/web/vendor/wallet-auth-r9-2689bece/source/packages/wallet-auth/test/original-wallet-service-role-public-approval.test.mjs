import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// PUBLIC lexical codec. Hash/key/Ed25519 primitives are explicit TEST_ONLY
// substitutes; no key generation, signature verification/signing or files.
function fixture(){
 const text=readFileSync(new URL('../src/original-wallet-service-role-enrollment-state.js',import.meta.url),'utf8');let valid=true,verifies=0;
 const context={Buffer,types:{isProxy:()=>false},createHash:()=>({update(){return this;},digest(){return 'a'.repeat(64);}}),createPublicKey:()=>({PUBLIC_KEY:true}),verify:()=>{verifies++;return valid;}};
 vm.createContext(context);vm.runInContext(text.replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.make=createOriginalWalletServiceRolePublicApprovalVerifier;',context);
 const pub=Buffer.alloc(32,1).toString('base64url'),signature=Buffer.alloc(64,1).toString('base64url'),pin='a'.repeat(64);
 const config={rootAnchor:{rootId:'PUBLIC_ROOT',rootKeyId:'PUBLIC_KEY',publicKey:pub,purpose:'wallet-product-session-v2-admission-publisher/v1'},registryDigest:pin,targetConsumerManifestDigest:pin,gatewayManifestDigest:pin,holderPublicKey:pub,operationId:'PUBLIC_OP'};
 const review={version:'ynx-wallet-service-role-enrollment-review/v1',purpose:config.rootAnchor.purpose,service:'wallet-product-session-v2',productId:'developer',platform:'macos',gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:pin,targetConsumerManifestDigest:pin,gatewayManifestDigest:pin,rootId:'PUBLIC_ROOT',rootKeyId:'PUBLIC_KEY',holderPublicKey:pub,operationId:'PUBLIC_OP',nonce:pub,issuedAt:1000,expiresAt:2000};
 const readback={version:1,holderPublicKey:pub,rootAnchor:config.rootAnchor,operations:[{review,state:'approved'}],history:[{operationId:'PUBLIC_OP',observedAt:1500,receipt:{body:{...review,version:'ynx-wallet-service-role-enrollment-receipt/v1',decision:'approved',reviewDigest:pin,roleExpiresAt:10000},signature}}]};
 const into=value=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(value))+')',context);
 return {make:()=>context.make(into(config)),config,readback,into,invalidSignature(){valid=false;},verifies:()=>verifies};
}
test('R8 PUBLIC original Root receipt readback verifies selected statement without private fields or current grant',()=>{
 const f=fixture(),api=f.make(),result=api.verify(f.into(f.readback),3000);assert.equal(result.holderPublicKey,f.config.holderPublicKey);assert.equal(result.targetConsumerManifestDigest,'a'.repeat(64));assert.equal(result.nativeQualified,false);assert.equal(result.originalLatestSourceRequired,true);assert.equal(f.verifies(),1);assert.equal(Object.isFrozen(result),true);assert.throws(()=>api.assertCurrent(),/CURRENT_SOURCE_NOT_IMPLEMENTED/);api.retire();assert.throws(()=>api.verify(f.into(f.readback),3000),/RETIRED/);
});
test('R8 PUBLIC rejects holder/Root/consumer/registry mismatch, signature denial and private-key injection',()=>{
 const f=fixture();for(const change of [s=>{s.holderPublicKey=Buffer.alloc(32,2).toString('base64url');},s=>{s.rootAnchor.rootId='OTHER';},s=>{s.operations[0].review.targetConsumerManifestDigest='b'.repeat(64);},s=>{s.operations[0].review.registryDigest='b'.repeat(64);},s=>{s.privateKeyPKCS8='PUBLIC_NOT_KEY';}]){const s=JSON.parse(JSON.stringify(f.readback));change(s);assert.throws(()=>f.make().verify(f.into(s),3000));}f.invalidSignature();assert.throws(()=>f.make().verify(f.into(f.readback),3000),/RECEIPT_INVALID/);
});
test('R8 PUBLIC revoked/expired/duplicated/tampered history refuses; authentic old history never claims latest',()=>{
 const f=fixture();for(const change of [s=>{s.history[0].receipt.body.decision='revoked';s.operations[0].state='revoked';},s=>{s.history.push(s.history[0]);},s=>{s.history[0].receipt.body.reviewDigest='b'.repeat(64);},s=>{s.history[0].observedAt=4000;}]){const s=JSON.parse(JSON.stringify(f.readback));change(s);assert.throws(()=>f.make().verify(f.into(s),3000));}assert.throws(()=>f.make().verify(f.into(f.readback),10000),/NOT_APPROVED/);const old=f.make().verify(f.into(f.readback),3000);assert.equal(old.originalLatestSourceRequired,true);assert.equal(old.nativeQualified,false);
});
test('R9 PUBLIC F4 ordered history and review settlement window, not role verification window',()=>{
 const f=fixture(),s=JSON.parse(JSON.stringify(f.readback));
 const review={...s.operations[0].review,operationId:'PUBLIC_SECOND',nonce:Buffer.alloc(32,2).toString('base64url')};
 s.operations.push({review,state:'revoked'});
 const revoked={operationId:'PUBLIC_SECOND',observedAt:1500,receipt:{body:{...review,version:'ynx-wallet-service-role-enrollment-receipt/v1',decision:'revoked',reviewDigest:'a'.repeat(64),roleExpiresAt:10000},signature:s.history[0].receipt.signature}};
 s.history=[revoked,{...s.history[0],observedAt:1600}];assert.throws(()=>f.make().verify(f.into(s),3000));
 for(const observedAt of [999,2000,3500]){const late=JSON.parse(JSON.stringify(f.readback));late.history[0].observedAt=observedAt;assert.throws(()=>f.make().verify(f.into(late),4000));}
 assert.equal(f.make().verify(f.into(f.readback),4000).nativeQualified,false);
});

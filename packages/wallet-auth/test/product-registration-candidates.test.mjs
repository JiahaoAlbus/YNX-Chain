import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {p256} from '@noble/curves/nist.js';
import {parseProductSessionRegistry,productPlatformBinding} from '../src/product-session-registry.js';
import {createCentralBrowserSessionRegistry} from '../src/central-browser-session-registry.js';
import {parseCentralRegistryDocument,centralRegistrationByProduct} from '../src/registry.js';
import {ProductSessionAuthority,createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge} from '../src/product-session-v2.js';
import {createProductSessionProofV2,verifyProductSessionProofV2} from '../src/product-session-proof-v2.js';
import {httpBodyDigest} from '../src/session-proof.js';
const document=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url)));
const baseline=JSON.parse(readFileSync(new URL('fixtures/product-session-registry-c09.json',import.meta.url)));
const registry=parseProductSessionRegistry(document),device=new Uint8Array(32).fill(7),secret=Buffer.from(device).toString('base64url'),at=new Date('2026-10-03T00:00:00.000Z');
function fresh(platform='android',scopes=['music.library']){
 const request=createProductSessionRequest(registry,{productId:'music',platform,deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes,purpose:'Explicit Music private review',nonce:'b'.repeat(43),state:'c'.repeat(43)},at);
 const approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes,expiresAt:request.expiresAt},at);
 const authority=new ProductSessionAuthority(registry),challenge=authority.issueChallenge({request,approval,challenge:'d'.repeat(43)},at);
 const session=authority.complete({request,approval,completion:signProductSessionChallenge(challenge,secret)},at);
 const context={...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,session[k]])),requiredScopes:scopes};
 return {request,approval,authority,session,context};
}
test('Music candidate admits exact original Native and newly registered Web/macOS tuples',()=>{
 const music=registry.products.find(p=>p.productId==='music');assert.deepEqual(music.platforms,['android','ios','macos','web']);assert.deepEqual(music.scopes,['music.creator','music.library','music.playback','music.profile']);
 for(const platform of ['android','ios','macos']){const b=productPlatformBinding(registry,'music',platform);assert.equal(b.clientId,'ynx-music-v1');assert.equal(b.applicationId,'com.ynxweb4.music');assert.equal(b.callback,'ynxmusic://auth/callback');assert.equal(b.origin,`app://${platform}/com.ynxweb4.music`);const f=fresh(platform);assert.equal(f.session.platform,platform);}
 const web=productPlatformBinding(registry,'music','web');assert.equal(web.applicationId,'com.ynxweb4.music.web');assert.equal(web.origin,'https://music.ynxweb4.com');assert.equal(web.callback,'https://music.ynxweb4.com/wallet-auth/callback');assert.equal(fresh('web').session.platform,'web');
 for(const platform of ['unknown','linux','windows'])assert.throws(()=>productPlatformBinding(registry,'music',platform));
});
test('existing products and six/default thirteen/opt-in identity consent do not change',()=>{
 const previous=parseProductSessionRegistry(baseline);
 for(const product of previous.products){const current=registry.products.find(p=>p.productId===product.productId);if(product.productId==='shop')assert.deepEqual(current,{...product,scopes:[...product.scopes,'shop:seller:operate']});else if(product.productId==='pay')assert.deepEqual(current,{...product,platforms:['android','ios','linux','macos','windows']});else if(product.productId==='music')assert.deepEqual(current,{...product,platforms:['android','ios','macos','web']});else assert.deepEqual(current,product);for(const platform of product.platforms??['android','ios','linux','macos','web','windows']){if(product.productId==='pay'&&platform==='web'){assert.throws(()=>productPlatformBinding(registry,'pay','web'));continue;}const expected=productPlatformBinding(previous,product.productId,platform);assert.deepEqual(productPlatformBinding(registry,product.productId,platform),product.productId==='shop'?{...expected,scopes:[...expected.scopes,'shop:seller:operate']}:expected);}}
 for(const ecosystem of [false,true]){const current=createCentralBrowserSessionRegistry(registry,{ecosystem});assert.equal(current.length,ecosystem?13:6);assert.deepEqual(current,createCentralBrowserSessionRegistry(previous,{ecosystem}));assert(current.every(c=>c.productId!=='music'&&c.scopes.join()==='identity:read'));}
 const central=parseCentralRegistryDocument(JSON.parse(readFileSync(new URL('../central-registry.json',import.meta.url))));for(const product of ['music','seller-console','merchant-console'])assert.throws(()=>centralRegistrationByProduct(central,product));
});
test('Music read grant never upgrades to creator scope when full registry is available',()=>{
 const f=fresh();const before=f.authority.snapshot();assert.deepEqual(f.authority.introspect(f.session.sessionBinding,f.context,at).session.scopes,['music.library']);
 assert.throws(()=>f.authority.introspect(f.session.sessionBinding,{...f.context,requiredScopes:['music.creator']},at));assert.deepEqual(f.authority.snapshot(),before);
 assert.throws(()=>f.authority.introspect(f.session.sessionBinding,{...f.context,productId:'social',clientId:'ynx-social-v1'},at));
 assert.throws(()=>signProductSessionApproval(registry,f.request,{accountSecret:'1'.padStart(64,'0'),scopes:['music.creator'],expiresAt:f.request.expiresAt},at));
 // Frozen Music's thirteen-field v1 request is not a V2 Product Session request.
 const legacy={version:'1',nonce:f.request.nonce,chainId:'ynx_6423-1',requestingProduct:'music',productClientId:'ynx-music-v1',bundleId:'com.ynxweb4.music',productDeviceAlgorithm:'p256-sha256',productDeviceKey:f.request.deviceKey,callback:'ynxmusic://auth/callback',scopes:['music.library'],purpose:f.request.purpose,issuedAt:f.request.issuedAt,expiresAt:f.request.expiresAt};
 assert.throws(()=>f.authority.issueChallenge({request:legacy,approval:f.approval,challenge:'e'.repeat(43)},at));
});
test('Music route proof binds exact original body, platform, method and path',()=>{
 const f=fresh(),body='{"trackId":"owner-track"}',path='/api/playlists';
 const proof=createProductSessionProofV2(f.session,{method:'POST',path,bodyDigest:httpBodyDigest(body),nonce:'f'.repeat(43),issuedAt:at.toISOString(),expiresAt:new Date(+at+30000).toISOString()},secret);
 verifyProductSessionProofV2(proof,f.session,{method:'POST',path,bodyDigest:httpBodyDigest(body)},at);
 for(const patch of [{method:'PUT'},{path:'/api/creator/tracks'},{bodyDigest:httpBodyDigest('{}')}])assert.throws(()=>verifyProductSessionProofV2(proof,f.session,{method:'POST',path,bodyDigest:httpBodyDigest(body),...patch},at));
 assert.throws(()=>verifyProductSessionProofV2(proof,{...f.session,platform:'ios',origin:'app://ios/com.ynxweb4.music'}, {method:'POST',path,bodyDigest:httpBodyDigest(body)},at));
});
test('explicit callback and native platform subset are exact and default compatible',()=>{
 const candidate=structuredClone(baseline);const p=candidate.products.find(p=>p.productId==='mail');p.webCallback='https://mail.ynxweb4.com/private/wallet-auth/callback';assert.equal(productPlatformBinding(candidate,'mail','web').callback,p.webCallback);
 for(const webCallback of ['https://social.ynxweb4.com/wallet-auth/callback','ynxmail://wallet-auth/callback','https://mail.ynxweb4.com/private?x=1','https://mail.ynxweb4.com/private/../callback','https://mail.ynxweb4.com/%63allback']){const bad=structuredClone(candidate);bad.products.find(p=>p.productId==='mail').webCallback=webCallback;assert.throws(()=>parseProductSessionRegistry(bad));}
 for(const platforms of [[],['ios','android'],['android','android'],['other'],['android']]){const bad=structuredClone(document);const p=bad.products.find(p=>p.productId==='music');p.platforms=platforms;if(platforms.join()==='android'){p.webCallback='https://music.ynxweb4.com/wallet-auth/callback';}assert.throws(()=>parseProductSessionRegistry(bad));}
 const nativeOnly=structuredClone(document);nativeOnly.products.find(p=>p.productId==='music').nativeCallback=null;assert.throws(()=>parseProductSessionRegistry(nativeOnly));
});

test('Merchant has sole Pay Web tuple; old Pay native tuples remain and merchant native is deferred',()=>{
 const b=productPlatformBinding(registry,'pay-merchant','web');assert.equal(b.clientId,'ynx-merchant-console-v1');assert.equal(b.applicationId,'com.ynxweb4.merchant-console.web');assert.equal(b.origin,'https://pay.ynxweb4.com');assert.equal(b.callback,'https://pay.ynxweb4.com/merchant/wallet-auth/callback');assert.deepEqual(b.scopes,['account:read','merchant:session:create']);assert.equal(b.sessionDurationSeconds,240);
 for(const platform of ['android','ios','linux','macos','windows'])assert.throws(()=>productPlatformBinding(registry,'pay-merchant',platform));
 assert.throws(()=>productPlatformBinding(registry,'merchant-console','web'));assert.throws(()=>productPlatformBinding(registry,'seller-console','web'));
 const conflicting=structuredClone(document);delete conflicting.products.find(p=>p.productId==='pay').platforms;assert.throws(()=>parseProductSessionRegistry(conflicting));
});
test('old Shop Buyer approval stays Buyer after Seller scope is registered; fresh Seller approval is separate',()=>{
 const previous=parseProductSessionRegistry(baseline),authority=new ProductSessionAuthority(previous),scopes=['account:read','shop:orders:write','shop:profile:write'];
 const request=createProductSessionRequest(previous,{productId:'shop',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes,purpose:'Buyer only',nonce:'b'.repeat(43),state:'c'.repeat(43)},at),approval=signProductSessionApproval(previous,request,{accountSecret:'1'.padStart(64,'0'),scopes,expiresAt:request.expiresAt},at),challenge=authority.issueChallenge({request,approval,challenge:'d'.repeat(43)},at),session=authority.complete({request,approval,completion:signProductSessionChallenge(challenge,secret)},at);
 const upgraded=new ProductSessionAuthority(registry,authority.snapshot()),context={...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,session[k]])),requiredScopes:scopes};
 assert.deepEqual(upgraded.introspect(session.sessionBinding,context,at).session.scopes,scopes);assert.throws(()=>upgraded.introspect(session.sessionBinding,{...context,requiredScopes:['account:read','shop:seller:operate']},at));
 assert.throws(()=>signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:['account:read','shop:seller:operate'],expiresAt:request.expiresAt},at));
 const seller=createProductSessionRequest(registry,{productId:'shop',platform:'web',deviceId:request.deviceId,deviceKey:request.deviceKey,scopes:['account:read','shop:seller:operate'],purpose:'Explicit Seller capability',nonce:'e'.repeat(43),state:'f'.repeat(43)},at);assert.equal(seller.applicationId,session.applicationId);assert.equal(seller.callback,session.callback);assert.notDeepEqual(seller.scopes,session.scopes);
});
test('disabling new Pay Web admission preserves original active history and never recasts it to Merchant',()=>{
 const previous=parseProductSessionRegistry(baseline),authority=new ProductSessionAuthority(previous),scopes=previous.products.find(p=>p.productId==='pay').scopes;
 const request=createProductSessionRequest(previous,{productId:'pay',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes,purpose:'Original consumer Pay',nonce:'b'.repeat(43),state:'c'.repeat(43)},at),approval=signProductSessionApproval(previous,request,{accountSecret:'1'.padStart(64,'0'),scopes,expiresAt:request.expiresAt},at),challenge=authority.issueChallenge({request,approval,challenge:'d'.repeat(43)},at),session=authority.complete({request,approval,completion:signProductSessionChallenge(challenge,secret)},at);
 const original=authority.snapshot(),upgraded=new ProductSessionAuthority(registry,original),context={...Object.fromEntries(['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceKey'].map(k=>[k,session[k]])),requiredScopes:scopes};
 assert.deepEqual(upgraded.snapshot(),original);assert.deepEqual(upgraded.introspect(session.sessionBinding,context,at).session,session);
 assert.throws(()=>createProductSessionRequest(registry,{productId:'pay',platform:'web',deviceId:request.deviceId,deviceKey:request.deviceKey,scopes,purpose:request.purpose,nonce:'e'.repeat(43),state:'f'.repeat(43)},at));
 const merchant=productPlatformBinding(registry,'pay-merchant','web');assert.throws(()=>upgraded.introspect(session.sessionBinding,{...context,productId:merchant.productId,clientId:merchant.clientId,applicationId:merchant.applicationId,callback:merchant.callback,requiredScopes:['merchant:session:create']},at));
 upgraded.revokeSession(session.sessionBinding);assert.throws(()=>upgraded.introspect(session.sessionBinding,context,at));
});

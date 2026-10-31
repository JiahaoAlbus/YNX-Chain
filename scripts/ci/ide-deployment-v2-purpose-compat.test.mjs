import test,{after}from'node:test';import assert from'node:assert/strict';import path from'node:path';import fs from'node:fs';
import{createPurposeFixtureContext}from'./fixtures/ide-deployment-v2-purpose.fixture.mjs';
const packageRoot=process.env.YNX_IDE_DEPLOYMENT_COMPAT_PACKAGE??path.resolve(import.meta.dirname,'../../packages/wallet-auth'),ctx=await createPurposeFixtureContext(packageRoot);after(()=>ctx.close());const red=[];
function refused(label,run,expected){let error;try{run()}catch(e){error=e}assert.ok(error,label+' must refuse');if(expected)assert.match(error.code??error.message,expected);red.push({label,code:error.code??null,message:error.message,expected:true});return error}
after(()=>{if(process.env.YNX_IDE_DEPLOYMENT_COMPAT_RED_FILE)fs.writeFileSync(process.env.YNX_IDE_DEPLOYMENT_COMPAT_RED_FILE,JSON.stringify({pins:ctx.pins,reproducedExpectedReds:red,mathematicsMocked:false,realRoot:false,NativeBuilt:false},null,2)+'\n')});
const query=ctx.fixture('query'),ide=ctx.fixture('ide');
// These exact credentials use real original portable dual-PQ signatures.
const querySigned=query.credentials(),ideSigned=ide.credentials();
test('raw new Auth missing Query is a preserved RED; merged Query passes actual profile/current entrypoints',()=>{
 refused('raw42561 lacks Query family',()=>ctx.profile(ctx.rawAuth,querySigned));
 const profile=ctx.profile(ctx.merged,querySigned),current=ctx.current(ctx.merged,querySigned);assert.equal(profile.profile.purpose,'product-session-device-query-source-v4');assert.equal(profile.profile.selection.productSessionDeviceV4Query.version,'4');assert.equal(current.selection.productSessionDeviceV4Query.stableDeviceIdentity,query.scope.stableDeviceIdentity);assert.equal(current.head,ctx.sha(ctx.canonical(query.scope)));assert.equal(current.dataOnly,true);assert.equal(current.nativeAdmission,false);
});
test('exclusive chain fixes independent-if device misrefusal with real signed query profile and current',()=>{
 refused('controlled independent-if device profile misrefusal',()=>ctx.profile(ctx.independentIf,querySigned),/AUTH_SOURCE_V2_DEVICE_DEDICATED_PURPOSE_REQUIRED/);refused('controlled independent-if device current misrefusal',()=>ctx.current(ctx.independentIf,querySigned),/AUTH_SOURCE_V2_DEVICE_DEDICATED_PURPOSE_REQUIRED/);
 assert.equal(ctx.current(ctx.merged,querySigned).status,'active');
});
test('IDE E11 actual profile/current passes on raw supplier and merged verifier without losing new purpose',()=>{
 for(const verifier of [ctx.rawAuth,ctx.merged]){const p=ctx.profile(verifier,ideSigned),c=ctx.current(verifier,ideSigned);assert.equal(p.profile.purpose,'ide-deployment-authority-v2');assert.equal(c.selection.ideDeploymentV2.version,'ynx-ide-deployment-source/v2');assert.equal(c.head,ctx.sha(ctx.canonical(ide.scope)));assert.equal(c.dataOnly,true);assert.equal(c.nativeAdmission,false)}
});
test('cross-purpose valid source credentials refuse in both directions rather than sharing authority',()=>{
 refused('Query root/enrollment cannot consume IDE profile',()=>ctx.profile(ctx.merged,{...querySigned,profileRaw:ideSigned.profileRaw}));refused('IDE root/enrollment cannot consume Query profile',()=>ctx.profile(ctx.merged,{...ideSigned,profileRaw:querySigned.profileRaw}));
 refused('Query current cannot be IDE current',()=>ctx.current(ctx.merged,{...querySigned,currentRaw:ideSigned.currentRaw}));refused('IDE current cannot be Query current',()=>ctx.current(ctx.merged,{...ideSigned,currentRaw:querySigned.currentRaw}));
});
test('signed profiles cannot carry cross-family scopes or change independently selected Query binding',()=>{
 const widenedQuery=query.credentials(p=>{p.selection.ideDeploymentV2=ide.scope}),widenedIDE=ide.credentials(p=>{p.selection.productSessionDeviceV4Query=query.scope}),wrongQueryAccount=query.credentials(p=>{p.selection.association.account='PUBLIC-forged-account'});
 refused('Query rejects IDE scope',()=>ctx.profile(ctx.merged,widenedQuery));refused('IDE rejects Query scope',()=>ctx.profile(ctx.merged,widenedIDE));refused('Query scope account remains bound',()=>ctx.current(ctx.merged,wrongQueryAccount));
});
test('Query and IDE dedicated current-head checks remain effective after real current signing',()=>{
 const badQuery=query.credentials(undefined,c=>{c.head='0'.repeat(64)}),badIDE=ide.credentials(undefined,c=>{c.head='0'.repeat(64)});
 refused('Query dedicated current head',()=>ctx.current(ctx.merged,badQuery),/AUTH_SOURCE_V2_DEVICE_QUERY_HEAD/);refused('IDE dedicated current head',()=>ctx.current(ctx.merged,badIDE),/IDE_DEPLOYMENT_V2_CURRENT_HEAD/);
});

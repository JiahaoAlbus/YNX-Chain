import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {SDK36_PRODUCT_PINS,readSDK36ProductRuntime,assertSDK36ProductArchive} from '../scripts/sdk36-product-runtime.mjs';
import {readSDK35ProductRuntime} from '../scripts/sdk35-product-runtime.mjs';
import {canonicalArchivePlan,SDK_ALIAS,SDK_CANONICAL,CANONICAL_MAIN} from '../scripts/canonical-package.mjs';
import {assertSDKRuntimePackCoverage} from '../scripts/release-provenance.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),supply=process.env.WALLET_AUTH36_NORMAL_SUPPLY;
test('actual36 formal five source slots map only new product bytes while preserving full source custody and exact missing lock',{skip:!supply},t=>{
 const addendum=fs.readFileSync(path.join(supply,'SDK36_FORMAL_PRODUCT_SOURCE_SLOTS_ADDENDUM.json'));assert.equal(addendum.length,4246);assert.equal(hash(addendum),'43db01d5fb53f57f947dc205d48e438082f0f39f2ec48dbfa490ca82e5a635f3');const a=JSON.parse(addendum),h=JSON.parse(fs.readFileSync(path.join(supply,'SDK36_NORMAL_PREFIX_AND_PRODUCT_RUNTIME_HANDOFF.json')));
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-product36-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const copy=(from,to)=>{const target=path.join(root,to);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(from,target);};
 for(const m of a.formalProductSourceSlots){assert.deepEqual(SDK36_PRODUCT_PINS[path.basename(m.sourceSlot)].sha256,m.ref.sha256);copy(m.ref.path,m.sourceSlot);}
 copy(h.runtime.Auth.manifest.path,'packages/wallet-auth/native/original-ide-auth-runtime-manifest.json');copy(h.runtime.union.manifest.path,'packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json');
 const app=path.join(root,'apps/wallet-desktop');fs.mkdirSync(app,{recursive:true});fs.copyFileSync(new URL('../package.json',import.meta.url),path.join(app,'package.json'));fs.writeFileSync(path.join(root,'packages/wallet-auth/package.json'),JSON.stringify({version:h.versionSDK}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'}),commit=()=>{git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC SDK36 fixed DATA');};git('init','-q');commit();
 assert.equal(readSDK35ProductRuntime(root,'HEAD'),null);const product=readSDK36ProductRuntime(root,'HEAD');assert.equal(product.selected.size,9566);assert.equal(product.authRows.size,556);assert.equal(product.unionRows.size,9417);assert.equal(product.excluded.size,15);assert.equal(product.public.Root,false);assert.equal(product.public.SourceQualified,false);assert(assertSDKRuntimePackCoverage(app,'HEAD').executableSDKRowsChecked>10);
 const missing='node_modules/.package-lock.json';copy(path.join(h.prefix,missing),'packages/wallet-auth/'+missing);
 const dataBefore=[...product.selected.values()].filter(r=>r.path!==missing).map(r=>({...r,path:SDK_ALIAS+'/'+r.path,type:'file',unpacked:false,executable:false,physicalMode:null})),meta=Buffer.from(JSON.stringify({main:CANONICAL_MAIN})),row=(p,b)=>({path:p,type:'file',unpacked:false,executable:false,physicalMode:null,bytes:b.length,sha256:hash(b)}),before=[...dataBefore,{path:SDK_ALIAS,type:'directory',unpacked:false},{...row('native/original-auth-identity.node',Buffer.from('PUBLIC no Native execution')),unpacked:true},row('package.json',meta),...product.manifestRows.map(r=>({path:SDK_ALIAS+r.path.slice(SDK_CANONICAL.length),type:'file',unpacked:false,executable:false,physicalMode:null,bytes:r.originalBytes,sha256:r.originalSHA256}))];
 const prepared=product.prepare(before);assert.equal(prepared.missing.size,1);assert.equal(hash(prepared.readAdditional(SDK_CANONICAL+'/'+missing)),product.selected.get(missing).sha256);const snapshot=JSON.stringify(before),after=canonicalArchivePlan(before,meta,[],prepared.manifestRows,prepared.dataRows,prepared.excludedRows).after;assert.equal(JSON.stringify(before),snapshot);assertSDK36ProductArchive(product,after);
 const foreign={...after.find(r=>r.type==='file'&&r.path.startsWith(SDK_CANONICAL+'/')),path:SDK_CANONICAL+'/native/foreign.mjs'};assert.throws(()=>assertSDK36ProductArchive(product,[...after,foreign]),{code:'SDK36_PRODUCT_UNLISTED_PACK_MEMBER'});
 const excluded={...foreign,path:SDK_CANONICAL+'/'+product.excluded.keys().next().value};assert.throws(()=>assertSDK36ProductArchive(product,[...after,excluded]),{code:'SDK36_PRODUCT_EXCLUDED_PACK_MEMBER'});
 const oldH=JSON.parse(fs.readFileSync(path.join(supply,'../sdk35-normal-supply/SDK35_CANONICAL_NORMAL_PREFIX_RUNTIME_ROLES_HANDOFF.json'))),old35=fs.readFileSync(oldH.runtime.union.path);fs.writeFileSync(path.join(root,'packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json'),old35);commit();assert.throws(()=>readSDK36ProductRuntime(root,'HEAD'),{code:'SDK36_PRODUCT_FULL_CUSTODY_DIFFERS'});
});

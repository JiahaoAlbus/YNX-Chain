// Public package readback only. No Source registration, Native build or account.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {generateAuthRuntimeClosure} from '../../packages/wallet-auth/scripts/auth-runtime-closure.mjs';
const root=path.resolve(import.meta.dirname,'../..'),pkg=root+'/packages/wallet-auth',out=root+'/wallet-main-namespace-package';
fs.mkdirSync(out,{recursive:true});
function run(cmd,args,options={}){const p=spawnSync(cmd,args,{encoding:'utf8',timeout:60000,...options});if(p.error)throw p.error;if(p.status!==0)throw Error(p.stderr||p.stdout||`exit ${p.status}`);return p.stdout;}
const sha=b=>createHash('sha256').update(b).digest('hex');
const packed=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',out],{cwd:pkg}))[0];
const archive=path.join(out,packed.filename),tmp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'wallet-source-package-'));
try{
 run('tar',['-xzf',archive,'-C',tmp]);
 const rows=[];
 for(const r of packed.files){const actual=fs.readFileSync(path.join(tmp,'package',r.path)),source=fs.readFileSync(path.join(pkg,r.path));assert.deepEqual(actual,source,r.path);rows.push({path:r.path,bytes:actual.length,sha256:sha(actual)});}
 const metadata=JSON.parse(fs.readFileSync(tmp+'/package/package.json'));
 assert.deepEqual(metadata.exports['./pq-native-pay-source'],{types:'./src/pq-native-pay-source.d.ts',browser:null,node:'./src/pq-native-pay-source.js',default:null});
 fs.mkdirSync(tmp+'/node_modules/@ynx-chain',{recursive:true});
 fs.symlinkSync(tmp+'/package',tmp+'/node_modules/@ynx-chain/wallet-auth','dir');
 fs.symlinkSync(pkg+'/node_modules',tmp+'/package/node_modules','dir');
 const publicControl=`import assert from'node:assert/strict';import{initializeOriginalWalletMainNamespaceV1 as initialize}from'@ynx-chain/wallet-auth/original-wallet-main-namespace-bootstrap';const attempt=initialize();assert.equal(typeof attempt.then,'undefined');assert.equal(attempt,initialize());for(const name of['retire','join','close','statusDATA'])assert.equal(typeof attempt[name],'function');const result=await attempt.completion;assert.equal(result.errorPresent,true);assert.equal(result.error.code,'AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED');assert.equal(result.MainRegistered,false);attempt.retire();await attempt.join();await attempt.close();assert.equal(attempt.statusDATA().closeComplete,true);console.log('actual packed owned startup; Root0 refused; same attempt drained');`;
 const stdout=run(process.execPath,['--input-type=module','-e',publicControl],{cwd:tmp});
 const contractControl=`import assert from'node:assert/strict';import*as m from'@ynx-chain/wallet-auth/wallet-pay-client-source-data';assert.equal(m.WALLET_NATIVE_PAY_CLIENT_SOURCE_PURPOSE,'wallet-native-pay-client-source-v1');const account='0x'+'11'.repeat(20),intent='npi_'+'ab'.repeat(24),binding={networkId:'bb'.repeat(32),account,hash:'0x'+'aa'.repeat(32),memberHash:'0x'+'cc'.repeat(32),operationId:'PUBLIC-op',target:{version:1,service:'pay',kind:'invoice_terms',intentId:intent,merchant:account,invoiceId:'public-invoice',requestPath:'/v5/pay/invoice-intents/'+intent+'/merchant-member'}};const scope={version:1,protectedResourceRef:'PUBLIC-reviewed-resource',bindings:[{binding,operations:['post_terms','get_intent'],untilMs:90}]};const result=m.inspectOriginalWalletPayClientScopeV1DATA(scope,binding.networkId,account,1,100,2);assert.equal(result.SourceAdmission,false);assert.equal(result.NativeAdmission,false);assert.equal(result.authorized,false);assert.throws(()=>m.inspectOriginalWalletPayClientScopeV1DATA({...scope,bindings:[]},binding.networkId,account,1,100,2));console.log('packed original wire DATA contract; no authority granted');`;
 const contractStdout=run(process.execPath,['--input-type=module','-e',contractControl],{cwd:tmp});
 for(const subpath of ['original-wallet-main-namespace-bootstrap','wallet-pay-client-source-data']){
  const p=spawnSync(process.execPath,['--conditions=browser','--input-type=module','-e',`await import('@ynx-chain/wallet-auth/${subpath}')`],{cwd:tmp,encoding:'utf8',timeout:10000});
  assert.notEqual(p.status,0);assert.match(p.stderr,/ERR_PACKAGE_PATH_NOT_EXPORTED/);
 }
 // Materialize declared dependency bytes before inspecting the actual packed
 // CLI closure. This is static input evidence, never CLI private execution.
 fs.unlinkSync(tmp+'/package/node_modules');
 fs.cpSync(pkg+'/node_modules',tmp+'/package/node_modules',{recursive:true,dereference:true});
 const closure=generateAuthRuntimeClosure(tmp+'/package',{entries:['native/original-auth-identity-source-verifier.mjs']});
 for(const row of closure.manifest.files){const b=fs.readFileSync(tmp+'/package/'+row.path);assert.equal(b.length,row.bytes??row.size);assert.equal(sha(b),row.sha256);}
 fs.writeFileSync(out+'/NORMAL_ORIGINAL_CLI_STATIC_CLOSURE.json',JSON.stringify({graph:closure,privateCLIExecution:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false},null,2)+'\n');
 const privateProducer=JSON.parse(run(process.execPath,['--input-type=module','-e',"import*as p from'./package/src/original-wallet-main-namespace-node-loader-private.js';console.log(JSON.stringify(Object.keys(p).sort()));"],{cwd:tmp}));
 const raw=fs.readFileSync(archive);
 const result={archive:{file:packed.filename,bytes:raw.length,sha256:sha(raw)},members:rows.length,allMembersMatchSource:true,actualPackedPublicEntry:true,privateProducer,stdout,contractStdout,browserPortsRefused:2,normalCLIStaticFiles:closure.manifest.files.length,normalCLIStaticEdges:closure.report.edges.length,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,installed:false,realLogin:false,realRestore:false,realRevoke:false};
 fs.writeFileSync(out+'/MEMBERS.json',JSON.stringify(rows,null,2)+'\n');
 fs.writeFileSync(out+'/RESULT.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

// Public package readback only. No Source registration, Native build or account.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),pkg=root+'/packages/wallet-auth',out=root+'/.wallet-source-package';
fs.mkdirSync(out,{recursive:true});
function run(cmd,args,options={}){const p=spawnSync(cmd,args,{encoding:'utf8',timeout:60000,...options});if(p.error)throw p.error;if(p.status!==0)throw Error(p.stderr||p.stdout||`exit ${p.status}`);return p.stdout;}
const sha=b=>createHash('sha256').update(b).digest('hex');
const packed=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',out],{cwd:pkg}))[0];
const archive=path.join(out,packed.filename),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wallet-source-package-'));
try{
 run('tar',['-xzf',archive,'-C',tmp]);
 const rows=[];
 for(const r of packed.files){const actual=fs.readFileSync(path.join(tmp,'package',r.path)),source=fs.readFileSync(path.join(pkg,r.path));assert.deepEqual(actual,source,r.path);rows.push({path:r.path,bytes:actual.length,sha256:sha(actual)});}
 const metadata=JSON.parse(fs.readFileSync(tmp+'/package/package.json'));
 assert.deepEqual(metadata.exports['./pq-native-pay-source'],{types:'./src/pq-native-pay-source.d.ts',browser:null,node:'./src/pq-native-pay-source.js',default:null});
 fs.mkdirSync(tmp+'/node_modules/@ynx-chain',{recursive:true});
 fs.symlinkSync(tmp+'/package',tmp+'/node_modules/@ynx-chain/wallet-auth','dir');
 fs.symlinkSync(pkg+'/node_modules',tmp+'/package/node_modules','dir');
 const publicControl=`import assert from'node:assert/strict';import{acquireOriginalPaySource,isOriginalPaySource}from'@ynx-chain/wallet-auth/pq-native-pay-source';assert.equal(isOriginalPaySource({}),false);const target={version:1,service:'pay',kind:'invoice_terms',intentId:'npi_'+'ab'.repeat(24),merchant:null,invoiceId:null,requestPath:'/v5/pay/invoice-intents/npi_'+'ab'.repeat(24)+'/merchant-member'};const original={account:'0x'+'11'.repeat(20),hash:'0x'+'aa'.repeat(32),operationId:'PUBLIC-op',typed:{networkId:'bb'.repeat(32),memberHash:'0x'+'cc'.repeat(32)}};assert.throws(()=>acquireOriginalPaySource({request:null,original,target}),{code:'AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED'});console.log('actual packed public entry refused without original image admission');`;
 const stdout=run(process.execPath,['--input-type=module','-e',publicControl],{cwd:tmp});
 const raw=fs.readFileSync(archive);
 const result={archive:{file:packed.filename,bytes:raw.length,sha256:sha(raw)},members:rows.length,allMembersMatchSource:true,actualPackedPublicEntry:true,stdout,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,installed:false,realLogin:false,realRestore:false,realRevoke:false};
 fs.writeFileSync(out+'/MEMBERS.json',JSON.stringify(rows,null,2)+'\n');
 fs.writeFileSync(out+'/RESULT.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

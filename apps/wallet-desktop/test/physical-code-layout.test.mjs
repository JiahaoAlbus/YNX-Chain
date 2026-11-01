import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assemblePhysicalQACodeLayout,openPhysicalCodeView} from '../scripts/physical-code-layout.mjs';
import {desktopAsarHeaderIntegrity} from '../scripts/release-provenance.mjs';
const app=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(new URL('../package.json',import.meta.url)),asar=require('@electron/asar');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-physical-layout-'))),resources=path.join(root,'Resources'),src=path.join(root,'input'),profile=path.join(root,'fresh-profile');for(const p of [resources,src,profile])fs.mkdirSync(p,{mode:0o700});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const files={'package.json':JSON.stringify({name:'PUBLIC-physical-qa',version:'1.0.0',type:'module',main:'code/apps/wallet-desktop/src/main.mjs'}),'code/apps/wallet-desktop/src/main.mjs':'export const PUBLIC_SOURCE=true;','code/apps/wallet-desktop/native/original-auth-identity.node':'PUBLIC bytes, not a Native image','code/packages/wallet-auth/src/original-auth-runtime-image-source-v1.js':'export const PUBLIC_ROOT=false;','code/packages/wallet-auth/package.json':'{"name":"@ynx-chain/wallet-auth","type":"module"}'};
 for(const[n,b]of Object.entries(files)){const p=path.join(src,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b,{mode:n.endsWith('.node')?0o755:0o644});}
 fs.mkdirSync(path.join(src,'node_modules/@ynx-chain'),{recursive:true});fs.symlinkSync('../../code/packages/wallet-auth',path.join(src,'node_modules/@ynx-chain/wallet-auth'));
 const archive=path.join(resources,'app.asar'),pack=`const a=require(${JSON.stringify(require.resolve('@electron/asar'))});a.createPackageWithOptions(${JSON.stringify(src)},${JSON.stringify(archive)},{unpack:'**/*.node'}).catch(e=>{console.error(e);process.exitCode=1});`;
 execFileSync(process.execPath,['-e',pack]);asar.uncache(archive);
 const rows=asar.listPackage(archive).map(p=>{const name=p.replace(/^\//,''),s=asar.statFile(archive,path.normalize(name),false);if(s.files)return{path:name,type:'directory',unpacked:!!s.unpacked};if(s.link)return{path:name,type:'link',link:s.link,unpacked:!!s.unpacked};const b=asar.extractFile(archive,name);return{path:name,type:'file',unpacked:!!s.unpacked,executable:!!s.executable,physicalMode:s.unpacked?fs.lstatSync(path.join(archive+'.unpacked',name)).mode&0o777:null,bytes:b.length,sha256:sha(b)};}).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 fs.writeFileSync(path.join(resources,'ynx-wallet-packaged-relocation.json'),JSON.stringify({after:rows,asarHeaderIntegrity:{algorithm:'SHA256',hash:sha(Buffer.from(asar.getRawHeader(archive).headerString))}}));return{root,resources,profile,files};
}
test('offline physical assembly keeps one SDK/native copy, original bytes and the normal canonical URI',async t=>{
 const f=await fixture(t),r=assemblePhysicalQACodeLayout(f.resources,app,f.profile),view=openPhysicalCodeView(f.resources,app);
 assert.equal(r.RootAdmission,false);assert.equal(r.officialRelease,false);assert.equal(fs.existsSync(path.join(f.resources,'app.asar.unpacked')),false);
 assert.deepEqual(desktopAsarHeaderIntegrity(f.resources,app),view.actualAsarHeaderIntegrity);
 assert.notDeepEqual(view.actualAsarHeaderIntegrity,r.originalAsarHeaderIntegrity);
 for(const[n,b]of Object.entries(f.files))assert.equal(fs.readFileSync(path.join(view.root,n),'utf8'),b);
 assert.equal(fs.realpathSync(path.join(view.root,'node_modules/@ynx-chain/wallet-auth')),path.join(view.root,'code/packages/wallet-auth'));
 assert.equal(asar.listPackage(path.join(f.resources,'app.asar')).filter(p=>p.includes('wallet-auth')).length,0);
 assert.equal(view.asar.extractFile('', 'code/apps/wallet-desktop/src/main.mjs').toString(),f.files['code/apps/wallet-desktop/src/main.mjs']);
 const boot=asar.extractFile(path.join(f.resources,'app.asar'),'code/apps/wallet-desktop/src/main.mjs').toString();assert(boot.includes(JSON.stringify(f.profile)));assert(boot.includes('app.code/code/apps/wallet-desktop/src/main.mjs'));
});
test('physical byte substitution, extra copy and a changed bootstrap are rejected',async t=>{
 const f=await fixture(t);assemblePhysicalQACodeLayout(f.resources,app,f.profile);const target=path.join(f.resources,'app.code/code/packages/wallet-auth/package.json'),original=fs.readFileSync(target);fs.writeFileSync(target,'{}');assert.throws(()=>openPhysicalCodeView(f.resources,app),/LAYOUT_DIFFERS/);fs.writeFileSync(target,original);
 const extra=path.join(f.resources,'app.code/second-sdk.js');fs.writeFileSync(extra,'PUBLIC');assert.throws(()=>openPhysicalCodeView(f.resources,app),/LAYOUT_DIFFERS/);fs.unlinkSync(extra);
 const receipt=path.join(f.resources,'ynx-wallet-physical-code-layout.json'),r=JSON.parse(fs.readFileSync(receipt));r.qaProfile=path.join(f.root,'another-profile');fs.writeFileSync(receipt,JSON.stringify(r));assert.throws(()=>openPhysicalCodeView(f.resources,app),/LAYOUT_DIFFERS/);
});

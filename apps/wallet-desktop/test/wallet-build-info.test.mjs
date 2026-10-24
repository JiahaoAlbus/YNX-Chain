import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const identity={schemaVersion:1,product:'YNX Wallet',version:'0.6.10',sourceCommit:'c56946b5a60a26e660894e6367b9de0fc41e89b7',walletTree:'1'.repeat(40),walletAuthTree:'2'.repeat(40),distribution:'testnet-preview'};
test('normal main app-info uses only the fixed packaged identity path, not renderer input or account custody',async()=>{
 const main=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),line=main.match(/^handleWalletIPC\("wallet:app-info".*$/m)?.[0];assert(line);let handler,captured;
 vm.runInNewContext(line,{handleWalletIPC:(_name,fn)=>{handler=fn;},app:{getVersion:()=>identity.version,isPackaged:true},process:{resourcesPath:'/PUBLIC/Resources'},path,readPackagedWalletBuildInfo:async value=>{captured=value;return {version:identity.version,build:{sourceCommit:identity.sourceCommit}};}});
 const actual=await handler(null,{identityPath:'/PUBLIC/foreign',password:'must not be used'});assert.equal(actual.build?.sourceCommit,identity.sourceCommit);assert.equal(captured.identityPath,'/PUBLIC/Resources/ynx-wallet-build-identity.json');assert.equal(captured.isPackaged,true);assert.equal(Object.keys(captured).sort().join(','),'identityPath,isPackaged,version');
});
test('same release version projects distinct build commits, never arbitrary fields or verification authority',async()=>{
 const {projectWalletBuildInfo}=await import('../src/wallet-build-info.mjs');
 const a=projectWalletBuildInfo(identity.version,Buffer.from(JSON.stringify({...identity,password:'PUBLIC unwanted',installedRuntimeVerified:true}))),b=projectWalletBuildInfo(identity.version,Buffer.from(JSON.stringify({...identity,sourceCommit:'d7382a07251acd33c6fdc3c92290558efe60f614'})));
 assert.equal(a.version,b.version);assert.notEqual(a.build.sourceCommit,b.build.sourceCommit);assert.equal(a.build.metadataOnly,true);assert.equal(Object.keys(a.build).sort().join(','),'distribution,metadataOnly,sourceCommit,walletAuthTree,walletTree');assert.equal(JSON.stringify(a).includes('PUBLIC unwanted'),false);assert(Object.isFrozen(a.build));
 for(const changed of [{version:'0.6.11'},{schemaVersion:2},{sourceCommit:'<script>'},{walletTree:'x'},{distribution:'production'},{product:'other'}])assert.equal(projectWalletBuildInfo(identity.version,Buffer.from(JSON.stringify({...identity,...changed}))).build,null);
 for(const raw of[Buffer.from('{'),Buffer.alloc(8193),null])assert.equal(projectWalletBuildInfo(identity.version,raw).build,null);
});
test('packaged identity reader refuses absent, oversized or symlinked records; development never opens any file',async t=>{
 const {readPackagedWalletBuildInfo}=await import('../src/wallet-build-info.mjs'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-public-build-info-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'identity.json'),link=path.join(root,'link.json');fs.writeFileSync(file,JSON.stringify(identity));fs.symlinkSync(file,link);
 assert.equal((await readPackagedWalletBuildInfo({version:identity.version,isPackaged:true,identityPath:file})).build.sourceCommit,identity.sourceCommit);
 for(const identityPath of[link,path.join(root,'missing'),root,'relative.json'])assert.equal((await readPackagedWalletBuildInfo({version:identity.version,isPackaged:true,identityPath})).build,null);
 fs.writeFileSync(file,Buffer.alloc(8193));assert.equal((await readPackagedWalletBuildInfo({version:identity.version,isPackaged:true,identityPath:file})).build,null);
 assert.equal((await readPackagedWalletBuildInfo({version:identity.version,isPackaged:false,get identityPath(){throw Error('development must not read');}})).build,null);
});
function mounted(){const nodes=new Map();function node(tag){return{tag,children:[],hidden:false,isConnected:true,textContent:'',setAttribute(k,v){this[k]=v;},append(...items){this.children.push(...items);for(const item of items)if(item.id)nodes.set('#'+item.id,item);}};}const sheet=node('dialog');nodes.set('#appearance-sheet',sheet);return{nodes,sheet,document:{querySelector:s=>nodes.get(s),createElement:node}};}
test('normal settings UI renders plain build identity, handles unavailable replies and does not require unlocking',async()=>{
 const {mountWalletBuildInfo}=await import('../src/wallet-build-info-ui.mjs'),{projectWalletBuildInfo}=await import('../src/wallet-build-info.mjs'),ui=mounted();let calls=0;const keys=[];
 const control=mountWalletBuildInfo({document:ui.document,readInfo:async()=>{calls++;return projectWalletBuildInfo(identity.version,Buffer.from(JSON.stringify(identity)))},setCopy:(n,k)=>{keys.push(k);n.textContent=k;}});await control.ready;assert.equal(calls,1);assert.equal(ui.nodes.get('#wallet-build-value').textContent,`v${identity.version}\n${identity.sourceCommit}`);assert.equal(ui.nodes.get('#wallet-build-value').dir,'ltr');assert(keys.includes('Recorded package metadata only; this does not verify a signature or running features.'));
 for(const reply of[{version:'<img>',build:{sourceCommit:'<script>'}},{version:identity.version,build:null}]){const f=mounted(),c=mountWalletBuildInfo({document:f.document,readInfo:async()=>reply,setCopy:(n,k)=>{n.textContent=k;}});await c.ready;assert.equal(f.nodes.get('#wallet-build-value').hidden,true);assert.equal(f.nodes.get('#wallet-build-status').textContent,'Build information unavailable.');}
 const failed=mounted();await mountWalletBuildInfo({document:failed.document,readInfo:async()=>{throw Error('/private/path must not render')},setCopy:(n,k)=>{n.textContent=k;}}).ready;assert.equal(failed.nodes.get('#wallet-build-status').textContent,'Build information unavailable.');
 const source=fs.readFileSync(new URL('../src/wallet-appearance.mjs',import.meta.url),'utf8');assert.match(source,/mountWalletBuildInfo\(\{document,readInfo:\(\)=>window\.ynxWallet\.appInfo\(\)\}\)/);
});
test('build information copy is registered in every existing locale',async()=>{
 const {WALLET_COPY,WALLET_LOCALES}=await import('../src/wallet-locale.mjs'),{BUILD_INFO_COPY}=await import('../src/wallet-locale-build-info.mjs');for(const locale of WALLET_LOCALES)for(const key of Object.keys(BUILD_INFO_COPY.en)){assert.equal(WALLET_COPY[locale][key],BUILD_INFO_COPY[locale][key]);assert(WALLET_COPY[locale][key].length>3);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,chmodSync,realpathSync,statSync,renameSync,copyFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {originalAuthNativeBuildPlan,captureOriginalAuthNativeBuildReceipt,originalAuthNativeInputPins} from '../scripts/build-original-auth-identity-native.mjs';
import {relocateDesktopRuntimeSource,PACKAGED_RELOCATION_RULES,relocateDesktopPackage,verifyDesktopPackage,desktopReleaseIdentity,PACKAGED_RELOCATION_RECEIPT,desktopAsarHeaderIntegrity,declaredSDKRuntimeSources} from '../scripts/release-provenance.mjs';
import {canonicalArchivePlan,CANONICAL_MAIN,NATIVE_CANONICAL,SDK_ALIAS,verifyCanonicalNativeReceipt,PINNED_NODE_HEADER_PINS} from '../scripts/canonical-package.mjs';
import {walletAuthDependencyPlan} from '../scripts/wallet-auth-dependencies.mjs';
test('normal builder metadata selects canonical entry before its post-afterPack sanity check',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));assert.equal(pkg.main,'src/main.mjs');assert.equal(pkg.build.extraMetadata.main,CANONICAL_MAIN);
});
test('R24 normal builder retains pinned dependency metadata before canonical assembly',async()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))),{createTransformer}=require('app-builder-lib/out/fileTransformer.js');
 assert.equal(pkg.build.removePackageScripts,false);assert.equal(pkg.build.removePackageKeywords,false);
 const keep=createTransformer(project,pkg.build),old=createTransformer(project,{...pkg.build,removePackageKeywords:true});
 for(const name of ['curves','hashes']){
  const relative='@noble/'+name+'/package.json',file=path.join(dependencyRoot,relative),bytes=readFileSync(file),pin=dependencyManifest.files.find(p=>p.path===relative);
  assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);
  assert.equal(await keep(file),null);const changed=await old(file);assert.equal(typeof changed,'string');assert.notEqual(createHash('sha256').update(changed).digest('hex'),pin.sha256);
  const original=JSON.parse(bytes);delete original.keywords;assert.deepEqual(JSON.parse(changed),original);
 }
});
test('Native normal build has the six Auth-frozen units and libbsm for every architecture',()=>{
 for(const arch of ['arm64','x64','universal']){
  const p=originalAuthNativeBuildPlan(arch,'/PUBLIC/headers');
  assert.deepEqual(p.sources.map(s=>s.split('/').pop()),['original-auth-identity-node.mm','original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm']);
  for(const c of p.commands.filter(c=>c.tool.endsWith('clang++'))){assert.equal(c.argv.filter(a=>a==='-lbsm').length,1);assert.equal(c.argv.filter(a=>a==='-DNODE_GYP_MODULE_NAME=original_auth_identity').length,1);assert.ok(c.argv.includes('-mmacosx-version-min=13.0'));assert.equal(p.sources.filter(s=>c.argv.includes(s)).length,6);}
 }
});
test('R23 Native input snapshot retains exact original Node closure plus new IO header, not IDE inputs',()=>{
 const nativeRoot=process.env.PROVENANCE_NATIVE_SOURCE_ROOT??path.resolve(new URL('../',import.meta.url).pathname,'../..');
 const headers=new URL('./fixtures/node-22.13.1/',import.meta.url).pathname.replace(/\/$/,''),plan=originalAuthNativeBuildPlan('arm64',headers),planRoot=path.resolve(path.dirname(plan.output),'../../..');
 const mapped={...plan,output:plan.output.replace(planRoot,nativeRoot),sources:plan.sources.map(p=>p.replace(planRoot,nativeRoot))};
 const pins=originalAuthNativeInputPins(mapped,headers).inputFiles,receipt=JSON.parse(readFileSync(nativeRoot+'/apps/wallet-desktop/native/original-auth-identity-build.json'));
 assert.deepEqual(pins,receipt.inputFiles);assert.equal(pins.length,24);
 const names=pins.map(p=>p.relative);assert.ok(names.includes('packages/wallet-auth/native/original-source-verifier-io.h'));assert.ok(names.includes('packages/wallet-auth/native/original-auth-identity-joint-owner.test.mjs'));assert.ok(names.includes('packages/wallet-auth/native/original-auth-identity-source-authority.test.mjs'));assert.equal(names.some(p=>p.startsWith('apps/developer/')),false);
 assert.equal(plan.sources.length,6);
});

const project=new URL('../',import.meta.url).pathname,require=createRequire(new URL('../package.json',import.meta.url)),asar=require('@electron/asar'),asarCLI=require.resolve('@electron/asar/bin/asar.js');
const sdkRuntime=process.env.PROVENANCE_SDK_SOURCE??path.resolve(project,'../../packages/wallet-auth/src');
const dependencyRoot=process.env.PROVENANCE_SDK_DEPENDENCY_ROOT??path.resolve(project,'../../packages/wallet-auth/node_modules');
const dependencyManifestBytes=readFileSync(new URL('../scripts/wallet-auth-runtime-dependencies.json',import.meta.url)),dependencyManifest=JSON.parse(dependencyManifestBytes);
const additionalNativeOperands=[['original-auth-identity-source-current.js','original-source-current-dirfd.node'],['original-host-terminal-journal.js','original-auth-identity.node'],['original-ide-admission-parent-delivery.js','original-auth-identity.node']];
for(const [file,module] of additionalNativeOperands)test('R22 actual SDK reference remains exact: '+file,()=>{
 const source=readFileSync(path.join(sdkRuntime,file)),result=relocateDesktopRuntimeSource('packages/wallet-auth/src/'+file,source);assert.deepEqual(result.bytes,source);assert.equal(result.operands.length,1);assert.equal(result.operands[0].from,'../../../apps/wallet-desktop/native/'+module);assert.equal(result.operands[0].count,1);
 for(const body of [source.toString().replace(result.operands[0].from,'../../../apps/wallet-desktop/native/foreign.node'),source.toString()+`\nnew URL('${result.operands[0].from}',import.meta.url);\n`])assert.throws(()=>relocateDesktopRuntimeSource('packages/wallet-auth/src/'+file,Buffer.from(body)),/operand count|Unlisted repository operand/i);
});
test('R22 actual entire SDK runtime closure has no unlisted repository operands',()=>{
 const names=readdirSync(sdkRuntime,{recursive:true}).filter(name=>/\.(?:js|mjs)$/.test(name)&&!name.endsWith('.test.mjs'));
 for(const name of names){const source=readFileSync(path.join(sdkRuntime,name));assert.deepEqual(relocateDesktopRuntimeSource('packages/wallet-auth/src/'+name,source).bytes,source,name);}
 assert.ok(names.length>100);console.log(JSON.stringify({scope:'actual SDK runtime source bytes/operand inventory, no shared module evaluation',files:names.length}));
});
function fixture(t,{runtimeMetadata={},includeRegistry=true,extraSDKFiles={},sdkMetadata={}}={}){
 const root=mkdtempSync(path.join(tmpdir(),'ynx-canonical-public-')),app=path.join(root,'apps/wallet-desktop'),stage=path.join(root,'raw'),resources=path.join(root,'resources');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const files={'apps/wallet-desktop/package.json':JSON.stringify({name:'public-wallet-fixture',version:'0.6.10',type:'module',main:'src/main.mjs',...runtimeMetadata}),'packages/wallet-auth/package.json':JSON.stringify({name:'@ynx-chain/wallet-auth',type:'module',main:'src/index.js',dependencies:dependencyManifest.versions}),'packages/wallet-auth/src/index.js':'export const PUBLIC_ONLY=true;\n','packages/wallet-auth/product-session-registry.json':'{"PUBLIC":true}\n','apps/wallet-desktop/native/original-auth-identity.node':'PUBLIC DATA - NOT A NATIVE MODULE\n','apps/wallet-desktop/scripts/wallet-auth-runtime-dependencies.json':dependencyManifestBytes};
 // The fixed R3d launcher is now a required relocation operand. Declare its
 // scripts scope in every public archive fixture, just as the actual SDK does.
 files['packages/wallet-auth/package.json']=JSON.stringify({...JSON.parse(files['packages/wallet-auth/package.json']),...sdkMetadata,files:[...new Set([...(sdkMetadata.files??['src']),'scripts'])]});
 for(const [name,body] of Object.entries(extraSDKFiles))files['packages/wallet-auth/'+name]=body;
 for(const row of dependencyManifest.files)files['packages/wallet-auth/node_modules/'+row.path]=readFileSync(path.join(dependencyRoot,row.path));
 if(!includeRegistry)delete files['packages/wallet-auth/product-session-registry.json'];
 const headers=path.join(root,'PUBLIC-headers');mkdirSync(headers);for(const p of PINNED_NODE_HEADER_PINS)copyFileSync(new URL('./fixtures/node-22.13.1/'+p.relative,import.meta.url),path.join(headers,p.relative));
 const plan=originalAuthNativeBuildPlan('arm64',headers),planRoot=path.resolve(path.dirname(plan.output),'../../..');
 for(const source of plan.sources)files[path.relative(planRoot,source)]='// PUBLIC Native source stand-in; never compiled\n';
 for(const rule of PACKAGED_RELOCATION_RULES)files[rule.sourcePath]=rule.operands.map(o=>o.kind==='from'?`import {} from '${o.from}';\n`:`const PUBLIC_URL=new URL('${o.from}',import.meta.url);\n`).join('');
 for(const rule of PACKAGED_RELOCATION_RULES)for(const o of rule.operands){const target=path.posix.normalize(path.posix.join(path.posix.dirname(rule.sourcePath),o.from));if('code/'+target===rule.unavailableNativeAsset)continue;files[target]??='export const PUBLIC_ONLY=true;\n';}
 files['packages/wallet-auth/src/index.d.ts']='export declare const PUBLIC_ONLY:boolean;\n';
 for(const [name,body] of Object.entries(files)){
  const file=path.join(root,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,body);
  if(name.endsWith('.d.ts')||name.startsWith('packages/wallet-auth/node_modules/')||name.startsWith('apps/wallet-desktop/scripts/'))continue;
  const raw=name.startsWith('apps/wallet-desktop/')?name.slice('apps/wallet-desktop/'.length):SDK_ALIAS+'/'+name.slice('packages/wallet-auth/'.length),target=path.join(stage,raw);
  mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,name==='apps/wallet-desktop/package.json'?JSON.stringify({...JSON.parse(body),main:CANONICAL_MAIN}):body);if(name.endsWith('.node'))chmodSync(target,0o755);
 }
 const probe=phase=>{if(process.env.YNX_CANONICAL_SPAWN_DIAGNOSTIC!=='1')return;for(const command of ['/usr/bin/true','/usr/bin/git','git']){const args=command.endsWith('git')?['--version']:[],r=spawnSync(command,args,{cwd:root,encoding:'utf8'});console.log(JSON.stringify({diagnostic:phase,command,status:r.status,pid:r.pid,error:r.error?.code,stdout:r.stdout?.trim(),stderr:r.stderr?.trim()}));}};
 probe('before-capture');
 const fixturePlan={...plan,output:plan.output.replace(planRoot,root),sources:plan.sources.map(s=>s.replace(planRoot,root)),commands:plan.commands.map(c=>({...c,argv:c.argv.map(v=>v.replace(planRoot,root))}))};
 const nativeReceipt=captureOriginalAuthNativeBuildReceipt(fixturePlan,headers);assert.equal(nativeReceipt.readbackOnly,true);assert.equal(nativeReceipt.nativeQualified,false);
 writeFileSync(path.join(stage,'native/original-auth-identity-build.json'),JSON.stringify(nativeReceipt));probe('after-capture');
 writeFileSync(path.join(app,'native/original-auth-identity-build.json'),JSON.stringify(nativeReceipt));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git('init');git('add','apps','packages');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','commit','-m','PUBLIC canonical fixture');
 symlinkSync(path.join(project,'node_modules'),path.join(app,'node_modules'),'dir');mkdirSync(resources);
 const previous=process.env.GITHUB_SHA;process.env.GITHUB_SHA=git('rev-parse','HEAD');t.after(()=>{if(previous===undefined)delete process.env.GITHUB_SHA;else process.env.GITHUB_SHA=previous;});
 const identity=desktopReleaseIdentity(app,'0.6.10');writeFileSync(path.join(resources,'ynx-wallet-build-identity.json'),JSON.stringify(identity));
 const rawPack=()=>execFileSync(process.execPath,[asarCLI,'pack',stage,path.join(resources,'app.asar'),'--unpack','original-auth-identity.node'],{stdio:'pipe'});
 rawPack();return {root,app,stage,resources,git,rawPack,files,headers,fixturePlan,nativeReceipt,archive:path.join(resources,'app.asar')};
}
// These evolve the prior static-rewrite R22 acceptance controls to the new
// path-only canonical recipe; they retain source/metadata/receipt/integrity
// refusals rather than treating the old rewrite expectations as compatible.
for(const field of ['name','type','dependencies','optionalDependencies','engines','os','cpu','imports','exports'])test('source-bound runtime metadata still rejects '+field,t=>{
 const f=fixture(t),file=path.join(f.stage,'package.json'),metadata=JSON.parse(readFileSync(file));metadata[field]=field==='name'||field==='type'?'FOREIGN':{FOREIGN:'./injected.mjs'};writeFileSync(file,JSON.stringify(metadata));f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),new RegExp('Packaged runtime metadata differs: '+field));
});
for(const field of ['recipe','sourceCommit'])test('forged canonical receipt rejects '+field,t=>{
 const f=fixture(t);relocateDesktopPackage(f.resources,f.app);const file=path.join(f.resources,PACKAGED_RELOCATION_RECEIPT),receipt=JSON.parse(readFileSync(file));receipt[field]='FOREIGN';writeFileSync(file,JSON.stringify(receipt));assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/receipt differs/);
});
test('nonlisted SDK body and required registry are still source-byte-bound',t=>{
 const f=fixture(t);writeFileSync(path.join(f.stage,SDK_ALIAS,'src/index.js'),'export const FOREIGN=true;\n');f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Packaged source differs/);
});
test('canonical verification rejects changed declared SDK Native runtime source outside src',t=>{
 const name='native/publication-readonly-source-r28-20261018/source/service-publisher.mjs',f=fixture(t,{sdkMetadata:{files:['src','native/publication-readonly-source-r28-20261018/source']},extraSDKFiles:{[name]:'export const PUBLIC_SOURCE=true;\n'}});
 relocateDesktopPackage(f.resources,f.app);verifyDesktopPackage(f.resources,f.app);
 writeFileSync(path.join(f.stage,SDK_ALIAS,name),'export const FOREIGN_SOURCE=true;\n');f.rawPack();relocateDesktopPackage(f.resources,f.app);
 assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Packaged source differs/);
});
test('R3d canonical declared closure binds new custody codec and private service launcher from frozen Git',()=>{
 const root=path.resolve(project,'../..'),commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),names=declaredSDKRuntimeSources(root,commit);
 for(const relative of ['native/terminal-custody-recovery-r30a-20261018/source/terminal-response-v3.mjs','scripts/original-wallet-private-service-launcher.mjs']){
  const name='packages/wallet-auth/'+relative;assert.ok(names.includes(name),name);
  const bytes=execFileSync('git',['show',`${commit}:${name}`],{cwd:root});assert.deepEqual(relocateDesktopRuntimeSource(name,bytes).bytes,bytes,name);
 }
});
test('R3d canonical archive refuses changed custody codec with a freshly regenerated relocation receipt',t=>{
 const scope='native/terminal-custody-recovery-r30a-20261018/source',name=scope+'/terminal-response-v3.mjs',f=fixture(t,{sdkMetadata:{files:['src',scope]},extraSDKFiles:{[name]:'export const PUBLIC_SOURCE=true;\n'}});
 relocateDesktopPackage(f.resources,f.app);verifyDesktopPackage(f.resources,f.app);
 writeFileSync(path.join(f.stage,SDK_ALIAS,name),'export const FOREIGN_SOURCE=true;\n');f.rawPack();relocateDesktopPackage(f.resources,f.app);
 assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Packaged source differs/);
});
test('canonical declared closure binds all six actual R28 sources plus normal daemon from frozen Git',()=>{
 const root=path.resolve(project,'../..'),commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),names=declaredSDKRuntimeSources(root,commit);
 assert.equal(names.filter(name=>name.startsWith('packages/wallet-auth/native/publication-readonly-source-r28-20261018/source/')).length,6);
 assert.ok(names.includes('packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs'));assert.ok(names.includes('packages/wallet-auth/native/original-auth-identity-source-verifier.mjs'));assert.equal(names.some(name=>name.includes('node_modules/')),false);
 for(const name of names){const bytes=execFileSync('git',['show',`${commit}:${name}`],{cwd:root});assert.deepEqual(relocateDesktopRuntimeSource(name,bytes).bytes,bytes,name);}
});
test('canonical verification rejects missing declared SDK Native runtime and altered declared daemon',t=>{
 for(const [mode,name,scope] of [['missing','native/publication-readonly-source-r28-20261018/source/service-publisher.mjs','native/publication-readonly-source-r28-20261018/source'],['altered','scripts/ynx-wallet-gatewayd.mjs','scripts']]){
  const f=fixture(t,{sdkMetadata:{files:['src',scope]},extraSDKFiles:{[name]:'export const PUBLIC_SOURCE=true;\n'}});
  relocateDesktopPackage(f.resources,f.app);verifyDesktopPackage(f.resources,f.app);
  if(mode==='missing')rmSync(path.join(f.stage,SDK_ALIAS,name));else writeFileSync(path.join(f.stage,SDK_ALIAS,name),'export const FOREIGN_SOURCE=true;\n');
  f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),mode==='missing'?/not found/:/Packaged source differs/);
 }
});
test('canonical verification refuses undeclared SDK Native executable even with a fresh archive receipt',t=>{
 const f=fixture(t,{sdkMetadata:{files:['src']}}),name=path.join(f.stage,SDK_ALIAS,'native/unlisted-runtime.mjs');mkdirSync(path.dirname(name),{recursive:true});writeFileSync(name,'export const FOREIGN_SOURCE=true;\n');
 f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Unlisted packaged runtime member/);
});
test('canonical declared runtime inventory reads frozen metadata instead of a changed checkout',t=>{
 const name='native/publication-readonly-source-r28-20261018/source/service-publisher.mjs',f=fixture(t,{sdkMetadata:{files:['src','native/publication-readonly-source-r28-20261018/source']},extraSDKFiles:{[name]:'export const PUBLIC_SOURCE=true;\n'}}),commit=f.git('rev-parse','HEAD');
 writeFileSync(path.join(f.root,'packages/wallet-auth/package.json'),JSON.stringify({files:['src']}));
 assert.ok(declaredSDKRuntimeSources(f.root,commit).includes('packages/wallet-auth/'+name));
});
test('required registry absence and additional executable member are rejected',t=>{
 const f=fixture(t);rmSync(path.join(f.stage,SDK_ALIAS,'product-session-registry.json'));f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/was not found/);
});
test('additional executable member rejects even with fresh canonical receipt',t=>{
 const f=fixture(t);writeFileSync(path.join(f.stage,'src/foreign.mjs'),'export const FOREIGN=true;\n');f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Unlisted packaged runtime member/);
});
test('native readback pins and fixed command closure reject mutation, omission and false qualification',t=>{
 const f=fixture(t),read=p=>readFileSync(path.join(f.root,p)),names=f.nativeReceipt.inputFiles.map(p=>p.relative),module=readFileSync(path.join(f.stage,'native/original-auth-identity.node'));
 for(const alter of [r=>r.output.sha256='0'.repeat(64),r=>r.inputFiles.pop(),r=>r.inputFiles.push({...r.inputFiles[0]}),r=>r.inputFiles[0].sha256='0'.repeat(64),r=>r.commands[0].argv=r.commands[0].argv.filter(a=>a!=='-lbsm'),r=>r.headerVersion='24.19.0',r=>r.nativeQualified=true,r=>r.relativeBases.inputFiles='wallet-desktop-root']){
  const receipt=structuredClone(f.nativeReceipt);alter(receipt);assert.throws(()=>verifyCanonicalNativeReceipt(receipt,module,names,read),/Native build receipt/);
 }
 writeFileSync(path.join(f.headers,'node_version.h'),'#define NODE_MAJOR_VERSION 24\n');assert.throws(()=>captureOriginalAuthNativeBuildReceipt(f.fixturePlan,f.headers),/PINNED_HEADER_VERSION_REQUIRED/);
});
test('literal external symlink, unrelated body, source paths and native mode survive canonical assembly',t=>{
 const f=fixture(t);mkdirSync(path.join(f.stage,'public'));writeFileSync(path.join(f.stage,'public/sentinel'),'PUBLIC\n');symlinkSync('sentinel',path.join(f.stage,'public/link'));f.rawPack();const receipt=relocateDesktopPackage(f.resources,f.app);
 for(const row of receipt.before.filter(r=>r.path.startsWith('public/')))assert.deepEqual(receipt.after.find(a=>a.path===row.path),row);
 const native=path.join(f.archive+'.unpacked',NATIVE_CANONICAL);assert.equal(statSync(native).mode&0o777,0o755);assert.equal(verifyDesktopPackage(f.resources,f.app).canonicalLayoutVerified,true);chmodSync(native,0o644);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/archive differs/);
});
test('percent space Unicode resources path does not change SDK or Native identity',t=>{
 const f=fixture(t),moved=path.join(f.root,'PUBLIC space % # 中文 Resources');renameSync(f.resources,moved);relocateDesktopPackage(moved,f.app);assert.equal(verifyDesktopPackage(moved,f.app).canonicalLayoutVerified,true);
});
for(const field of ['imports','exports'])for(const nested of [false,true])test(`conditional ${field} ${nested?'nested':'direct'} order remains source-bound`,t=>{
 const wrap=value=>field==='imports'?{'#entry':nested?{import:value,default:'./src/main.mjs'}:value}:nested?{'.':{import:value,default:'./src/main.mjs'}}:value;
 const condition={node:'./src/main.mjs',default:'./src/main.mjs'},f=fixture(t,{runtimeMetadata:{[field]:wrap(condition)}}),file=path.join(f.stage,'package.json'),metadata=JSON.parse(readFileSync(file));metadata[field]=wrap({default:condition.default,node:condition.node});writeFileSync(file,JSON.stringify(metadata));f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),new RegExp('Packaged runtime metadata differs: '+field));
});
test('matching recursive conditions and reordered dependency names retain original app package scope',t=>{
 const f=fixture(t,{runtimeMetadata:{dependencies:{first:'1',second:'2'},imports:{'#entry':{node:{import:['./src/main.mjs'],default:'./src/main.mjs'},default:null}}}}),file=path.join(f.stage,'package.json'),metadata=JSON.parse(readFileSync(file));metadata.dependencies={second:'2',first:'1'};writeFileSync(file,JSON.stringify(metadata));f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.equal(verifyDesktopPackage(f.resources,f.app).runtimePackageMetadataVerified,true);
 assert.equal(JSON.parse(asar.extractFile(f.archive,'code/apps/wallet-desktop/package.json')).main,'src/main.mjs');
});
test('source-missing registry and omitted runtime metadata remain hard failures',t=>{
 const f=fixture(t,{includeRegistry:false});relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Required runtime asset is missing/);
});
test('explicit release-version update remains distinct from source version',t=>{
 const f=fixture(t),file=path.join(f.stage,'package.json'),metadata=JSON.parse(readFileSync(file));metadata.version='0.6.11';writeFileSync(file,JSON.stringify(metadata));f.rawPack();writeFileSync(path.join(f.resources,'ynx-wallet-build-identity.json'),JSON.stringify(desktopReleaseIdentity(f.app,'0.6.11')));relocateDesktopPackage(f.resources,f.app);const result=verifyDesktopPackage(f.resources,f.app);assert.equal(result.version,'0.6.11');assert.equal(result.sourceVersion,'0.6.10');
});
test('changed build identity and omitted source runtime field cannot pass',t=>{
 const f=fixture(t),file=path.join(f.stage,'package.json'),metadata=JSON.parse(readFileSync(file));delete metadata.name;writeFileSync(file,JSON.stringify(metadata));f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Packaged runtime metadata differs: name/);
 writeFileSync(path.join(f.resources,'ynx-wallet-build-identity.json'),JSON.stringify({...desktopReleaseIdentity(f.app,'0.6.10'),sourceCommit:'0'.repeat(40)}));assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Embedded build identity/);
});
function afterPackAPI(){
 const source=readFileSync(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replace('export default async function afterPack','async function afterPack').replace(/^export /mg,'');
 const context={execFileSync,path,writeFile:async(...args)=>writeFileSync(...args),desktopReleaseIdentity,assembleCanonicalDesktopPackage:relocateDesktopPackage,desktopAsarHeaderIntegrity,buildPublicWalletConnectConfig:()=>({PUBLIC_ONLY:true}),WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC-walletconnect.json'};
 runInNewContext(source+'\nthis.api={afterPack,updatedMacAsarIntegrity};',context);return context.api;
}
test('actual normal afterPack refreshes only its Mac ASAR integrity before any signing',{skip:process.platform!=='darwin'},async t=>{
 const f=fixture(t),stale=desktopAsarHeaderIntegrity(f.resources,f.app),appOutDir=path.join(f.root,'PUBLIC-DATA-OUTPUT'),contents=path.join(appOutDir,'PUBLIC Wallet.app/Contents'),resources=path.join(contents,'Resources'),plist=path.join(contents,'Info.plist');mkdirSync(contents,{recursive:true});renameSync(f.resources,resources);execFileSync('plutil',['-create','xml1',plist]);const other={algorithm:'SHA256',hash:'1'.repeat(64)};execFileSync('plutil',['-insert','ElectronAsarIntegrity','-json',JSON.stringify({'Resources/app.asar':stale,'Resources/other.asar':other}),plist]);
 await afterPackAPI().afterPack({appOutDir,electronPlatformName:'darwin',packager:{projectDir:f.app,appInfo:{version:'0.6.10',productFilename:'PUBLIC Wallet'}}});
 const current=JSON.parse(execFileSync('plutil',['-extract','ElectronAsarIntegrity','json','-o','-',plist],{encoding:'utf8'}));assert.notDeepEqual(current['Resources/app.asar'],stale);assert.deepEqual(current['Resources/app.asar'],desktopAsarHeaderIntegrity(resources,f.app));assert.deepEqual(current['Resources/other.asar'],other);assert.equal(verifyDesktopPackage(resources,f.app).macAsarIntegrityVerified,true);
 execFileSync('plutil',['-replace','ElectronAsarIntegrity','-json',JSON.stringify({'Resources/app.asar':stale}),plist]);assert.throws(()=>verifyDesktopPackage(resources,f.app),/Mac ASAR integrity metadata differs/);
});
for(const existing of [null,[],{}, {'Resources/app.asar':{algorithm:'DISABLED'}}])test('missing or disabled Mac integrity refuses '+JSON.stringify(existing),()=>{assert.throws(()=>afterPackAPI().updatedMacAsarIntegrity(existing,{algorithm:'SHA256',hash:'a'.repeat(64)}),/Expected normal Mac ASAR integrity/);});
test('actual PUBLIC ASAR becomes canonical source closure with one SDK alias and one native module',t=>{
 const f=fixture(t),before=readFileSync(f.archive),nativeBefore=readFileSync(f.archive+'.unpacked/native/original-auth-identity.node');
 const receipt=relocateDesktopPackage(f.resources,f.app);assert.equal(receipt.recipe,'wallet-canonical-normal-paths-v2');assert.notDeepEqual(readFileSync(f.archive),before);
 assert.deepEqual(readFileSync(path.join(f.archive+'.unpacked',NATIVE_CANONICAL)),nativeBefore);
 const result=verifyDesktopPackage(f.resources,f.app);assert.equal(result.packagedSourceVerified,true);assert.equal(result.runtimePackageMetadataVerified,true);assert.equal(result.installedRuntimeVerified,false);
 const names=asar.listPackage(f.archive).map(p=>p.replace(/^\//,''));assert.equal(names.filter(p=>p.endsWith('/original-auth-identity.node')).length,1);assert.equal(names.some(p=>p.startsWith('src/')||p.startsWith('native/')),false);
 assert.ok(asar.statFile(f.archive,SDK_ALIAS,false).files);
 assert.ok(!asar.statFile(f.archive,SDK_ALIAS+'/package.json',false).link);
 assert.equal(asar.statFile(f.archive,SDK_ALIAS+'/src/index.js',false).link,'code/packages/wallet-auth/src/index.js');
 assert.equal(JSON.parse(asar.extractFile(f.archive,'package.json')).main,CANONICAL_MAIN);
 for(const rule of PACKAGED_RELOCATION_RULES){
  const body=asar.extractFile(f.archive,rule.packedPath);assert.deepEqual(body,Buffer.from(f.files[rule.sourcePath]));
  for(const operand of rule.operands){const target=path.posix.normalize(path.posix.join(path.posix.dirname(rule.packedPath),operand.from));if(target===rule.unavailableNativeAsset)assert.equal(names.includes(target),false);else assert.ok(names.includes(target),target);}
 }
 const extracted=path.join(f.root,'extracted');asar.extractAll(f.archive,extracted);
 const fromMain=createRequire(path.join(extracted,CANONICAL_MAIN));assert.equal(fromMain.resolve('@ynx-chain/wallet-auth'),realpathSync(path.join(extracted,'code/packages/wallet-auth/src/index.js')));
 assert.equal(result.sdkRuntimeDependencies.filesVerified,316);
 for(const name of ['curves','hashes'])assert.equal(JSON.parse(asar.extractFile(f.archive,'code/packages/wallet-auth/node_modules/@noble/'+name+'/package.json')).version,'2.2.0');
 assert.equal(f.git('status','--porcelain','--untracked-files=no'),'');
 const canonicalBytes=readFileSync(f.archive);assert.throws(()=>relocateDesktopPackage(f.resources,f.app),/already applied|foreign code tree/);assert.deepEqual(readFileSync(f.archive),canonicalBytes);
});
test('R23 altered or missing fixed SDK dependency input cannot fall back to old app dependencies',t=>{
 const f=fixture(t),file=path.join(f.root,'packages/wallet-auth/node_modules/@noble/hashes/package.json');writeFileSync(file,'{"name":"@noble/hashes","version":"1.8.0"}');assert.throws(()=>walletAuthDependencyPlan(f.app,f.git('rev-parse','HEAD')),/SDK_RUNTIME_DEPENDENCY_INPUT/);
});
test('R23 regular alias descriptors and canonical nested dependency bytes stay receipt-bound',t=>{
 const f=fixture(t);relocateDesktopPackage(f.resources,f.app);const file=path.join(f.resources,PACKAGED_RELOCATION_RECEIPT),receipt=JSON.parse(readFileSync(file));receipt.sdkDependencies.files[0].sha256='0'.repeat(64);writeFileSync(file,JSON.stringify(receipt));assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/dependency receipt differs/);
});
test('R22 optional SourceCurrent module stays absent and is never replaced by Wallet Native',t=>{
 const f=fixture(t);relocateDesktopPackage(f.resources,f.app);const result=verifyDesktopPackage(f.resources,f.app);
 assert.deepEqual(result.unavailableOptionalRuntimeAssets,[{declaredBy:'packages/wallet-auth/src/original-auth-identity-source-current.js',path:'code/apps/wallet-desktop/native/original-source-current-dirfd.node',packaged:false,capability:'NOT_SUPPLIED'}]);
 assert.equal(result.nativeModuleBuild.output.relative,'apps/wallet-desktop/native/original-auth-identity.node');
});
test('R22 an unreviewed optional Native module cannot silently enter this Wallet package',t=>{
 const f=fixture(t);writeFileSync(path.join(f.stage,'native/original-source-current-dirfd.node'),'PUBLIC UNREVIEWED MODULE - never loaded\n');f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/Unreviewed optional source-current Native module/);
});
test('canonical packaging refuses altered source before replacing archive',t=>{
 const f=fixture(t),file=path.join(f.stage,'src/main.mjs');writeFileSync(file,readFileSync(file)+'\nexport const FOREIGN=true;\n');f.rawPack();const original=readFileSync(f.archive);
 assert.throws(()=>relocateDesktopPackage(f.resources,f.app),/Relocation input differs/);assert.deepEqual(readFileSync(f.archive),original);
});
test('a forged packaged Native plus matching self-reported receipt cannot replace frozen build inputs',t=>{
 const f=fixture(t),bytes=Buffer.from('PUBLIC FOREIGN MODULE - never loaded\n'),receipt=structuredClone(f.nativeReceipt);receipt.output.bytes=bytes.length;receipt.output.sha256=createHash('sha256').update(bytes).digest('hex');writeFileSync(path.join(f.stage,'native/original-auth-identity.node'),bytes);writeFileSync(path.join(f.stage,'native/original-auth-identity-build.json'),JSON.stringify(receipt));f.rawPack();relocateDesktopPackage(f.resources,f.app);assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/differs from frozen build input/);
});
test('canonical verification still rejects source bytes, metadata and receipt tampering',t=>{
 const f=fixture(t);relocateDesktopPackage(f.resources,f.app);const receiptFile=path.join(f.resources,PACKAGED_RELOCATION_RECEIPT),original=readFileSync(receiptFile),receipt=JSON.parse(original);
 receipt.files[0].operands[0].count=2;writeFileSync(receiptFile,JSON.stringify(receipt));assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/receipt differs/);writeFileSync(receiptFile,original);
 const bad=JSON.parse(original);bad.after.find(r=>r.path==='code/packages/wallet-auth/src/index.js').sha256='0'.repeat(64);writeFileSync(receiptFile,JSON.stringify(bad));assert.throws(()=>verifyDesktopPackage(f.resources,f.app),/unexpected archive members/);
});
test('closed canonical plan rejects double native, alias injection and wrong main',()=>{
 const directory={path:SDK_ALIAS,type:'directory',unpacked:false},native={path:'native/original-auth-identity.node',type:'file',unpacked:true,bytes:1,sha256:'PUBLIC',physicalMode:0o755};
 assert.throws(()=>canonicalArchivePlan([directory,native,{...native,path:'foreign/original-auth-identity.node'}],Buffer.from('{"main":"src/main.mjs"}')),/Exactly one/);
 assert.throws(()=>canonicalArchivePlan([{...directory,type:'link',link:'foreign'},native],Buffer.from('{"main":"src/main.mjs"}')),/Original SDK directory/);
 assert.throws(()=>canonicalArchivePlan([directory,native],Buffer.from('{"main":"foreign.mjs"}')),/input main differs/);
});
test('canonical package preserves approved source bytes and includes the R20 Host operand',()=>{
 const name='apps/wallet-desktop/src/original-admission-custodian.mjs';
 const source=readFileSync('/Users/huangjiahao/.ynx-build-capacity-20261011/wallet-ide-typed-caller-r20-20261017/override/'+name);
 const result=relocateDesktopRuntimeSource(name,source);assert.deepEqual(result.bytes,source);assert.equal(result.operands.length,2);
 const rule=PACKAGED_RELOCATION_RULES.find(r=>r.sourcePath===name);assert.equal(rule.packedPath,'code/'+name);
});
test('canonical source validation keeps exact counts and rejects new repository operands',()=>{
 const rule=PACKAGED_RELOCATION_RULES[0],operand=rule.operands[0].from,input=`import {} from '${operand}';\n`;
 assert.deepEqual(relocateDesktopRuntimeSource(rule.sourcePath,Buffer.from(input)).bytes,Buffer.from(input));
 for(const value of ['',input+input,input+"import {} from '../../../packages/wallet-auth/src/foreign.js';\n"])assert.throws(()=>relocateDesktopRuntimeSource(rule.sourcePath,Buffer.from(value)),/operand count|Unlisted repository operand/i);
});

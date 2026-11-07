/** Build/artifact custody only. Does not load Native, run producer posts, or qualify a helper/Source. */
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{execFileSync}from'node:child_process';import{fileURLToPath}from'node:url';import{isDeepStrictEqual,types}from'node:util';
import{assertSingle49NAPIImportLinkDATA,assertSingle49NAPIImageImportsDATA,assertSingle49NAPIHostReadbacksDATA}from'./original-auth-single49-napi-import-policy.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),role=JSON.parse(fs.readFileSync(path.join(here,'native49-napi-normal-component.data.json'),'utf8'));
const fail=c=>{throw Object.assign(Error('NATIVE49_NAPI_'+c),{code:'NATIVE49_NAPI_'+c});},same=(a,b,c)=>{if(!isDeepStrictEqual(a,b))fail(c);},hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function pinned(b,r,c){if(!Buffer.isBuffer(b)||b.length!==r.bytes||hash(b)!==r.sha256)fail(c);return b;}
function regular(p,max=16<<20){if(typeof p!=='string'||!path.isAbsolute(p)||path.normalize(p)!==p)fail('ABSOLUTE_FILE');let cursor=path.parse(p).root;for(const v of p.slice(cursor.length).split('/')){cursor=path.join(cursor,v);if(fs.lstatSync(cursor).isSymbolicLink())fail('SYMLINK');}const a=fs.lstatSync(p);if(!a.isFile()||a.size>max)fail('REGULAR_FILE');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const b=fs.fstatSync(fd),raw=fs.readFileSync(fd),z=fs.fstatSync(fd),named=fs.lstatSync(p);if(a.dev!==b.dev||a.ino!==b.ino||a.size!==b.size||z.size!==b.size||z.mtimeMs!==b.mtimeMs||z.ctimeMs!==b.ctimeMs||named.ino!==b.ino||named.dev!==b.dev||raw.length!==b.size)fail('FILE_RACE');return raw;}finally{fs.closeSync(fd);}}
const result=()=>Object.freeze({kind:role.kind,nodeArtifactBytesVerified:true,recordBytesVerified:true,reusedCPP:84,reusedSwift:1,newCPPCompiles:0,newSwiftCompiles:0,ledgerActions:16,NodeLoadRecorded:true,ElectronLoadRecorded:true,minimumSystemVersion:'13.5',sourceRoles:Object.freeze({...role.sourceRoles}),helperQualification:'SEPARATE_APPROVED125A_ROLE_REQUIRED',JSRuntimeQualification:'SEPARATE_ROLE_REQUIRED',RootAdmission:false,SourceAdmission:false,NativeAdmission:false,NativeLoadedByReader:false,wholeAppReady:false,installed:false,businessVerified:false});
export function inspectNative49NAPINormalRecordDATA(recordBytes,sourceRoles){
 pinned(recordBytes,role.record,'RECORD_BYTES');same(sourceRoles,role.sourceRoles,'SOURCE_ROLES');
 const r=JSON.parse(recordBytes),p=JSON.parse(pinned(regular(path.join(here,role.independentPlan.sourceRelative)),role.independentPlan,'INDEPENDENT_PLAN'));
 same(r.kind,'YNX_SINGLE49_RETAINED85_FINITE_NAPI_RELINK_RECORD/v1','RECORD_KIND');same(r.plan,p,'EXACT_PLAN');
 same(p.sourceCommit,role.sourceRoles.relinkProducerCommit,'PRODUCER_COMMIT');same(p.sourceTree,role.sourceRoles.relinkProducerTree,'PRODUCER_TREE');same(p.objects,role.objects85,'RETAINED_OBJECTS');same(p.objects.length,85,'RETAINED_COUNT');same(p.archive,role.archive,'ARCHIVE');same(p.reusedCPP,84,'CPP_REUSE');same(p.reusedSwift,1,'SWIFT_REUSE');same(p.newCompiles,0,'NO_NEW_COMPILES');same(p.newGoBuild,false,'NO_GO');same(p.postCommands.length,7,'ORIGINAL_POST_COUNT');
 same(r.newCPPCompiles,0,'NO_CPP');same(r.newSwiftCompiles,0,'NO_SWIFT');same(r.GoBuild,false,'NO_GO');same(r.complete,true,'COMPLETE');same(r.NodeLoad,true,'NODE_LOAD');same(r.ElectronLoad,true,'ELECTRON_LOAD');for(const k of ['RootAdmission','SourceAdmission','NativeAdmission','installed','normalFactoryComplete'])same(r[k],false,'AUTHORITY_BOUNDARY');
 same(r.image,role.image,'IMAGE_RECORD');same(r.runtime.length,8,'RUNTIME_COUNT');same(r.ledger.length,16,'NEW_LEDGER_COUNT');same(p.commands.length,16,'NEW_COMMAND_COUNT');
 for(let i=0;i<16;i++){const a=r.ledger[i],c=p.commands[i];same(a.tool,c.tool,'COMMAND_TOOL');same(a.argv,c.argv,'COMMAND_ARGV');same(a.electronRunAsNode??false,c.electronRunAsNode??false,'ELECTRON_MODE');same(a.exit,0,'COMMAND_EXIT');same(a.signal,null,'COMMAND_SIGNAL');same(a.error,null,'COMMAND_ERROR');}
 assertSingle49NAPIImportLinkDATA(p.commands[0].argv);same(p.commands[0].argv.filter(a=>a.endsWith('.o')),role.objects85.map(a=>a.path),'LINK_OBJECTS');same(p.commands[0].argv.filter(a=>a.endsWith('.a')),[role.archive.path],'ONE_ARCHIVE');
 if(p.commands.some(c=>c.argv.includes('-c')||c.argv.includes('-emit-object')||/\/go$/.test(c.tool)))fail('NO_CPP_SWIFT_GO_COMPILE');
 const t=p.commands[0].argv.indexOf('-target');same(p.commands[0].argv[t+1],'arm64-apple-macosx13.5','MINIMUM13_5');
 const actual=role.actualOriginals;
 for(const[k,i]of[['nmOriginal',2],['nodeReadbackOriginal',10],['electronReadbackOriginal',11]])same(hash(Buffer.from(actual[k])),r.ledger[i].stdoutSHA256,'ORIGINAL_LOG_BINDING');
 assertSingle49NAPIImageImportsDATA(actual.nmOriginal);assertSingle49NAPIHostReadbacksDATA(JSON.parse(actual.nodeReadbackOriginal),JSON.parse(actual.electronReadbackOriginal),role.image);
 for(const row of r.runtime){const a=role.artifacts.find(a=>a.source===row.path);if(!a)fail('RUNTIME_ORIGINAL_PATH');same({bytes:row.bytes,sha256:row.sha256},{bytes:a.bytes,sha256:a.sha256},'RUNTIME_RECORD_PIN');}
 return Object.freeze({newRecordDataVerified:true,actual16LedgerAndBothRuntimeOriginalsBound:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
export function verifyNative49NAPINormalNodeComponent({recordBytes,moduleBytes,runtimeFiles,sourceRoles}){
 inspectNative49NAPINormalRecordDATA(recordBytes,sourceRoles);pinned(moduleBytes,role.image,'IMAGE_BYTES');
 if(!runtimeFiles||types.isProxy(runtimeFiles)||Object.getPrototypeOf(runtimeFiles)!==Object.prototype)fail('RUNTIME_FILES');
 same(Reflect.ownKeys(runtimeFiles).sort(),role.artifacts.map(a=>a.path).sort(),'RUNTIME_SET');
 for(const a of role.artifacts){const d=Object.getOwnPropertyDescriptor(runtimeFiles,a.path);if(!d||!Object.hasOwn(d,'value'))fail('RUNTIME_DESCRIPTOR');pinned(d.value,a,'RUNTIME_BYTES');if(a.path.endsWith('.node'))same(d.value,moduleBytes,'NODE_RUNTIME_BYTES');}return result();
}
function verifyOriginalGitGroups(){
 const git=(...args)=>execFileSync('/usr/bin/git',['-C',role.sourceRoot,...args],{encoding:'utf8',maxBuffer:16<<20}).trim();let rows=0;
 for(const g of role.sourceGroups){same(git('rev-parse',g.commit+'^{tree}'),g.tree,'ORIGINAL_GIT_TREE');const requests=g.rows.map(r=>{if(!/^[\x20-\x7e]+$/.test(r.path)||r.path.includes(':')||path.posix.normalize(r.path)!==r.path||path.posix.isAbsolute(r.path)||r.path.split('/').includes('..'))fail('GIT_RELATIVE_PATH');return g.commit+':'+r.path;}).join('\n')+'\n';const raw=execFileSync('/usr/bin/git',['-C',role.sourceRoot,'cat-file','--batch'],{input:requests,maxBuffer:512<<20});let at=0;
  for(const r of g.rows){const e=raw.indexOf(10,at);if(e<0)fail('GIT_BATCH');const header=raw.subarray(at,e).toString();const m=/^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);if(!m)fail('GIT_BLOB');const n=Number(m[2]);at=e+1;const b=raw.subarray(at,at+n);pinned(b,r,'ORIGINAL_GIT_BYTES');if(crypto.createHash('sha1').update('blob '+n+'\0').update(b).digest('hex')!==m[1]||raw[at+n]!==10)fail('GIT_BLOB_HASH');at+=n+1;rows++;}if(at!==raw.length)fail('GIT_BATCH_EXTRA');
 }return rows;
}
/** Fixed original A public artifact read; validates recorded production evidence.
 * Does not import/run the producer, execute nm/Native, or repeat its old85/post tests.
 */
export function readNative49NAPINormalNodeComponent(){
 pinned(regular(role.qualifiedH.path),role.qualifiedH,'QUALIFIED_HANDOFF');const sourceRows=verifyOriginalGitGroups();
 const recordBytes=pinned(regular(role.record.path),role.record,'RECORD_BYTES'),runtimeFiles={};
 for(const a of role.artifacts){runtimeFiles[a.path]=pinned(regular(a.source),a,'RUNTIME_ORIGINAL');if((fs.lstatSync(a.source).mode&0o777)!==a.mode)fail('RUNTIME_MODE');}
 return {...verifyNative49NAPINormalNodeComponent({recordBytes,moduleBytes:runtimeFiles['apps/wallet-desktop/native/original-auth-identity.node'],runtimeFiles,sourceRoles:role.sourceRoles}),originalGitSourceRows:sourceRows,sourceRolesVerifiedAtIndependentOriginalGit:true};
}
export function verifyNative49NAPIPackagedNode({readPackedAsset,sourceRoles}){
 if(typeof readPackedAsset!=='function')fail('PACKAGE_ASSET_READER');const runtimeFiles={};for(const a of role.artifacts)runtimeFiles[a.path]=readPackedAsset(a.path);
 return verifyNative49NAPINormalNodeComponent({recordBytes:readPackedAsset('apps/wallet-desktop/native/NATIVE49_NAPI_NORMAL_RECORD.json'),moduleBytes:runtimeFiles['apps/wallet-desktop/native/original-auth-identity.node'],runtimeFiles,sourceRoles});
}
export function stageNative49NAPIFixedInput(outputRoot){
 if(typeof outputRoot!=='string'||!path.isAbsolute(outputRoot)||path.normalize(outputRoot)!==outputRoot||fs.existsSync(outputRoot)||fs.realpathSync(path.dirname(outputRoot))!==path.dirname(outputRoot))fail('FRESH_FIXED_INPUT_REQUIRED');const verified=readNative49NAPINormalNodeComponent();
 // All immutable original bytes were verified before first output effect.
 const captured=role.artifacts.map(a=>({row:a,bytes:pinned(regular(a.source),a,'INPUT_ORIGINAL')}));const recordBytes=pinned(regular(role.record.path),role.record,'INPUT_RECORD');
 fs.mkdirSync(outputRoot,{mode:0o700});const write=(name,b,mode)=>{const p=path.join(outputRoot,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b,{flag:'wx',mode});fs.chmodSync(p,mode);};
 for(const a of captured)write(a.row.path,a.bytes,a.row.mode);write('apps/wallet-desktop/native/NATIVE49_NAPI_NORMAL_RECORD.json',recordBytes,0o644);
 verifyNative49NAPIPackagedNode({readPackedAsset:name=>regular(path.join(outputRoot,name)),sourceRoles:role.sourceRoles});return{...verified,inputRoot:outputRoot,assets:10,old4207Overwritten:false,recordRewritten:false};
}
export const native49NAPINormalNodeComponent=Object.freeze({inspectRecord:inspectNative49NAPINormalRecordDATA,verify:verifyNative49NAPINormalNodeComponent,read:readNative49NAPINormalNodeComponent,verifyPackage:verifyNative49NAPIPackagedNode,stageFixedInput:stageNative49NAPIFixedInput});
if(process.argv[1]===fileURLToPath(import.meta.url)){if(process.argv.length===3&&process.argv[2]==='--read')console.log(JSON.stringify(readNative49NAPINormalNodeComponent(),null,2));else if(process.argv.length===4&&process.argv[2]==='--stage-fixed-input')console.log(JSON.stringify(stageNative49NAPIFixedInput(process.argv[3]),null,2));else fail('EXACT_ARGV');}

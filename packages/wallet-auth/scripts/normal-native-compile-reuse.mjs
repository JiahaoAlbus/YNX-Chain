// Offline build-receipt adapter. Never compiles, loads a module, changes an
// executed record, copies artifacts, or grants Native/Source qualification.
import {readFileSync,lstatSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,join,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b,code)=>{if(!isDeepStrictEqual(a,b))fail(code);};
function regular(file){
 if(typeof file!=='string'||!isAbsolute(file)||resolve(file)!==file)fail('NATIVE_REUSE_PATH');
 let at=file;for(;;){const st=lstatSync(at);if(st.isSymbolicLink())fail('NATIVE_REUSE_SYMLINK');if(at===file&&!st.isFile())fail('NATIVE_REUSE_NOT_FILE');if(at===dirname(at))break;at=dirname(at);}
 return readFileSync(file);
}
function relative(p){if(typeof p!=='string'||p.includes('\\')||isAbsolute(p)||p.split('/').some(x=>!x||x==='.'||x==='..'))fail('NATIVE_REUSE_RELATIVE');return p;}
function pinned(ref,root,allowEmptyRuntimeFile=false){
 if(!ref||!Number.isSafeInteger(ref.bytes)||ref.bytes<(allowEmptyRuntimeFile?0:1)||!/^[a-f0-9]{64}$/.test(ref.sha256))fail('NATIVE_REUSE_PIN');
 const file=root?join(root,relative(ref.path)):ref.path,b=regular(file);
 if(b.length!==ref.bytes||sha(b)!==ref.sha256)fail('NATIVE_REUSE_INPUT_DIFFERS');return b;
}
const pin=(path,b)=>({path,bytes:b.length,sha256:sha(b)});
function json(file){const raw=regular(file);if(raw.length>32*1024*1024)fail('NATIVE_REUSE_CAP');return {raw,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),pin:pin(file,raw)};}
function normalize(token,root){
 // Only physical path tokens and -I paths. Never strip roots from arbitrary
 // macro/string tokens or accept a sibling whose prefix happens to match.
 if(token===root||token.startsWith(root+'/'))return '<SOURCE>'+token.slice(root.length);
 if(token==='-I'+root||token.startsWith('-I'+root+'/'))return '-I<SOURCE>'+token.slice(root.length+2);
 return token;
}
function planIdentity(plan,root,count){
 if(!plan||!Array.isArray(plan.sources)||plan.sources.length!==count||new Set(plan.sources).size!==count||!Array.isArray(plan.commands)||plan.commands.length!==1)fail('NATIVE_REUSE_PLAN');
 for(const p of plan.sources)if(!p.startsWith(root+'/'))fail('NATIVE_REUSE_PLAN_ROOT');
 const command=plan.commands[0];if(command.tool!=='/usr/bin/clang++'||!Array.isArray(command.argv)||command.argv.some(v=>typeof v!=='string')||command.argv.filter(v=>v==='-arch').length!==1||command.argv[command.argv.indexOf('-arch')+1]!=='arm64')fail('NATIVE_REUSE_ABI');
 if(command.argv.some(v=>/YNX_ORIGINAL_WALLET_ARTIFACT_|libynx_artifact_release/.test(v)))fail('NATIVE_REUSE_NONBASE_ROLE');
 same(command.argv.slice(command.argv.indexOf(plan.sources[0]),command.argv.lastIndexOf('-o')),plan.sources,'NATIVE_REUSE_TU_ORDER');
 if(command.argv.at(-2)!=='-o'||command.argv.at(-1)!==plan.output)fail('NATIVE_REUSE_OUTPUT');
 const scan=plan.ownedUndefinedScan;if(scan?.tool!=='/usr/bin/nm'||scan.rejectPattern!=='YNX|ynx'||!isDeepStrictEqual(scan.argv,['-u',plan.output]))fail('NATIVE_REUSE_SCAN');
 return {sources:plan.sources.map(s=>normalize(s,root)),commands:plan.commands.map(c=>({tool:c.tool,argv:c.argv.map(t=>normalize(t,root))})),output:normalize(plan.output,root),outputs:plan.outputs?.map(p=>normalize(p,root)),minimumSystemVersion:plan.minimumSystemVersion,ownedUndefinedScan:{tool:scan.tool,argv:scan.argv.map(t=>normalize(t,root)),rejectPattern:scan.rejectPattern}};
}
function manifest(ref,root){
 const raw=pinned(ref),m=JSON.parse(raw);if(m.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||!Array.isArray(m.files)||!m.files.length)fail('NATIVE_REUSE_RUNTIME');
 const seen=new Set();for(const f of m.files){if(seen.has(f.path))fail('NATIVE_REUSE_DUPLICATE');seen.add(f.path);pinned(f,root,true);}if(!seen.has('package.json'))fail('NATIVE_REUSE_RUNTIME_PACKAGE');
 return {ref:pin(ref.path,raw),files:m.files.length};
}
function tuple(file,actualSchema=false){
 const input=json(file),t=input.body;if(!['1.3.0-pq.3.32-auth.23','1.3.0-pq.3.32-auth.24'].includes(t.version)||typeof t.sourceRoot!=='string'||realpathSync(t.sourceRoot)!==t.sourceRoot)fail('NATIVE_REUSE_TUPLE');
 if(t.plansRef){t.plans=JSON.parse(pinned(t.plansRef));}
 const invRaw=pinned(t.inventory),inv=JSON.parse(invRaw);if(inv.version!==t.version)fail('NATIVE_REUSE_VERSION');
 const rows=[...inv.NativeInputs,...inv.HelperInputs,...inv.pureDeploymentInputs,inv.normalBuildTool],count=t.version.endsWith('.23')?92:95;
 if(rows.length!==count||new Set(rows.map(p=>p.path)).size!==count)fail('NATIVE_REUSE_NORMAL_COUNT');
 for(const p of rows)pinned(p,t.sourceRoot);
 const cpp=rows.filter(p=>/\.(?:h|mm|cpp)$/.test(p.path)).sort((a,b)=>a.path.localeCompare(b.path));if(cpp.length!==77)fail('NATIVE_REUSE_CPP_COUNT');
 const identities={node:planIdentity(t.plans.node,t.sourceRoot,13),helper:planIdentity(t.plans.helper,t.sourceRoot,11)};
 for(const role of ['node','helper'])for(const f of t.plans[role].sources)if(!cpp.some(p=>join(t.sourceRoot,p.path)===f))fail('NATIVE_REUSE_UNDECLARED_TU');
 const runtime=manifest(t.runtime.manifest,t.runtime.root),pkg=JSON.parse(regular(join(t.runtime.root,'package.json')));if(pkg.name!=='@ynx-chain/wallet-auth'||pkg.version!==t.version)fail('NATIVE_REUSE_RUNTIME_VERSION');
 if(!actualSchema){
 const a=t.toolchain?.abi;if(a?.platform!=='darwin'||a.arch!=='arm64'||a.napiVersion!==8||a.headerVersion!=='22.13.1'||a.minimumSystemVersion!=='13.0')fail('NATIVE_REUSE_ABI');
 // Exact compiler, full SDK/header inventory evidence and ABI observation are
 // supplied by the original builder, never inferred from matching source.
 for(const name of ['compiler','sdkInventory','headersInventory','abiObservation'])pinned(t.toolchain[name]);
 }
 return {input,t,rows,cpp,identities,runtime,inventory:pin(t.inventory.path,invRaw)};
}
const actualPhases=['COW_EXACT_SDK23_SOURCE','COW_EXACT_SDK23_RUNTIME','EXACT_ALL_INPUT_PRECHECK','NORMAL_EXPORTED_PLAN_ONLY','NORMAL_NODE13_BUILD','NORMAL_HELPER11_BUILD','NODE_MACHO','NODE_ARCH','NODE_OWN_UNDEFINED','NODE_LIBRARIES','HELPER_MACHO','HELPER_ARCH','HELPER_OWN_UNDEFINED','HELPER_LIBRARIES','ACTUAL_PASSIVE_NODE_NAPI_LOAD','ACTUAL_PASSIVE_ELECTRON_NAPI_LOAD','EXACT_ALL_INPUT_POSTCHECK'];
const capturedCompiler='/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++';
function actualAReuse(request,original,record){
 const {sourceTuplePath,targetTuplePath,executedRecord,executionEvidence}=request;
 if(record.executed!==true||record.SDKVersion!=='1.3.0-pq.3.32-auth.23'||record.NAPI_VERSION!==8||record.headerVersion!=='22.13.1')fail('NATIVE_REUSE_RECORD');
 if(!executionEvidence)fail('NATIVE_REUSE_EXECUTION_EVIDENCE');
 const evidenceRaw=pinned(executionEvidence),e=JSON.parse(evidenceRaw),observed=[];
 const read=ref=>{const b=pinned(ref);observed.push([ref,b]);return JSON.parse(b);};
 same(e.originalExecutedRecord,executedRecord,'NATIVE_REUSE_EVIDENCE_RECORD');
 const full=read(e.originalFullH),final=read(e.finalH),limitation=read(e.mandatoryLimitation);
 if(full.schema!=='SDK23_ORIGINAL_A_BASE_NATIVE_COMPLETE_MATCHING_HANDOFF_V1'||final.schema!=='SDK23_CONTENT_EXECUTION_COMPLETE_WITH_MATERIALIZATION_LIMITATION_V1'||limitation.schema!=='SDK23_MATERIALIZATION_EVIDENCE_LIMITATION_V1')fail('NATIVE_REUSE_ACTUAL_HANDOFF');
 same(full.actualExecutedRecord,executedRecord,'NATIVE_REUSE_EVIDENCE_RECORD');same(final.executedRecord,executedRecord,'NATIVE_REUSE_EVIDENCE_RECORD');same(limitation.executedRecord,executedRecord,'NATIVE_REUSE_EVIDENCE_RECORD');
 same(final.originalFullH,e.originalFullH,'NATIVE_REUSE_ACTUAL_HANDOFF');same(limitation.originalH,e.originalFullH,'NATIVE_REUSE_ACTUAL_HANDOFF');same(final.mandatoryLimitation,e.mandatoryLimitation,'NATIVE_REUSE_MATERIALIZATION');
 if(full.sourceCommit!==record.sourceCommit||final.sourceCommit!==record.sourceCommit||full.SDKVersion!==record.SDKVersion||final.SDKVersion!==record.SDKVersion)fail('NATIVE_REUSE_ACTUAL_HANDOFF');
 if(final.strictCOWQualified!==false||final.copyPhysicalFallbackUnknown!==true||limitation.copyPrimitive?.primitiveGuaranteesNoFallback!==false||limitation.copyPrimitive?.actualCloneUsed!=='UNKNOWN'||limitation.copyPrimitive?.physicalCopyFallbackOccurred!=='UNKNOWN'||limitation.qualification?.materializationStrictCOWQualification!==false)fail('NATIVE_REUSE_MATERIALIZATION');
 for(const key of ['NativeQualified','helperExecuted','helperRegistered','installed','GUI','SourceGranted','projectFactoryCalled','getterCalled','accountKeysTouched'])if(record[key]!==false)fail('NATIVE_REUSE_ACTUAL_BOUNDARY');
 if(!Array.isArray(full.directReferences))fail('NATIVE_REUSE_ACTUAL_HANDOFF');
 const supplied=ref=>{if(!full.directReferences.some(x=>isDeepStrictEqual(x,ref)))fail('NATIVE_REUSE_UNSUPPLIED_READBACK');return read(ref);};
 const result=supplied(record.guard?.result),children=supplied(e.actualChildToolArgv);
 if(result.noInflight!==true||full.noInflight!==true||final.noInflight!==true||!Array.isArray(result.owned)||result.owned.length===0||result.owned.some(x=>!Number.isSafeInteger(x.pid)||x.pid<1||typeof x.start!=='string'||!/^([a-f0-9]{2}){16}$/.test(x.start)||x.present!==false))fail('NATIVE_REUSE_OWNED');
 same(record.actualSteps,result.terms,'NATIVE_REUSE_ACTUAL_STEPS');
 same(record.actualSteps?.map(x=>x.phase),actualPhases,'NATIVE_REUSE_ACTUAL_STEPS');
 let previousEnd=-Infinity;for(const step of record.actualSteps){
  if(step.actualExit!==0||step.guard!==null||!Number.isSafeInteger(step.pid)||step.pid<1||!Number.isFinite(step.start)||!Number.isFinite(step.end)||step.end<step.start||!Array.isArray(step.argv)||step.argv.some(x=>typeof x!=='string'))fail('NATIVE_REUSE_ACTUAL_STEPS');
  if(step.start<previousEnd)fail('NATIVE_REUSE_ACTUAL_STEPS');previousEnd=step.end;
  const base=join(dirname(executedRecord.path),step.phase),rr=full.directReferences.find(x=>x.path===base+'.request.json'),tr=full.directReferences.find(x=>x.path===base+'.terminal.json');
  const req=supplied(rr),terminal=supplied(tr);
  for(const key of ['phase','pid','argv','cwd','start'])same(req[key],step[key],'NATIVE_REUSE_ACTUAL_STEPS');
  for(const key of ['phase','pid','argv','cwd','start','actualExit','end','guard'])same(terminal[key],step[key],'NATIVE_REUSE_ACTUAL_STEPS');
  if(!result.owned.some(x=>x.pid===step.pid))fail('NATIVE_REUSE_OWNED');
 }
 same(full.allPhases,record.actualSteps.map(({phase,actualExit,guard,pid})=>({phase,actualExit,guard,pid})),'NATIVE_REUSE_ACTUAL_STEPS');same(final.allPhases,full.allPhases,'NATIVE_REUSE_ACTUAL_STEPS');
 const normal=read(record.normalManifest);
 const normalRows=[...normal.NativeInputs,...normal.HelperInputs,...normal.pureDeploymentInputs,normal.normalBuildTool];
 const inputs=[...record.inputFiles,...record.helperAdditionalInputs,...record.otherExactInputs];
 if(record.inputFiles.length!==82||record.helperAdditionalInputs.length!==5||record.otherExactInputs.length!==5||normalRows.length!==92)fail('NATIVE_REUSE_RECORD_INPUT');
 // Original A captured only the final build tool as an absolute ref. It must
 // equal record.builder exactly, with no invented or arbitrary missing relative.
 const tool=normalRows.at(-1);same(inputs.at(-1),record.builder,'NATIVE_REUSE_RECORD_INPUT');
 same(record.builder,{path:join(record.sourceRoot,relative(tool.path)),bytes:tool.bytes,sha256:tool.sha256},'NATIVE_REUSE_RECORD_INPUT');
 const mapped=inputs.slice(0,-1).map(row=>{
  if(typeof row.relative!=='string'||row.path!==join(record.sourceRoot,relative(row.relative)))fail('NATIVE_REUSE_RECORD_INPUT');
  return {path:row.relative,bytes:row.bytes,sha256:row.sha256};
 });
 same([...mapped,tool],normalRows,'NATIVE_REUSE_RECORD_INPUT');
 const source=tuple(sourceTuplePath,true),target=tuple(targetTuplePath,true);
 if(!target.t.version.endsWith('.24')||record.sourceRoot!==source.t.sourceRoot||full.sourceRoot!==record.sourceRoot||source.t.runtime.root!==record.runtime?.root)fail('NATIVE_REUSE_ACTUAL_SOURCE');
 same(source.cpp,target.cpp,'NATIVE_REUSE_CPP_DIFFERS');same(source.identities,target.identities,'NATIVE_REUSE_PLAN_DIFFERS');
 same(record.inputCounts,{Native:82,helperAdditional:5,pure:4,tool:1,normal92:92},'NATIVE_REUSE_NORMAL_COUNT');
 same(record.builder,{path:join(record.sourceRoot,source.rows.at(-1).path),bytes:source.rows.at(-1).bytes,sha256:source.rows.at(-1).sha256},'NATIVE_REUSE_RECORD_INPUT');
 if(normal.version!==source.t.version||normal.commit!==record.nativeParent)fail('NATIVE_REUSE_SOURCE_INVENTORY');
 same(normalRows,source.rows,'NATIVE_REUSE_SOURCE_INVENTORY');
 same(source.t.plans, supplied(e.plans),'NATIVE_REUSE_PLAN_DIFFERS');
 const toolMappings=[];
 if(!Array.isArray(record.actualCompilerDrivers)||record.actualCompilerDrivers.length!==2||!Array.isArray(children))fail('NATIVE_REUSE_ACTUAL_DRIVER');
 for(const [role,count,phase] of [['node',13,'NORMAL_NODE13_BUILD'],['helper',11,'NORMAL_HELPER11_BUILD']]){
  const driver=record.actualCompilerDrivers.find(d=>d.role===role),plan=source.t.plans[role],actual=driver?.actual,step=record.actualSteps.find(x=>x.phase===phase);
  if(plan.minimumSystemVersion!=='13.0'||!plan.commands[0].argv.includes('-mmacosx-version-min=13.0'))fail('NATIVE_REUSE_ABI');
  if(driver?.translationUnits!==count||driver.exactArgvEqual!==true||!actual||actual.ppid!==step.pid||!Number.isSafeInteger(actual.pid)||!/^([a-f0-9]{2}){16}$/.test(actual.start)||actual.argv?.[0]!==capturedCompiler)fail('NATIVE_REUSE_ACTUAL_DRIVER');
  same(driver.normalPlanCommand,plan.commands[0],'NATIVE_REUSE_EXECUTED_COMMANDS');same(actual.argv.slice(1),plan.commands[0].argv,'NATIVE_REUSE_EXECUTED_COMMANDS');same(record[role==='node'?'nodeTUs':'helperTUs'],plan.sources,'NATIVE_REUSE_TU_ORDER');
  if(!children.some(x=>isDeepStrictEqual(x,actual))||!result.owned.some(x=>x.pid===actual.pid&&x.start===actual.start))fail('NATIVE_REUSE_ACTUAL_DRIVER');
  toolMappings.push({launcher:plan.commands[0].tool,capturedDriver:actual.argv[0],capturedPID:actual.pid,capturedStart:actual.start});
 }
 same(record.ownedUndefined,{Node:[],helper:[]},'NATIVE_REUSE_SCAN');
 for(const [phase,role] of [['NODE_OWN_UNDEFINED','node'],['HELPER_OWN_UNDEFINED','helper']]){
  const step=record.actualSteps.find(x=>x.phase===phase),scan=source.t.plans[role].ownedUndefinedScan;
  same(step.argv,[scan.tool,...scan.argv],'NATIVE_REUSE_SCAN_PLAN');
  const ref=full.directReferences.find(x=>x.path===join(dirname(executedRecord.path),'logs',phase+'.stdout'));
  const bytes=pinned(ref);observed.push([ref,bytes]);if(/YNX|ynx/.test(bytes.toString('utf8')))fail('NATIVE_REUSE_SCAN');
 }
 same(record.runtime.manifest,source.t.runtime.manifest,'NATIVE_REUSE_RUNTIME');
 const pre=supplied(record.runtime.PRE),post=supplied(record.runtime.POST);same(pre,post,'NATIVE_REUSE_CHANGED');
 for(const key of ['selectedSource122','normal92Exact','runtime9342Exact','fullHeader2368Exact','canonical5Exact'])if(pre[key]!==true)fail('NATIVE_REUSE_PREPOST');
 for(const row of source.rows){const found=pre.sourceRows?.find(x=>x.path===join(record.sourceRoot,row.path));same(found,{path:join(record.sourceRoot,row.path),bytes:row.bytes,sha256:row.sha256},'NATIVE_REUSE_PREPOST');}
 const selected=read(record.sourceManifest);
 if(selected.sourceCommit!==record.sourceCommit||selected.nativeParent!==record.nativeParent||selected.files?.length!==122||pre.sourceCommit!==record.sourceCommit||pre.sourceRows?.length!==122)fail('NATIVE_REUSE_PREPOST');
 for(const row of selected.files){const actual={path:join(record.sourceRoot,relative(row.relative)),bytes:row.bytes,sha256:row.sha256};if(!pre.sourceRows.some(x=>isDeepStrictEqual(x,actual)))fail('NATIVE_REUSE_PREPOST');pinned(actual);}
 const headers=read(record.completeHeadersInventory);
 // Preserve and read the original inventory shape, never invent a complete OS SDK capture.
 const headerRows=headers.allInputs;
 if(headers.headerRoot!==record.headerRoot||headers.headerVersion!==record.headerVersion||headers.sourceAndCopyExact!==true)fail('NATIVE_REUSE_HEADERS');
 if(!Array.isArray(headerRows)||headerRows.length!==2368)fail('NATIVE_REUSE_HEADERS');
 const seenHeaders=new Set();for(const h of headerRows){const f=join(record.headerRoot,relative(h.relative));if(seenHeaders.has(f))fail('NATIVE_REUSE_HEADERS');seenHeaders.add(f);pinned({...h,path:f});}
 if(!Array.isArray(record.header5)||record.header5.length!==5)fail('NATIVE_REUSE_HEADERS');for(const h of record.header5){if(!seenHeaders.has(h.path))fail('NATIVE_REUSE_HEADERS');pinned(h);}
 const artifacts={};for(const [role,key,type] of [['node','module',6],['helper','helper',2]]){
  const ref=record.artifacts[key];same(full.artifacts[key],ref,'NATIVE_REUSE_OUTPUT');same(final.artifacts[key],ref,'NATIVE_REUSE_OUTPUT');same(result.artifacts[key],ref,'NATIVE_REUSE_OUTPUT');
  if(ref.path!==source.t.plans[role].output)fail('NATIVE_REUSE_OUTPUT');const b=pinned(ref);if(b.length<32||b.readUInt32LE(0)!==0xfeedfacf||b.readUInt32LE(4)!==0x0100000c||b.readUInt32LE(12)!==type)fail('NATIVE_REUSE_MACHO');artifacts[role]={relative:ref.path.slice(record.sourceRoot.length+1),bytes:b.length,sha256:sha(b)};
 }
 for(const load of [record.normalNodeLoad,record.normalElectronLoad])if(load?.state!=='ACTUAL_MODULE_LOAD_EXACT_SOURCE_EXPORTS_PASS'||load.architecture!=='arm64'||load.qualified!==false||load.helperExecuted!==false||load.grant!==false||!Array.isArray(load.exports)||load.exports.length!==91)fail('NATIVE_REUSE_PASSIVE_LOAD');
 same(record.normalNodeLoad.exports,record.normalElectronLoad.exports,'NATIVE_REUSE_PASSIVE_LOAD');
 same(tuple(sourceTuplePath,true).input.pin,source.input.pin,'NATIVE_REUSE_CHANGED');same(tuple(targetTuplePath,true).input.pin,target.input.pin,'NATIVE_REUSE_CHANGED');
 for(const key of ['module','helper'])pinned(record.artifacts[key]);
 for(const [ref,bytes]of observed)if(!pinned(ref).equals(bytes))fail('NATIVE_REUSE_CHANGED');if(!pinned(executedRecord).equals(original)||!pinned(executionEvidence).equals(evidenceRaw))fail('NATIVE_REUSE_RECORD_CHANGED');
 return Object.freeze({kind:'YNX_NORMAL_NATIVE_COMPILE_REUSE_BINDING/v1',executed:false,originalExecutedRecord:pin(executedRecord.path,original),originalExecutionIndependentlyProven:false,executionEvidence:pin(executionEvidence.path,evidenceRaw),originalRecordSchema:record.schema,originalFullH:e.originalFullH,finalH:e.finalH,mandatoryLimitation:e.mandatoryLimitation,sourceTuple:source.input.pin,targetTuple:target.input.pin,compiledSourceVersion:source.t.version,targetRuntimeVersion:target.t.version,compileInputs:source.cpp,compileInputCount:77,nodeTranslationUnits:13,helperTranslationUnits:11,sourceNormalInputCount:source.rows.length,targetNormalInputCount:target.rows.length,sourceInventory:source.inventory,targetInventory:target.inventory,sourceRuntime:source.runtime,targetRuntime:target.runtime,toolchain:{abi:{platform:'darwin',arch:'arm64',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0'},capturedCompilerDriverMappings:toolMappings,completeHeadersInventory:record.completeHeadersInventory,canonicalHeaders:record.header5,passiveNodeVersions:record.normalNodeLoad.versions,passiveElectronVersions:record.normalElectronLoad.versions,compilerBinaryIndependentlyPinned:false,completeOSSDKIndependentlyCaptured:false},artifacts,exactCompileInputCompatible:true,artifactsFromOriginalExecution:true,targetRecompiled:false,sourcePathsInBinaryRetained:true,strictCOWQualified:false,copyPhysicalFallbackUnknown:true,helperExecuted:false,helperRegistered:false,NativeQualified:false,SourceActivated:false,AppBuilt:false,installed:false});
}
function actualRole(record,plan,root,fileType){
 if(record.readbackOnly!==false||record.commandsKind!=='executed-normal-build')fail('NATIVE_REUSE_NOT_EXECUTED');
 same(record.commands,plan.commands,'NATIVE_REUSE_EXECUTED_COMMANDS');same(record.exitCodes,plan.commands.map(()=>0),'NATIVE_REUSE_EXIT');
 const scan=record.ownedUndefinedScan;if(scan?.exit!==0||!/^[a-f0-9]{64}$/.test(scan.stdoutSHA256)||!Array.isArray(scan.ownedUndefined)||scan.ownedUndefined.length)fail('NATIVE_REUSE_SCAN');
 for(const k of ['tool','argv','rejectPattern'])same(scan[k],plan.ownedUndefinedScan[k],'NATIVE_REUSE_SCAN_PLAN');
 const output=record.output,expected=plan.output.slice(root.length+1);if(output?.relative!==expected)fail('NATIVE_REUSE_OUTPUT');const b=pinned({...output,path:output.relative},root);
 // arm64 Mach-O dylib (addon) / executable (helper). No dlopen/exec occurs.
 if(b.length<32||b.readUInt32LE(0)!==0xfeedfacf||b.readUInt32LE(4)!==0x0100000c||b.readUInt32LE(12)!==fileType)fail('NATIVE_REUSE_MACHO');
 return {relative:expected,bytes:b.length,sha256:sha(b)};
}
/** Tuple files are original-builder DATA: sourceRoot/version/inventory pin,
 * original exported plans, exact normal runtime root+union manifest pin, and
 * toolchain {abi,compiler,sdkInventory,headersInventory,abiObservation} pins.
 * plansRef may pin the original builder's {node,helper} exported JSON directly.
 * executionEvidence is a separate pinned builder readback: {originalExecutedRecord,toolchain}.
 * It binds the original record pin and captured toolchain without adding fields
 * to that executed record. It is evidence DATA, not independent proof of a process.
 * executedRecord is a pin of the ORIGINAL YNX_WALLET_ORIGINAL_NATIVE_BUILD.
 * This returns a derived non-executed binding, never edits/relabels that record.
 */
export function createNormalNativeCompileReuseBinding({sourceTuplePath,targetTuplePath,executedRecord,executionEvidence}){
 const original=pinned(executedRecord),record=JSON.parse(original);
 if(record.schema==='YNX_SDK23_R196_ORIGINAL_A_EXECUTED_NATIVE_RECORD_V1')return actualAReuse({sourceTuplePath,targetTuplePath,executedRecord,executionEvidence},original,record);
 if(record.schema!==undefined||record.kind!=='YNX_WALLET_ORIGINAL_NATIVE_BUILD'||record.schemaVersion!==1)fail('NATIVE_REUSE_RECORD');
 const source=tuple(sourceTuplePath),target=tuple(targetTuplePath);
 same(source.cpp,target.cpp,'NATIVE_REUSE_CPP_DIFFERS');same(source.identities,target.identities,'NATIVE_REUSE_PLAN_DIFFERS');same(source.t.toolchain,target.t.toolchain,'NATIVE_REUSE_TOOLCHAIN_DIFFERS');
 if(record.kind!=='YNX_WALLET_ORIGINAL_NATIVE_BUILD'||record.schemaVersion!==1||record.sourceRoot!==source.t.sourceRoot||record.napiVersion!==8||record.headerVersion!=='22.13.1'||record.minimumSystemVersion!=='13.0'||!record.helperBuild||record.helperBuild.kind!=='YNX_WALLET_ORIGINAL_HELPER_BUILD/v1'||record.helperBuild.executed!==true||record.helperBuild.sourceRoot!==record.sourceRoot)fail('NATIVE_REUSE_RECORD');
 same(record.architectures,['arm64'],'NATIVE_REUSE_ABI');same(record.helperBuild.architectures,['arm64'],'NATIVE_REUSE_ABI');
 same(record.sourceInventory,{relative:'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',bytes:source.inventory.bytes,sha256:source.inventory.sha256},'NATIVE_REUSE_SOURCE_INVENTORY');
 // Separate original-builder caps/readback binds this record and toolchain.
 // Never require a new field in, or retrofit, the original executed record.
 if(!executionEvidence)fail('NATIVE_REUSE_EXECUTION_EVIDENCE');
 const executionRaw=pinned(executionEvidence),caps=JSON.parse(executionRaw);
 same(caps.originalExecutedRecord,executedRecord,'NATIVE_REUSE_EVIDENCE_RECORD');
 same(caps.toolchain,source.t.toolchain,'NATIVE_REUSE_EVIDENCE_TOOLCHAIN');
 const seen=new Map();for(const p of [...record.inputFiles,...record.helperBuild.inputFiles]){const expected=source.rows.find(x=>x.path===p.relative);if(!expected||expected.bytes!==p.bytes||expected.sha256!==p.sha256)fail('NATIVE_REUSE_RECORD_INPUT');seen.set(p.relative,p);}for(const p of source.cpp)if(!seen.has(p.path))fail('NATIVE_REUSE_RECORD_CPP');
 const artifacts={node:actualRole(record,source.t.plans.node,record.sourceRoot,6),helper:actualRole(record.helperBuild,source.t.plans.helper,record.sourceRoot,2)};
 // Post-readback fences: neither tuple/runtime nor the original record may
 // change while the adapter verifies actual artifacts. No writes or callbacks.
 same(tuple(sourceTuplePath).input.pin,source.input.pin,'NATIVE_REUSE_CHANGED');same(tuple(targetTuplePath).input.pin,target.input.pin,'NATIVE_REUSE_CHANGED');if(!pinned(executedRecord).equals(original)||!pinned(executionEvidence).equals(executionRaw))fail('NATIVE_REUSE_RECORD_CHANGED');
 for(const role of ['node','helper']){const ref={path:artifacts[role].relative,bytes:artifacts[role].bytes,sha256:artifacts[role].sha256};pinned(ref,source.t.sourceRoot);}
 return Object.freeze({kind:'YNX_NORMAL_NATIVE_COMPILE_REUSE_BINDING/v1',executed:false,originalExecutedRecord:pin(executedRecord.path,original),originalExecutionIndependentlyProven:false,executionEvidence:pin(executionEvidence.path,executionRaw),sourceTuple:source.input.pin,targetTuple:target.input.pin,compiledSourceVersion:source.t.version,targetRuntimeVersion:target.t.version,compileInputs:source.cpp,compileInputCount:77,nodeTranslationUnits:13,helperTranslationUnits:11,sourceNormalInputCount:source.rows.length,targetNormalInputCount:target.rows.length,sourceInventory:source.inventory,targetInventory:target.inventory,sourceRuntime:source.runtime,targetRuntime:target.runtime,toolchain:source.t.toolchain,artifacts,exactCompileInputCompatible:true,artifactsFromOriginalExecution:true,targetRecompiled:false,sourcePathsInBinaryRetained:true,NativeQualified:false,SourceActivated:false,AppBuilt:false,installed:false});
}

/** Consumer verification of the SAME derived schema, not another receipt. */
export function verifyNormalNativeCompileReuseBinding({request,receipt}){
 const original=pinned(receipt),actual=JSON.parse(original);
 same(actual,createNormalNativeCompileReuseBinding(request),'NATIVE_REUSE_DERIVED_RECEIPT_DIFFERS');
 return Object.freeze({receipt:pin(receipt.path,original),executed:false,NativeQualified:false,SourceActivated:false});
}

// Explicit offline normal-receipt entry. Original A supplies pinned original
// records; output is exclusive. --verify uses exactly the same schema/reader.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==6||process.argv[2]!=='--request'||!['--output','--verify'].includes(process.argv[4]))fail('NATIVE_REUSE_ARGUMENTS');
 const request=json(resolve(process.argv[3]));
 if(process.argv[4]==='--verify'){
  const file=resolve(process.argv[5]);
  console.log(JSON.stringify(verifyNormalNativeCompileReuseBinding({request:request.body,receipt:pin(file,regular(file))})));
 }else{
  const receipt=createNormalNativeCompileReuseBinding(request.body);
  writeFileSync(resolve(process.argv[5]),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({output:resolve(process.argv[5]),executed:false,NativeQualified:false}));
 }
}

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
function pinned(ref,root){
 if(!ref||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||!/^[a-f0-9]{64}$/.test(ref.sha256))fail('NATIVE_REUSE_PIN');
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
 const seen=new Set();for(const f of m.files){if(seen.has(f.path))fail('NATIVE_REUSE_DUPLICATE');seen.add(f.path);pinned(f,root);}if(!seen.has('package.json'))fail('NATIVE_REUSE_RUNTIME_PACKAGE');
 return {ref:pin(ref.path,raw),files:m.files.length};
}
function tuple(file){
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
 const a=t.toolchain?.abi;if(a?.platform!=='darwin'||a.arch!=='arm64'||a.napiVersion!==8||a.headerVersion!=='22.13.1'||a.minimumSystemVersion!=='13.0')fail('NATIVE_REUSE_ABI');
 // Exact compiler, full SDK/header inventory evidence and ABI observation are
 // supplied by the original builder, never inferred from matching source.
 for(const name of ['compiler','sdkInventory','headersInventory','abiObservation'])pinned(t.toolchain[name]);
 return {input,t,rows,cpp,identities,runtime,inventory:pin(t.inventory.path,invRaw)};
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
 const source=tuple(sourceTuplePath),target=tuple(targetTuplePath);
 same(source.cpp,target.cpp,'NATIVE_REUSE_CPP_DIFFERS');same(source.identities,target.identities,'NATIVE_REUSE_PLAN_DIFFERS');same(source.t.toolchain,target.t.toolchain,'NATIVE_REUSE_TOOLCHAIN_DIFFERS');
 const original=pinned(executedRecord),record=JSON.parse(original);
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

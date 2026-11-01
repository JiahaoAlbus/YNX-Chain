import {readFileSync,lstatSync,statSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {nativeContinuationFilePin} from './wallet-native-continuation.mjs';
const fail=()=>{throw Error('WALLET_NATIVE_SDK46_FINALIZATION_DIFFERS');};
const same=(a,b)=>{if(!isDeepStrictEqual(a,b))fail();};
export const SDK46_FINALIZATION_ROOT='/Volumes/西部数据/YNX-large-work/original-a-builds/wallet-ee565-sdk46-native100-target-20261026';
export const SDK46_FINALIZATION_HANDOFF=Object.freeze({path:SDK46_FINALIZATION_ROOT+'/header-remaining-once/EE565_SDK46_ACTUAL_COMPILED_RECORD_VALIDATOR_FIRSTCAUSE_HANDOFF.json',bytes:115851,sha256:'6f51105fa2c5f0543c077b8f1cdbde6d00d8cbaeb4e95c3387f2bac2fd945925'});
export const SDK46_FINALIZATION_OUTPUT_DIGEST='b5d869931f71a25d80aacb7d260fbce0c33348020d4052d9907fe5bd4a856d9f';
const outputDigest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
export const SDK46_FINALIZATION_OVERLAY=Object.freeze(['apps/wallet-desktop/scripts/sdk13-native-component.mjs','apps/wallet-desktop/scripts/build-wallet-native-component.mjs','apps/wallet-desktop/scripts/canonical-package.mjs','apps/wallet-desktop/scripts/wallet-native-record-finalization.mjs']);
const sourceRoot=SDK46_FINALIZATION_ROOT+'/source',attempt=SDK46_FINALIZATION_ROOT+'/header-remaining-once';
function check(p){
 if(!p||!path.isAbsolute(p.path??'')||!Number.isSafeInteger(p.bytes)||p.bytes<0||!/^[a-f0-9]{64}$/.test(p.sha256??''))fail();
 if(p.resolved&&realpathSync(p.path)!==p.resolved)fail();
 const actual=nativeContinuationFilePin(p.path),s=statSync(p.path);if(actual.bytes!==p.bytes||actual.sha256!==p.sha256||p.UID!==undefined&&s.uid!==p.UID||p.mode!==undefined&&(p.mode<=0o777?s.mode&0o777:s.mode)!==p.mode)fail();return actual;
}
// Public controlled-test seam. Only the fixed original H below can reach the
// producer. This is same-attempt finalization, NOT cache/compilation reuse or
// independent qualification of the Swift transitive module/toolchain closure.
export function assertSDK46FinalizationCore({handoff,node,helper,repo,headers,request,result,children}){
 if(repo!==sourceRoot||handoff.sourceCommitRequested!=='ee565ca9213d4267f099bf21940168cc0ec14f26'||handoff.sdk!=='1.3.0-pq.3.32-auth.46'||handoff.originalSession!==63578||handoff.sessionExit!==1||handoff.recordAbsent!==true||handoff.source32595AfterFailureExact!==true||handoff.noFutureReuseAuthorized!==true||handoff.strictToolchainIdentityQualified!==false||handoff.firstCause?.kind!=='OWNING_PRODUCT_RECORD_VALIDATOR_VERSION_GATE'||handoff.firstCause.line!==51||handoff.firstCause.validatorReachedOnlyAfterAllNodeAndHelperCompileCommandsCompleted!==true||handoff.actualSummary?.noInflight!==true||handoff.actualSummary.ownedGone!==120)fail();
 if(['App','GUI','Source','approval','sign'].some(k=>handoff[k]!==false)||handoff.firstCause.file?.bytes!==10807||handoff.firstCause.file?.sha256!=='34fb4b0478b2fe68adb6c45ee08136ca6d55834f2488597ed2b72a1414fc75f7')fail();
 same(handoff.normalCommands.node,node);same(handoff.normalCommands.helper,helper);
 if(request.cwd!==repo||request.argv?.length!==5||request.argv[1]!==repo+'/apps/wallet-desktop/scripts/build-wallet-native-component.mjs'||request.argv[2]!=='component-pq-native-project-control-cabi-artifact-release'||request.argv[3]!=='arm64'||request.argv[4]!==headers||result.noInflight!==true||result.terms?.length!==3||result.owned?.some(p=>p.present!==false))fail();
 same(result.terms.map(t=>[t.actualExit,t.guard]),[[0,null],[0,null],[1,null]]);if(result.terms[2].pid!==request.pid)fail();same(result.terms[2].argv,request.argv);
 if(node.commands?.length!==20||node.intermediateOutputs?.length!==19||helper.commands?.length!==1||handoff.immutableOutputs?.length!==21)fail();
 for(const command of [...node.commands.slice(0,19),...helper.commands])if(children.filter(r=>r.ppid===request.pid&&isDeepStrictEqual(r.argv?.slice(1),command.argv)).length!==1)fail();
 const originals=handoff.immutableOutputs.map(p=>p.original.path);same([...originals].sort(),[...node.intermediateOutputs,node.output,helper.output].sort());
 if(outputDigest(handoff.immutableOutputs.map(p=>p.original))!==SDK46_FINALIZATION_OUTPUT_DIGEST)fail();
 return {sameAttemptOnly:true,priorNodeCommands:20,priorHelperCommands:1,compilerExecution:false,futureToolchainReuseAuthorized:false,strictToolchainIdentityQualified:false};
}
export function inspectOriginalSDK46RecordFinalization({repo,headers,node,helper,handoffPath}){
 if(handoffPath!==SDK46_FINALIZATION_HANDOFF.path||repo!==sourceRoot)fail();check(SDK46_FINALIZATION_HANDOFF);const handoff=JSON.parse(readFileSync(handoffPath));
 const refs=new Map(handoff.refs.map(p=>[p.path,p])),read=name=>{const p=refs.get(path.join(attempt,name));if(!p)fail();check(p);return JSON.parse(readFileSync(p.path));};
 const request=read('ORIGINAL_NORMAL_MATCHED_PQ_NATIVE_COMPONENT.request.json'),result=read('BUILD_RESULT.json'),children=read('ACTUAL_CHILD_TOOL_ARGV.json');
 const checked=assertSDK46FinalizationCore({handoff,node,helper,repo,headers,request,result,children});
 const excluded=new Set(SDK46_FINALIZATION_OVERLAY.map(p=>path.join(repo,p)));
 // Exact immutable producer log/evidence closure, except the three explicitly
 // repaired Main-only JS files. No compiled source or SDK leaf is excluded.
 for(const p of handoff.refs)if(!excluded.has(p.path))check(p);
 const after=read('ACTUAL_COMPILE_SOURCE_ALL32595_AFTER_FAILURE_READBACK.json');if(after.files!==32595||after.rows.length!==32595||after.allFrozenSourceBytesExact!==true||after.compiler!==false)fail();
 for(const p of after.rows)if(!excluded.has(p.path))check(p);
 const pre=read('SOURCE_HEADERS_RUNTIME_PRE.json'),tools=read('TOOLCHAIN_INPUTS_PRE.json');
 if(pre.actual2368Headers?.length!==2368||pre.runtime9432FullyCheckedByProductionCLIBeforeCompiler!==true||tools.dependencyScans?.length!==30||tools.strictToolchainIdentityQualified!==false)fail();
 for(const p of [...pre.actualSelectedSource,...pre.actualMainControlSources,...pre.actual2368Headers,pre.headerInventory,pre.runtimeManifest,...tools.inputs])if(!excluded.has(p.path))check(p);
 const outputs=handoff.immutableOutputs.map(p=>{const current=check(p.original),frozen=check(p.immutable);if(current.bytes!==frozen.bytes||current.sha256!==frozen.sha256)fail();return current;});
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();if(git('rev-parse','HEAD')!=='79e5f96ed735119ce2ae79f971d560de0032d1cc'||git('rev-parse','HEAD^{tree}')!=='620bf8a92ec0cacfc524ae597ddfbf1085fc2d62')fail();
 if(execFileSync('/usr/bin/xcode-select',['-p'],{encoding:'utf8'}).trim()!==tools.selectedDeveloper||execFileSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim()!==tools.selectedSDK)fail();
 for(const name of ['CC','CXX','CFLAGS','CXXFLAGS','CPPFLAGS','LDFLAGS','CPATH','C_INCLUDE_PATH','CPLUS_INCLUDE_PATH','OBJC_INCLUDE_PATH','LIBRARY_PATH','TOOLCHAINS','SWIFT_EXEC','SWIFT_DRIVER_SWIFT_FRONTEND_EXEC','CCC_OVERRIDE_OPTIONS','DYLD_LIBRARY_PATH','DYLD_INSERT_LIBRARIES'])if(process.env[name])fail();
 if(process.env.DEVELOPER_DIR&&process.env.DEVELOPER_DIR!==tools.selectedDeveloper||process.env.SDKROOT&&process.env.SDKROOT!==tools.selectedSDK||process.env.MACOSX_DEPLOYMENT_TARGET&&process.env.MACOSX_DEPLOYMENT_TARGET!=='13.0')fail();
 for(const relative of ['apps/wallet-desktop/native/original-auth-identity-build.json','apps/wallet-desktop/native/YNXIdentityReceiver']){try{lstatSync(path.join(repo,relative));fail();}catch(e){if(e.code!=='ENOENT')throw e;}}
 return Object.freeze({...checked,kind:'YNX_WALLET_SDK46_SAME_ATTEMPT_FINALIZATION/v1',handoff:SDK46_FINALIZATION_HANDOFF,sourceRoot:repo,headerRoot:headers,outputs,overlay:SDK46_FINALIZATION_OVERLAY.map(p=>nativeContinuationFilePin(path.join(repo,p))),originalParentPid:request.pid,Root:false,Source:false,installed:false});
}
export function verifySDK46RecordFinalizationReceipt(record){
 if(!Object.hasOwn(record,'buildFinalization'))return;
 const f=record.buildFinalization;if(Object.hasOwn(record,'buildContinuation')||record.readbackOnly!==false||record.commandsKind!=='executed-normal-build'||record.sourceRoot!==sourceRoot||record.sourceInventory?.sha256!=='653b1ec3d1d8aac77fd599245de57501864072536a3af7fade722f449b09389e'||record.sourceInventory?.bytes!==84691)fail();
 if(f?.kind!=='YNX_WALLET_SDK46_SAME_ATTEMPT_FINALIZATION/v1'||f.sourceRoot!==record.sourceRoot||f.headerRoot!==record.headerRoot||f.sameAttemptOnly!==true||f.priorNodeCommands!==20||f.priorHelperCommands!==1||f.compilerExecution!==false||f.futureToolchainReuseAuthorized!==false||f.strictToolchainIdentityQualified!==false||f.originalParentPid!==76346||f.Root!==false||f.Source!==false||f.installed!==false)fail();same(f.handoff,SDK46_FINALIZATION_HANDOFF);
 same(record.architectures,['arm64']);if(record.commands.length!==20||record.helperBuild?.commands?.length!==1||f.outputs?.length!==21||f.overlay?.length!==4)fail();
 const pin=p=>p&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&/^[a-f0-9]{64}$/.test(p.sha256??'');
 if(f.outputs.some(p=>!pin(p))||new Set(f.outputs.map(p=>p.path)).size!==21||f.overlay.some((p,i)=>!pin(p)||p.path!==path.join(sourceRoot,SDK46_FINALIZATION_OVERLAY[i])))fail();
 if(outputDigest(f.outputs)!==SDK46_FINALIZATION_OUTPUT_DIGEST)fail();
 for(const output of [record.output,record.helperBuild.output]){const found=f.outputs.find(p=>p.path===path.join(sourceRoot,output.relative));if(!found||found.bytes!==output.bytes||found.sha256!==output.sha256)fail();}
 return {sameAttemptOnly:true,compilerExecution:false,futureToolchainReuseAuthorized:false};
}

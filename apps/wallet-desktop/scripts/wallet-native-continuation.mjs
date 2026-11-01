import {openSync,readSync,closeSync,fstatSync,lstatSync,statSync,realpathSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
const fail=code=>{throw Object.assign(Error(code),{code});};
// This is one original, already terminal c5 attempt, not a generic object cache
// or a claim that its whole Swift/SDK transitive toolchain was qualified.
export const C5_NATIVE_ATTEMPT=Object.freeze({
 file:'ACTUAL_NORMAL_SWIFT_DRIVER_FIRSTCAUSE_HANDOFF.json',bytes:45820,sha256:'3d37091f1edfa2c2b730d87a47e85fff3014d2321d90d4aff1ddde824c6c3bd4',
 sourceCommit:'f052026cae22a63d6f1fd07f1b686ef4e9a8130d',sourceTree:'8e5d5007cff92419249ec1b274e53a10e37aa49d',Main:'c5b8c25f836fd8d54779d48d8f200500468365b9',
});
export const C5_NATIVE_ROOT='/Volumes/西部数据/YNX-large-work/original-a-builds/wallet-mainc5b8-sdk42-native-r2-target-20261026';
export const C5_OBJECT_DIGEST='ba9da37eaf8ee7c8ed45a6e116b8a59c68feaf446093052c93a325ee433091ac';
export const NATIVE_CONTINUATION_OVERLAY=Object.freeze(['apps/wallet-desktop/scripts/build-wallet-native-component.mjs','apps/wallet-desktop/scripts/wallet-native-continuation.mjs','apps/wallet-desktop/scripts/canonical-package.mjs']);
export function nativeContinuationFilePin(file){
 const fd=openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let bytes=0;
 try{const before=fstatSync(fd);if(!before.isFile())fail('WALLET_CONTINUATION_FILE_REQUIRED');for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;bytes+=n;hash.update(buffer.subarray(0,n));}const after=fstatSync(fd);if(bytes!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail('WALLET_CONTINUATION_INPUT_CHANGED_DURING_READ');}finally{closeSync(fd);}
 return {path:file,bytes,sha256:hash.digest('hex')};
}
function originalObjectDigest(objects,repo){
 const rows=objects.map(p=>({relative:path.relative(repo,p.path),bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
/** Receipt DATA validation only. Never grants reuse or runs a tool. The normal
 * consumer independently validates the complete source/command/output closure. */
export function verifyNativeContinuationReceipt(receipt){
 if(!Object.hasOwn(receipt,'buildContinuation'))return;
 const c=receipt.buildContinuation,o=c?.original,bad=()=>fail('WALLET_CONTINUATION_RECEIPT_INVALID');
 const pin=p=>p&&path.isAbsolute(p.path??'')&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&/^[a-f0-9]{64}$/.test(p.sha256??'');
 const attempt=path.join(C5_NATIVE_ROOT,'remaining-header-r4-once'),repo=path.join(C5_NATIVE_ROOT,'source');
 if(c?.kind!=='YNX_WALLET_NATIVE_SAME_ATTEMPT_CONTINUATION/v1'||receipt.readbackOnly!==false||receipt.commandsKind!=='executed-normal-build'||receipt.sourceRoot!==repo||!isDeepStrictEqual(receipt.architectures,['arm64'])||c.priorPrefixCommands!==19||c.thisInvocationNodeCommands!==1||c.thisInvocationHelperCommands!==receipt.helperBuild?.commands?.length||c.originalPrefixExecutedPreviously!==true||c.strictToolchainIdentityQualified!==false||c.futureToolchainReuseAuthorized!==false)bad();
 if(!o||o.sameAttemptOnly!==true||o.completedCommands!==19||o.strictToolchainIdentityQualified!==false||o.futureToolchainReuseAuthorized!==false||o.Root!==false||o.Source!==false||o.installed!==false||o.attempt!==attempt||o.headers!==receipt.headerRoot||!isDeepStrictEqual(o.source,{root:repo,commit:C5_NATIVE_ATTEMPT.sourceCommit,tree:C5_NATIVE_ATTEMPT.sourceTree,Main:C5_NATIVE_ATTEMPT.Main})||!isDeepStrictEqual(o.handoff,{path:path.join(attempt,C5_NATIVE_ATTEMPT.file),bytes:C5_NATIVE_ATTEMPT.bytes,sha256:C5_NATIVE_ATTEMPT.sha256}))bad();
 if(!Array.isArray(o.objects)||o.objects.length!==19||!o.objects.every(pin)||new Set(o.objects.map(p=>p.path)).size!==19||originalObjectDigest(o.objects,repo)!==C5_OBJECT_DIGEST)bad();
 if(!Array.isArray(o.overlay)||o.overlay.length!==NATIVE_CONTINUATION_OVERLAY.length||o.overlay.some((p,i)=>!pin(p)||p.path!==path.join(repo,NATIVE_CONTINUATION_OVERLAY[i])))bad();
 if(!pin(c.probe)||c.probe.path!==path.join(attempt,'NATIVE_SAME_ATTEMPT_CONTINUATION_PROBE.json')||!pin(c.runIntent)||c.runIntent.path!==path.join(attempt,'NATIVE_SAME_ATTEMPT_CONTINUATION_RUN_INTENT.json'))bad();
 if(receipt.commands?.length!==20||!isDeepStrictEqual(o.remainingCommands,[receipt.commands.at(-1),...receipt.helperBuild.commands])||!isDeepStrictEqual(o.probe,{tool:'/usr/bin/xcrun',argv:['swiftc','-driver-print-jobs',...receipt.commands.at(-1).argv.slice(1)]}))bad();
 if(o.environment?.DEVELOPER_DIR!=='/Applications/Xcode.app/Contents/Developer'||o.environment.SDKROOT!=='/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk'||! /^[\x21-\x7e]+$/.test(o.environment.TMPDIR??'')||!path.isAbsolute(o.environment.TMPDIR)||o.temporary?.entry!==o.environment.TMPDIR||!o.temporary.target?.startsWith(attempt+path.sep)||typeof o.temporary.device!=='string')bad();
 return {sameAttemptOnly:true,completedCommands:19,futureToolchainReuseAuthorized:false};
}
function checkPin(p){
 if(!p||typeof p.path!=='string'||!path.isAbsolute(p.path)||!Number.isSafeInteger(p.bytes)||p.bytes<0||!/^[a-f0-9]{64}$/.test(p.sha256??''))fail('WALLET_CONTINUATION_PIN_REQUIRED');
 if(p.resolved&&realpathSync(p.path)!==p.resolved)fail('WALLET_CONTINUATION_TOOL_RESOLUTION_CHANGED');
 const actual=nativeContinuationFilePin(p.path),s=statSync(p.path);
 if(actual.bytes!==p.bytes||actual.sha256!==p.sha256||p.UID!==undefined&&s.uid!==p.UID||p.mode!==undefined&&(p.mode<=0o777?s.mode&0o777:s.mode)!==p.mode)fail('WALLET_CONTINUATION_INPUT_CHANGED');
 return actual;
}
// Pure DATA seam for controlled tests; production reads independently pinned
// original evidence below. It never chooses commands, files or an executor.
export function assertNativeContinuationCore({priorPlan,currentPlan,retainedObjects,expectedObjects,originalSource,currentSource,environment,expectedEnvironment}){
 if(!isDeepStrictEqual(priorPlan,currentPlan)||!isDeepStrictEqual(originalSource,currentSource)||!isDeepStrictEqual(environment,expectedEnvironment))fail('WALLET_CONTINUATION_ORIGINAL_CHANGED');
 if(retainedObjects.length!==19||expectedObjects.length!==19||new Set(retainedObjects.map(p=>p.path)).size!==19)fail('WALLET_CONTINUATION_EXACT19_REQUIRED');
 const sorted=v=>[...v].sort((a,b)=>a.path.localeCompare(b.path,'en')).map(p=>({path:p.path,bytes:p.bytes,sha256:p.sha256}));
 if(!isDeepStrictEqual(sorted(retainedObjects),sorted(expectedObjects)))fail('WALLET_CONTINUATION_OBJECT_CHANGED');
 return Object.freeze({sameAttemptOnly:true,completedCommands:19,strictToolchainIdentityQualified:false,futureToolchainReuseAuthorized:false});
}
export function inspectOriginalC5NativeContinuation({repo,headers,node,helper,handoffPath,asciiTmpdir}){
 if(handoffPath!==path.join(C5_NATIVE_ROOT,'remaining-header-r4-once',C5_NATIVE_ATTEMPT.file)||repo!==path.join(C5_NATIVE_ROOT,'source')||!path.isAbsolute(asciiTmpdir)||! /^[\x21-\x7e]+$/.test(asciiTmpdir)||process.env.TMPDIR!==asciiTmpdir)fail('WALLET_CONTINUATION_EXPLICIT_ASCII_TMPDIR_REQUIRED');
 checkPin({path:handoffPath,bytes:C5_NATIVE_ATTEMPT.bytes,sha256:C5_NATIVE_ATTEMPT.sha256});const original=JSON.parse(readFileSync(handoffPath)),attempt=path.dirname(handoffPath);
 if(original.source.root!==repo||original.source.commit!==C5_NATIVE_ATTEMPT.sourceCommit||original.source.tree!==C5_NATIVE_ATTEMPT.sourceTree||original.source.Main!==C5_NATIVE_ATTEMPT.Main||original.SwiftRetried!==false||original.resource.noInflight!==true||original.swiftProcess.exception.signal!=='SIGTRAP')fail('WALLET_CONTINUATION_ORIGINAL_ATTEMPT_REQUIRED');
 const refs=new Map(original.refs.map(p=>[p.path,p])),read=name=>{const file=path.join(attempt,name),p=refs.get(file);if(!p)fail('WALLET_CONTINUATION_ORIGINAL_EVIDENCE_REQUIRED');checkPin(p);return JSON.parse(readFileSync(file));};
 checkPin(original.actualPlan);checkPin(original.actualResult);checkPin(original.sourceComposition);
 const prior=JSON.parse(readFileSync(original.actualPlan.path)),result=JSON.parse(readFileSync(original.actualResult.path)),request=read('ORIGINAL_NORMAL_MATCHED_PQ_NATIVE_COMPONENT.request.json'),capturedEnvironment=read('EXACT_CAPTURED_TOOLCHAIN_ENV.json'),sourceHeaders=read('SOURCE_HEADERS_RUNTIME_PRE.json'),tools=read('TOOLCHAIN_INPUTS_PRE.json'),children=read('ACTUAL_CHILD_TOOL_ARGV.json');
 if(request.cwd!==repo||request.argv[3]!=='arm64'||request.argv[4]!==headers||request.argv[2]!=='component-pq-native-project-control-cabi-artifact-release'||result.noInflight!==true||result.terms.at(-1)?.actualExit!==1||request.pid!==original.swiftProcess.parentPid)fail('WALLET_CONTINUATION_ORIGINAL_COMMAND_REQUIRED');
 if(node.commands.length!==20||node.intermediateOutputs.length!==19||node.commands.at(-1).tool!=='/usr/bin/xcrun'||node.commands.at(-1).argv[0]!=='swiftc')fail('WALLET_CONTINUATION_EXACT_SUFFIX_REQUIRED');
 const originalPlan={node:prior.node,helper:prior.helper},currentPlan={node,helper};
 const expectedObjects=node.intermediateOutputs.map(file=>checkPin(original.retainedObjects.find(p=>p.path===file)));
 if(originalObjectDigest(expectedObjects,repo)!==C5_OBJECT_DIGEST)fail('WALLET_CONTINUATION_OBJECT_CHANGED');
 const source={root:repo,commit:C5_NATIVE_ATTEMPT.sourceCommit,tree:C5_NATIVE_ATTEMPT.sourceTree,Main:C5_NATIVE_ATTEMPT.Main};
 const captured={DEVELOPER_DIR:process.env.DEVELOPER_DIR,SDKROOT:process.env.SDKROOT};
 const checked=assertNativeContinuationCore({priorPlan:originalPlan,currentPlan,retainedObjects:original.retainedObjects,expectedObjects,originalSource:original.source&&{root:original.source.root,commit:original.source.commit,tree:original.source.tree,Main:original.source.Main},currentSource:source,environment:captured,expectedEnvironment:capturedEnvironment});
 // Native source, original73-ish Main source leaves, Node headers and all
 // captured C/ObjC dependency/tool inputs remain exact. Only the build producer
 // itself may be the explicit Main-owned continuation overlay.
 const allowed=new Set(NATIVE_CONTINUATION_OVERLAY.map(p=>path.join(repo,p)));
 for(const p of [...sourceHeaders.actualSelectedSource,...sourceHeaders.actualMainControlSources,...sourceHeaders.actual2368Headers,sourceHeaders.headerInventory,sourceHeaders.runtimeManifest,...tools.inputs])if(!allowed.has(p.path))checkPin(p);
 for(const command of node.commands.slice(0,19)){
  const observed=children.filter(p=>p.ppid===request.pid&&isDeepStrictEqual(p.argv?.slice(1),command.argv));
  if(observed.length!==1)fail('WALLET_CONTINUATION_ACTUAL_COMPILE_COMMAND_REQUIRED');
 }
 const git=(...argv)=>execFileSync('git',argv,{cwd:repo,encoding:'utf8',maxBuffer:1024*1024});
 if(git('rev-parse',C5_NATIVE_ATTEMPT.sourceCommit+'^{tree}').trim()!==C5_NATIVE_ATTEMPT.sourceTree)fail('WALLET_CONTINUATION_SOURCE_PARENT_CHANGED');
 // This materialized source already has the original SDK runtime dependency
 // install as untracked files. The normal producer independently verifies its
 // fixed runtime union before reaching here; it is not a Wallet source delta.
 const changes=[...git('diff','--name-only','-z',C5_NATIVE_ATTEMPT.sourceCommit,'--').split('\0'),...git('ls-files','--others','--exclude-standard','--exclude=packages/wallet-auth/node_modules/**','-z').split('\0')].filter(Boolean);
 if(changes.some(p=>!NATIVE_CONTINUATION_OVERLAY.includes(p)&&!node.intermediateOutputs.includes(path.join(repo,p))))fail('WALLET_CONTINUATION_UNRELATED_SOURCE_DELTA');
 for(const name of ['CC','CXX','CFLAGS','CXXFLAGS','CPPFLAGS','LDFLAGS','CPATH','C_INCLUDE_PATH','CPLUS_INCLUDE_PATH','OBJC_INCLUDE_PATH','LIBRARY_PATH','TOOLCHAINS','SWIFT_EXEC','SWIFT_DRIVER_SWIFT_FRONTEND_EXEC','CCC_OVERRIDE_OPTIONS','DYLD_LIBRARY_PATH','DYLD_INSERT_LIBRARIES'])if(process.env[name])fail('WALLET_CONTINUATION_TOOLCHAIN_OVERRIDE');
 if(process.env.MACOSX_DEPLOYMENT_TARGET&&process.env.MACOSX_DEPLOYMENT_TARGET!=='13.0')fail('WALLET_CONTINUATION_TARGET_CHANGED');
 const swift=tools.inputs.find(p=>p.path.endsWith('/usr/bin/swiftc'));if(!swift)fail('WALLET_CONTINUATION_SELECTED_TOOLCHAIN_CHANGED');
 if(execFileSync('/usr/bin/xcode-select',['-p'],{encoding:'utf8'}).trim()!==tools.selectedDeveloper||execFileSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim()!==tools.selectedSDK||execFileSync('/usr/bin/xcrun',['--find','swiftc'],{encoding:'utf8'}).trim()!==swift.path||realpathSync(swift.path)!==swift.resolved)fail('WALLET_CONTINUATION_SELECTED_TOOLCHAIN_CHANGED');
 const driver=refs.get(original.swiftProcess.path);if(!driver)fail('WALLET_CONTINUATION_ACTUAL_DRIVER_REQUIRED');checkPin(driver);
 const link=lstatSync(asciiTmpdir),target=realpathSync(asciiTmpdir),dir=lstatSync(target),attemptStat=statSync(attempt);
 if(!link.isSymbolicLink()||link.uid!==process.getuid()||!target.startsWith(attempt+path.sep)||!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid()||(dir.mode&0o022)||dir.dev!==attemptStat.dev||dir.dev!==statSync(repo).dev)fail('WALLET_CONTINUATION_SAME_DISK_OWNED_TEMP_REQUIRED');
 const outputs=[node.output,helper.output,path.join(repo,'apps/wallet-desktop/native/original-auth-identity-build.json'),path.join(repo,'apps/wallet-desktop/native/YNXIdentityReceiver')];
 for(const file of outputs){try{lstatSync(file);fail('WALLET_CONTINUATION_FINAL_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
 const overlay=NATIVE_CONTINUATION_OVERLAY.map(p=>nativeContinuationFilePin(path.join(repo,p)));
 return Object.freeze({...checked,handoff:{path:handoffPath,bytes:C5_NATIVE_ATTEMPT.bytes,sha256:C5_NATIVE_ATTEMPT.sha256},attempt,source,headers,overlay,objects:expectedObjects,environment:{...captured,TMPDIR:asciiTmpdir},temporary:{entry:asciiTmpdir,target,device:String(dir.dev)},remainingCommands:[node.commands.at(-1),...helper.commands],probe:{tool:node.commands.at(-1).tool,argv:['swiftc','-driver-print-jobs',...node.commands.at(-1).argv.slice(1)]},Root:false,Source:false,installed:false});
}

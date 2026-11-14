import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {verifyPhysicalPin} from './next-product-supplier-input.mjs';

export const ROOT63_FINISH_HANDOFF={path:'/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-root14-product45-normal-builder-successor-20261101/resource8-successor/package-consumer-successor/archive-gate-post-successor/normal-finish-successor/HANDOFF.json',bytes:8848,sha256:'48a1ef9dae2ee921c5e78c779eafc3c02bb0e92df507169971e2667175441384'};
const outputsPin={path:'/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/sdk49-ide-root63-resource8-product-qa-20261101/post-archive-gate-successor/normal-finish/COLD_BUILD_OUTPUTS.json',bytes:7363,sha256:'3f1addd388746020a28e74587eddbe0fd4ad9ea836d914c31c561d941c0e2e2e'};
const names=['normal-current-P03-main.m','normal-current-P03-ynx-wallet-admission-parent.m','strict-root63-Cocoa-first-link','original-fresh-helper13-owned-U0'];
export function assertRoot63NativeFinish(e,o,h,commands){
 const fail=()=>{throw Error('Complete exact Root63 native continuation required');};
 if(e.schema!=='YNX_ROOT63_POST_CONTINUED_NORMAL_FINISH_EXECUTION/v1'||e.complete!==true||e.error!==null||e.NodeCompileRepeated!==false||e.NodeLinkRepeated!==false||e.CocoaLinkFirstExecution!==true||!isDeepStrictEqual(e.results?.map(r=>r.name),names)||e.results.some((r,i)=>r.status!==0||r.signal!==null||r.error!==null||!isDeepStrictEqual(r.argv,commands[i].argv)))fail();
 const r=h.sourceRoles;
 if(o.schema!=='YNX_IDE_ROOT63_POST_CONTINUED_NORMAL_OUTPUTS/v1'||o.sourceRoles?.nativeCompilation!==r.originalNativeCompile||o.sourceRoles?.gatePostProducer!==r.correctedGatePost||o.sourceRoles?.normalFinishProducer!==r.normalFinishProducer||o.sourceRoles?.P03Native!==r.P03NativeConsumer||o.originalGateFailurePreserved!==true||o.oldColdRecordNeverBackfilled!==true||o.NodeCompileRepeated!==false||o.NodeLinkRepeated!==false||o.NativeRuntime?.length!==9||!isDeepStrictEqual(o.freshStageIds,names)||o.postCompletion?.sha256!==h.actualPost.sha256||o.originalFailedExecution?.sha256!==h.originalFailedExecution.sha256||o.originalFailedAttempt?.sha256!==h.originalFailedAttempt.sha256)fail();
}
export async function readRoot63NativeCompletion(){
 await verifyPhysicalPin(ROOT63_FINISH_HANDOFF);const h=JSON.parse(await readFile(ROOT63_FINISH_HANDOFF.path));
 if(h.schema!=='YNX_ROOT63_POST_CONTINUED_NORMAL_FINISH_HANDOFF/v1')throw Error('Exact native finish supplier required');
 for(const r of Object.values(h))if(r?.path&&Number.isSafeInteger(r.bytes)&&r.sha256)await verifyPhysicalPin(r);
 await verifyPhysicalPin(h.postNested.module);
 const code=JSON.parse(await readFile(h.SOURCEFILES.path));for(const r of code.files)await verifyPhysicalPin(r);
 await verifyPhysicalPin(outputsPin);
 const o=JSON.parse(await readFile(outputsPin.path)),e=JSON.parse(await readFile(h.normalExecution)),manifest=JSON.parse(await readFile(h.normalManifest.path));
 assertRoot63NativeFinish(e,o,h,manifest.commands);
 const reader=await import(pathToFileURL(join(dirname(h.normalEntry.path),'read-post-completion.mjs')));
 const post=reader.readPostCompletion();
 for(const r of [...o.NativeRuntime,o.CocoaExecutable,o.helper,...e.results.flatMap(r=>[r.stdout,r.stderr])])await verifyPhysicalPin(r);
 // This is native build custody. SDKPackageFinal is deliberately still absent
 // in this original output; only a separately pinned final resource may fill
 // the package role. Never rewrite the original failed execution or this file.
 return {h,e,o,post,outputsPin};
}

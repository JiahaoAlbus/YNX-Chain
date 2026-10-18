import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {bindSavedPQTransferFinalityInvocation} from './features/pq-transaction/finality-saved-invocation.mjs';
import {parsePQTransferFinalityVerifierResult} from './features/pq-transaction/finality-verifier-result.mjs';
const fail=()=>{throw Object.assign(Error('PQ_FINALITY_SAVED_CAPTURE_UNVERIFIED'),{code:'PQ_FINALITY_SAVED_CAPTURE_UNVERIFIED'});};
function json(bytes){const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);if(JSON.stringify(value)!==text)fail();return value;}
/** Cold local DATA recovery. Neither saved context nor a saved CLI result is
 * independent Host provenance. No process, RPC, signing, or journal mutation.
 * Caller must not project the private manifest/raw bytes into renderer IPC. */
export async function readPQFinalityVerifierEvidence(original,binding,evidence,ref){
 if(ref.kind!=='verifier-result')fail();
 const manifest=json(await evidence.read(original,binding,ref));
 exactData(manifest,['version','type','operationId','hash','contextSha256','stdinSha256','resourceIdentity','references','exitCode','signal','lifecycle','firstCause','cleanupCause'],'PQ_FINALITY_SAVED_CAPTURE_UNVERIFIED');
 if(manifest.version!==1||manifest.type!=='verifier-capture'||manifest.operationId!==original.operationId||manifest.hash!==original.hash||!Array.isArray(manifest.references)||manifest.references.length<4||manifest.references.length>64)fail();
 const byKind=kind=>manifest.references.filter(r=>r?.kind===kind);
 const contexts=byKind('host-context'),inputs=byKind('verifier-stdin'),outputs=byKind('verifier-stdout'),errors=byKind('verifier-stderr');
 if(contexts.length!==1||inputs.length!==1||!outputs.length||outputs.length!==errors.length)fail();
 if(contexts[0].sha256!==manifest.contextSha256||inputs[0].sha256!==manifest.stdinSha256)fail();
 // Complete readback of the selected generation, not only trusted headers.
 const contextBytes=await evidence.read(original,binding,contexts[0]);
 const inputBytes=await evidence.read(original,binding,inputs[0]);
 const invocation=bindSavedPQTransferFinalityInvocation(original,binding,contextBytes,inputBytes);
 if(invocation.contextSha256!==manifest.contextSha256||invocation.stdinSha256!==manifest.stdinSha256)fail();
 const stdout=await evidence.read(original,binding,outputs.at(-1)),stderr=await evidence.read(original,binding,errors.at(-1));
 const state=manifest.lifecycle;
 exactData(state,['started','closeObserved','cleanupPending','interruption','stdoutTruncated','stderrTruncated','firstCausePresent','cleanupCausePresent','stdinSha256','stdinByteLength'],'PQ_FINALITY_SAVED_CAPTURE_UNVERIFIED');
 for(const field of ['started','closeObserved','cleanupPending','stdoutTruncated','stderrTruncated','firstCausePresent','cleanupCausePresent'])if(typeof state[field]!=='boolean')fail();
 if(state.stdinSha256!==manifest.stdinSha256||state.stdinByteLength!==inputBytes.length)fail();
 const base={account:original.account,operationId:original.operationId,hash:original.hash,evidence:ref,rawStored:true,independentFinality:false,consensusFinality:false,nativeGrant:false,canRetry:false,clearsOriginal:false};
 if(!state.started||!state.closeObserved||state.cleanupPending||state.interruption!==null||state.stdoutTruncated||state.stderrTruncated||state.firstCausePresent)return Object.freeze({...base,status:'verifier-incomplete'});
 const result=parsePQTransferFinalityVerifierResult(original,binding,invocation.expected,{stdout,stderr,exitCode:manifest.exitCode,signal:manifest.signal});
 return Object.freeze({...result.observation,...base,stdoutSha256:result.stdoutSha256,stderrSha256:result.stderrSha256});
}

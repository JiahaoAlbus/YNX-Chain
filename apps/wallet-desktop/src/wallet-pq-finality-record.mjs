import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {preparePQFinalityOriginal as preparePQTransferOriginal,preparePQFinalityTarget as preparePQTransferFinalityTarget} from './wallet-pq-finality-original.mjs';
import {parsePQFinalityEvidenceReference} from './wallet-pq-finality-evidence.mjs';
const fail=()=>{throw Object.assign(Error('PQ_FINALITY_RECORD_INVALID'),{code:'PQ_FINALITY_RECORD_INVALID'});};
const fields=['account','operationId','kind','transactionType','nativeTransactionHash','abciTransactionHash','executionHeight','cometIndex','status','verifierCode','reportedOutcome','reportedExecutionSuccessful','executionCode','proofVerification','independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const closed=(v,keys)=>{if(types.isProxy(v))fail();exactData(v,keys,'PQ_FINALITY_RECORD_INVALID');};
const decimal=(v,max)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(v)||BigInt(v)>max)fail();return BigInt(v);};
const statementFields=['chainId','headerHeight','blockHash','stateHeight','stateAppHash'];
const referenceNames=['context','stdin','stdout','stderr','manifest'];
export const pqFinalityRecordIdentity=row=>sha(Buffer.from(JSON.stringify([row.account,row.hash,row.operationId,row.networkId,statementFields.map(k=>row.target.block[k]),statementFields.map(k=>row.target.successor[k]),row.target.index])));
export const pqFinalityRecordGeneration=row=>sha(Buffer.from(JSON.stringify([pqFinalityRecordIdentity(row),referenceNames.map(name=>['eventId','attemptId','kind','bytes','sha256'].map(k=>row.references[name][k]))])));
export const pqFinalityRecordsConflict=(a,b)=>pqFinalityRecordIdentity(a)===pqFinalityRecordIdentity(b)&&a.observation.status==='verifier-result-data'&&b.observation.status==='verifier-result-data'&&JSON.stringify(fields.map(k=>a.observation[k]))!==JSON.stringify(fields.map(k=>b.observation[k]));
/** Compact private journal DATA. Original signed bytes remain in pqOriginals;
 * full context/stdin/stdout stay in immutable evidence, not this 1 MiB journal.
 * Parsing or cold recovery cannot establish Source, authorization or finality.
 */
export function parsePQFinalityRecord(value,original){
 closed(value,['version','account','hash','operationId','networkId','target','observation','references','storageCause']);
 if(value.version!==1)fail();const own=preparePQTransferOriginal(original,{account:value.account,networkId:value.networkId});if(value.hash!==own.original.hash||value.operationId!==own.original.operationId)fail();
 closed(value.target,['block','successor','index']);
 // Reuse the original target grammar, rebuilding only redundant public wire
 // fields from the retained original instead of persisting another large copy.
 const typed=own.original.kind==='pq-typed-action',wire=Buffer.from(typed?own.nativeWire:own.request.body),envelope=typed?Buffer.from(own.request.body):Buffer.from(JSON.stringify({version:1,type:'pq_transfer',wireHex:wire.toString('hex')})),nativeHash=typed?own.original.typed.memberHash:own.original.hash,transactionType=typed?'pq_action':'pq_transfer';
 const expected=preparePQTransferFinalityTarget(original,{account:value.account,networkId:value.networkId},{...value.target,transactionType,envelope:envelope.toString('base64'),nativeWire:wire.toString('base64'),transactionHash:own.binding.abciTransactionHash.slice(2),nativeWireHash:nativeHash.slice(2)});
 const t={block:expected.block,successor:expected.successor,index:expected.index},o=value.observation;closed(o,fields);
 if(o.account!==value.account||o.operationId!==value.operationId||o.kind!==own.original.kind||o.transactionType!==transactionType||o.nativeTransactionHash!==nativeHash||o.abciTransactionHash!==own.binding.abciTransactionHash||o.executionHeight!==t.block.headerHeight||o.cometIndex!==Number(t.index)||o.proofVerification!=='result-data-only')fail();
 for(const name of ['independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal'])if(o[name]!==false)fail();
 if(o.status==='verifier-result-data'){
  if(o.verifierCode==='VERIFIED_TRANSACTION_DATA'){if(o.reportedOutcome!=='succeeded'||o.reportedExecutionSuccessful!==true||o.executionCode!=='0')fail();}
  else if(o.verifierCode==='VERIFIED_TRANSACTION_REJECTED_DATA'){if(o.reportedOutcome!=='rejected'||o.reportedExecutionSuccessful!==false||decimal(o.executionCode,4294967295n)===0n)fail();}else fail();
 }else if(o.status!=='verifier-error-data'||!['INVALID_ARGUMENTS','INVALID_REQUEST','TRUST_CONTEXT_INVALID','TRUST_SOURCE_INVALID','PROOF_REJECTED'].includes(o.verifierCode)||o.reportedOutcome!==null||o.reportedExecutionSuccessful!==null||o.executionCode!==null)fail();
 closed(value.references,['context','stdin','stdout','stderr','manifest']);const refs={};
 for(const [name,kind]of Object.entries({context:'host-context',stdin:'verifier-stdin',stdout:'verifier-stdout',stderr:'verifier-stderr',manifest:'verifier-result'})){const r=parsePQFinalityEvidenceReference(value.references[name]);if(r.kind!==kind)fail();refs[name]=r;}
 let cause=null;if(value.storageCause!==null){const c=value.storageCause;closed(c,['kind','value','code']);if(!['error','object','undefined','boolean','number','string'].includes(c.kind)||c.value!==null&&(!['string','number','boolean'].includes(typeof c.value)||typeof c.value==='number'&&!Number.isFinite(c.value))||c.code!==null&&(typeof c.code!=='string'||!/^[A-Za-z0-9_:-]{1,128}$/.test(c.code)))fail();cause={...c};}
 const row={version:1,account:value.account,hash:value.hash,operationId:value.operationId,networkId:value.networkId,target:t,observation:{...o},references:refs,storageCause:cause};
 if(Buffer.byteLength(JSON.stringify(row))>8192)fail();return row;
}
export function createPQFinalityRecord(original,binding,expected,result){
 const selected=preparePQTransferFinalityTarget(original,binding,expected);if(!Array.isArray(result.records)||result.records.length>64)fail();const get=kind=>{const refs=result.records.filter(x=>x.kind===kind);if(!refs.length)fail();return refs.at(-1);};
 const references={context:get('host-context'),stdin:get('verifier-stdin'),stdout:get('verifier-stdout'),stderr:get('verifier-stderr'),manifest:get('verifier-result')};
 if(references.stdout.sha256!==result.stdoutSha256||references.stdout.bytes!==result.stdoutByteLength||references.stderr.sha256!==result.stderrSha256||references.stderr.bytes!==result.stderrByteLength)fail();
 return parsePQFinalityRecord({version:1,account:original.account,hash:original.hash,operationId:original.operationId,networkId:binding.networkId,target:{block:selected.block,successor:selected.successor,index:selected.index},observation:result.observation,references,storageCause:null},original);
}

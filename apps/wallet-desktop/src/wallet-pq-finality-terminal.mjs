import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON} from '@ynx-chain/wallet-auth';
import {readCompletedPackagedPQCaller,packagedPQVerifierAssetPaths} from './wallet-pq-verifier-assets.mjs';
import {readPQHostReferenceTerminalContext} from './wallet-pq-host-reference.mjs';
import {readPQFinalityVerifierEvidence} from './wallet-pq-verifier-restore.mjs';
import {parsePQFinalityRecord,pqFinalityRecordGeneration} from './wallet-pq-finality-record.mjs';
import {parsePQOriginalRecord} from './wallet-pq-intent-record.mjs';
import {parsePQProgress,initialPQProgress} from './wallet-pq-progress.mjs';
import {readOriginalPQHostSelectionCapture} from './wallet-pq-host-selection-capture.mjs';
const tokens=new WeakMap(),sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Object.assign(Error('PQ_FINALITY_TERMINAL_UNVERIFIED'),{code:'PQ_FINALITY_TERMINAL_UNVERIFIED'});};
function exact(v,keys){if(types.isProxy(v)||!v||Object.getPrototypeOf(v)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')))fail();}
// Grammar only, never authority: live adoption also requires the opaque token;
// cold recovery requires OS verification of the complete archived record.
export function parsePQFinalityTerminalData(value,original){
 exact(value,['version','record','generation','host','verifier','status','nativeGrant']);
 const record=parsePQFinalityRecord(value.record,original),o=record.observation;
 if(value.version!==1||o.status!=='verifier-result-data'||value.generation!==pqFinalityRecordGeneration(record)||value.nativeGrant!==false||value.status!==(o.reportedOutcome==='succeeded'?'finalized-succeeded':o.reportedOutcome==='rejected'?'finalized-rejected':null))fail();
 exact(value.host,['sourceId','epoch','sourceFingerprint','sourceSha256','lifecycleSha256','contextSha256']);
 if(typeof value.host.sourceId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.host.sourceId)||typeof value.host.epoch!=='string'||!/^[1-9][0-9]{0,19}$/.test(value.host.epoch)||BigInt(value.host.epoch)>18446744073709551615n)fail();
 for(const key of ['sourceFingerprint','sourceSha256','lifecycleSha256','contextSha256'])if(typeof value.host[key]!=='string'||!/^[a-f0-9]{64}$/.test(value.host[key])||/^0{64}$/.test(value.host[key]))fail();
 if(value.host.contextSha256!==record.references.context.sha256)fail();packagedPQVerifierAssetPaths(value.verifier);
 return {version:1,record,generation:value.generation,host:{...value.host},verifier:structuredClone(value.verifier),status:value.status,nativeGrant:false};
}
// Only the original sealed process objects, complete evidence readback and
// the same live Host AFTER its final current check can produce this token.
// Public parser JSON remains DATA-only and is deliberately never promoted.
export async function createPQVerifiedFinalityTerminal({original,binding,result,selection,host,verifier,evidence,guard}){
 guard.assert();if(guard.account!==original.account)fail();
 const process=readCompletedPackagedPQCaller(verifier,'proof'),current=readPQHostReferenceTerminalContext(host,original,binding),record=parsePQFinalityRecord(result.journalRecord,original);
 const source=readOriginalPQHostSelectionCapture(selection,original,binding);for(const key of ['sourceId','epoch','sourceSha256'])if(source[key]!==current[key])fail();
 if(record.observation.status!=='verifier-result-data')return null;
 const cold=await readPQFinalityVerifierEvidence(original,binding,evidence,record.references.manifest);
 if(cold.status!=='verifier-result-data'||cold.stdoutSha256!==process.stdoutSha256||cold.stderrSha256!==process.stderrSha256||record.references.stdout.sha256!==process.stdoutSha256||record.references.stdout.bytes!==process.stdoutBytes||record.references.stderr.sha256!==process.stderrSha256||record.references.stderr.bytes!==process.stderrBytes||record.references.stdin.sha256!==process.stdinSha256||cold.reportedOutcome!==record.observation.reportedOutcome||cold.executionCode!==record.observation.executionCode)fail();
 const manifest=JSON.parse((await evidence.read(original,binding,record.references.manifest)).toString());if(canonicalJSON(manifest.resourceIdentity)!==canonicalJSON(process.receipt))fail();
 guard.assert();readOriginalPQHostSelectionCapture(selection,original,binding);if(canonicalJSON(readPQHostReferenceTerminalContext(host,original,binding))!==canonicalJSON(current))fail();
 const data=parsePQFinalityTerminalData({version:1,record,generation:pqFinalityRecordGeneration(record),host:current,verifier:process.receipt,status:record.observation.reportedOutcome==='succeeded'?'finalized-succeeded':'finalized-rejected',nativeGrant:false},original);
 const token=Object.freeze(Object.create(null));tokens.set(token,{originalSHA256:sha(canonicalJSON(original)),data});return token;
}
export function readPQVerifiedFinalityTerminal(token,original){
 const held=tokens.get(token);if(!held||held.originalSHA256!==sha(canonicalJSON(original)))fail();return parsePQFinalityTerminalData(held.data,original);
}
export function parsePQFinalityHistoryEntry(value){
 exact(value,['version','original','progress','finality','storageCause','previousSeal','seal']);
 const original=parsePQOriginalRecord(value.original),finality=parsePQFinalityTerminalData(value.finality,original),progress=value.progress===null?null:parsePQProgress(value.progress,original);
 parsePQProgress({...initialPQProgress(original),storageCause:value.storageCause},original);
 const validSeal=s=>typeof s==='string'&&s.length>0&&s.length<=12000&&Buffer.from(s,'base64').toString('base64')===s;
 if(value.version!==1||!validSeal(value.seal)||value.previousSeal!==null&&(!validSeal(value.previousSeal)||value.storageCause===null))fail();
 return {version:1,original,progress,finality,storageCause:value.storageCause,previousSeal:value.previousSeal,seal:value.seal};
}
export const pqFinalityHistoryCore=entry=>({version:entry.version,original:entry.original,progress:entry.progress,finality:entry.finality,storageCause:entry.storageCause,previousSeal:entry.previousSeal});

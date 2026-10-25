import {types} from 'node:util';
import {exactData} from './transfer-binding.mjs';
const fail=()=>{throw Object.assign(Error('PQ_MIGRATION_PERMISSION_BINDING'),{code:'PQ_MIGRATION_PERMISSION_BINDING'})};
const fields=['action','purpose','networkId','nativeChainId','account','operationId','originalOperationId','origin','migrationIntent','requestDigest','transportHash','abciTransactionHash','currentAuthorization','currentPQMemberHash','newKeyWholeProofHash','policyRevision','reviewExecutionHeight','executionHeight','expiresAt'];
const intentFields=['chainId','owner','algorithmVersion','pkA','pkB','priorRevision','newRevision','ledgerNonce','activateAt'];
function exact(v,keys){if(types.isProxy(v))fail();exactData(v,keys,'PQ_MIGRATION_PERMISSION_BINDING');}
function height(v,zero=false){if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n||!zero&&BigInt(v)===0n)fail();return BigInt(v);}
function time(v){if(typeof v!=='string'||!Number.isSafeInteger(Date.parse(v))||new Date(Date.parse(v)).toISOString()!==v)fail();return Date.parse(v);}
function sameIntent(a,b){exact(a,intentFields);if(!Object.isFrozen(a)||intentFields.some(k=>a[k]!==b[k]))fail();}
/** DATA only. Main supplies actual Source policy/H and a distinct review id;
 * neither this builder nor stored E6 bytes acquire a migration permission. */
export function pqMigrationBroadcastPermissionRequest(plan,context){
 exact(context,['operationId','policyRevision','reviewExecutionHeight','executionHeight','expiresAt']);const b=plan.binding;
 if(plan.original.kind!=='pq-migration'||typeof context.operationId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(context.operationId)||context.operationId===plan.original.operationId||context.policyRevision!==b.intent.priorRevision)fail();
 height(context.policyRevision,true);const r=height(context.reviewExecutionHeight),h=height(context.executionHeight);if(r>h||h>=height(b.intent.activateAt))fail();const expiry=time(context.expiresAt),now=Date.now();if(expiry<=now||expiry>now+30000)fail();
 return Object.freeze({action:'broadcast',purpose:'ACCOUNT-MIGRATION',networkId:b.chainId,nativeChainId:'6423',account:b.account,operationId:context.operationId,originalOperationId:plan.original.operationId,origin:'ynx-wallet:local-pq',migrationIntent:Object.freeze({...b.intent}),requestDigest:b.intentSha256,transportHash:b.hash,abciTransactionHash:b.abciTransactionHash,currentAuthorization:b.currentAuthorization,currentPQMemberHash:b.currentPQMemberHash,newKeyWholeProofHash:b.newKeyWholeProofHash,...context});
}
export function bindPQMigrationBroadcastRequest(plan,value){
 exact(value,fields);if(!Object.isFrozen(value))fail();const context=Object.fromEntries(['operationId','policyRevision','reviewExecutionHeight','executionHeight','expiresAt'].map(k=>[k,value[k]])),expected=pqMigrationBroadcastPermissionRequest(plan,context);
 for(const k of fields){if(k==='migrationIntent')sameIntent(value[k],expected[k]);else if(value[k]!==expected[k])fail();}return value;
}
export function assertPQMigrationBroadcastPermission(resource,request,prior=null){
 const actual=resource.readOriginal();exact(actual,[...fields,'issuedAt']);if(!Object.isFrozen(actual)||prior&&actual!==prior)fail();
 for(const k of fields)if(k==='migrationIntent')sameIntent(actual[k],request[k]);else if(k!=='expiresAt'&&actual[k]!==request[k])fail();
 const issued=time(actual.issuedAt),expires=time(actual.expiresAt),now=Date.now();if(issued>now||issued>=expires||now>=expires||expires>time(request.expiresAt))fail();return actual;
}

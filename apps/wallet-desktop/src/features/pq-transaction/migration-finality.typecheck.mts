import {preparePQTransferFinalityTarget,preparePQTransferFinalityInvocation,type PQFinalityTarget,type PQFinalityBinding} from './finality-invocation.mjs';
import {bindPQTransferFinalityContext,bindSavedPQTransferFinalityInvocation} from './finality-saved-invocation.mjs';
import {parsePQTransferFinalityVerifierResult,type PQFinalityExecution} from './finality-verifier-result.mjs';
import {createPQTransactionNodeTransport} from './node-transport.mjs';
import type {PQFinalityProofData} from './typed-action-finality.mjs';
declare const original:Readonly<{kind:'pq-migration'}>,binding:PQFinalityBinding,target:PQFinalityTarget<'account_migration'>,proof:PQFinalityProofData,bytes:Uint8Array,execution:PQFinalityExecution;
const expected=preparePQTransferFinalityTarget(original,binding,target),invocation=preparePQTransferFinalityInvocation(original,binding,expected,proof),context=bindPQTransferFinalityContext(original,binding,bytes),saved=bindSavedPQTransferFinalityInvocation(original,binding,bytes,new TextEncoder().encode(invocation.stdin)),result=parsePQTransferFinalityVerifierResult(original,binding,saved.expected,execution);
const kind:'pq-migration'=result.observation.kind;
const type:'account_migration'=context.expected.transactionType;
const no:false=result.observation.consensusFinality;
const raw=createPQTransactionNodeTransport().submitMigration({},()=>{});
raw.then(response=>{const post:'POST'=response.method;const body:Uint8Array=response.body;void[post,body]});
// @ts-expect-error A migration DATA result cannot grant independent finality.
const grant:true=result.observation.consensusFinality;
// @ts-expect-error Typed actions retain their separate original API.
preparePQTransferFinalityTarget(original,binding,{...target,transactionType:'pq_action'});
// @ts-expect-error The bound Host index is immutable.
expected.index='1';
// @ts-expect-error Raw stdout is private evidence, not a public observation.
result.observation.stdout;
void[kind,type,no,grant];

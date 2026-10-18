import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodePQTransferRequest,preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {parsePQTransferFinalityCollector} from './finality-collector.mjs';
import {preparePQTransferFinalityInvocation} from './finality-invocation.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const packed=readFileSync(new URL('./fixtures/finality-c3-public.json.gz',import.meta.url));
assert.equal(packed.length,2083082);
assert.equal(sha256(packed),'ef1562c14a3528e29928dd1889e5fa94416e1223e405fac2a7648829c0b43095');
const fixture=JSON.parse(gunzipSync(packed,{maxOutputLength:4*1024*1024}));
const success=fixture.cases.find(value=>value.name==='succeeded-transfer');
const rejected=fixture.cases.find(value=>value.name==='terminal-rejected-duplicate');
const wire=Buffer.from(success.expectedTransaction.nativeWire,'base64');
const transfer=decodePQTransferRequest(wire).transfer;
const binding={account:transfer.from,networkId:transfer.chainId};
const original=createPQOriginalRecord({account:binding.account,kind:'pq-transfer',operationId:'PUBLIC-c3-original',request:preparePQTransferTransport(wire)});

// Proof fields are the actual original CI producer bytes. The HTTP envelope
// here is a CONTROLLED wrapper, not a captured public RPC response. We reuse
// the original Linux CLI receipt; no verifier, clock, grant or network runs.
function collectorBytes(row){
  const expected=row.expectedTransaction;
  return Buffer.from(JSON.stringify({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status:'collected',
    observedExecutionStatus:row.expectedResponse.result.outcome==='succeeded'?'committed':'rejected',
    nativeTransactionHash:'0x'+expected.nativeWireHash,abciTransactionHash:'0x'+expected.transactionHash,
    executionHeight:expected.block.headerHeight,cometIndex:Number(expected.index),
    independentFinality:false,proofVerification:'not-performed',proof:row.request.proof}));
}
function inputFor(row){
  const raw=collectorBytes(row),parsed=parsePQTransferFinalityCollector(original,binding,200,raw);
  const invocation=preparePQTransferFinalityInvocation(original,binding,row.expectedTransaction,parsed.proof);
  return {raw,parsed,invocation};
}

test('fixed public producer outcomes match exact original normal CLI stdout receipt bytes, with no production authorization',()=>{
  assert.equal(fixture.sourceCommit,'c3c219d5a3c560a2e0a5627850e1fa1f45ecd2e6');
  assert.equal(fixture.runId,'39140001841');
  assert.equal(fixture.originalFixtureSHA256,'da6f5ab4f2fd9ed73772351e9a861af7438bf1aac317a900832a1c5d6e0bd47a');
  assert.equal(fixture.originalReceiptSHA256,'d7ea8c1fcf1a959f08b8fd87c8135b15f7d2896438c39abedcd90602cc37cef1');
  assert.equal(fixture.syntheticOnly,true);
  for(const key of ['actualCometNode','dataAuthorized','nativeRootAuthorized','publicDeployment'])assert.equal(fixture[key],false);
  assert.equal(fixture.receipt.normalCLIExecuted,true); // ORIGINAL Linux CI, not this test.
  assert.equal(fixture.receipt.fixtureSHA256,fixture.originalFixtureSHA256);
  for(const row of [...fixture.cases,fixture.whole]){
    const response=row.expectedResponse,receipt=fixture.receipt.cases.find(value=>value.name===row.name);
    // Match the original Go transactionCommandResult struct order and the
    // Encoder newline. This is a receipt comparison, not a fresh CLI run.
    const stdout=JSON.stringify({version:response.version,code:response.code,result:response.result})+'\n';
    assert.equal(sha256(stdout),receipt.stdoutSHA256);assert.equal(receipt.exitCode,0);
    assert.equal(receipt.code,response.code);assert.equal(response.result.nativeGrant,false);
  }
  const negative=fixture.receipt.cases.filter(row=>row.exitCode===1);
  assert.equal(negative.length,3);
  assert.deepEqual(negative.map(row=>row.code),['PROOF_REJECTED','PROOF_REJECTED','INVALID_REQUEST']);
});

test('actual successful transfer proof bytes pass DATA collector and reconstruct the original normal CLI request fields',()=>{
  const {raw,parsed,invocation}=inputFor(success);
  assert.deepEqual(JSON.parse(invocation.stdin),success.request);
  assert.deepEqual(parsed.proof,success.request.proof);
  assert.equal(parsed.observation.observedExecutionStatus,'committed');
  assert.equal(parsed.observation.consensusFinality,false);assert.equal(parsed.observation.proofVerification,'not-performed');
  assert.equal(parsed.rawSha256,sha256(raw));assert.equal(parsed.byteLength,raw.length);
  assert.notEqual(parsed.rawSha256,invocation.stdinSha256);
  assert.equal(invocation.stdinSha256,sha256(Buffer.from(invocation.stdin,'utf8')));
  assert.equal(invocation.stdinByteLength,Buffer.byteLength(invocation.stdin));
  assert.equal(Buffer.from(success.expectedResponse.result.executionData,'base64').toString('ascii'),'0x'+success.expectedTransaction.transactionHash);
  assert.equal(success.expectedResponse.result.executionSuccessful,true);
  assert.notEqual(binding.networkId,success.expectedTransaction.block.chainId);
});

test('actual duplicate rejection retains the same original wire with index one and null execution data, without becoming success',()=>{
  const {parsed,invocation}=inputFor(rejected),successful=inputFor(success).invocation;
  assert.equal(rejected.expectedTransaction.nativeWire,success.expectedTransaction.nativeWire);
  assert.equal(rejected.expectedTransaction.transactionHash,success.expectedTransaction.transactionHash);
  assert.equal(rejected.expectedTransaction.nativeWireHash,success.expectedTransaction.nativeWireHash);
  assert.equal(rejected.expectedTransaction.index,'1');assert.equal(success.expectedTransaction.index,'0');
  assert.deepEqual(JSON.parse(invocation.stdin),rejected.request);
  assert.notEqual(invocation.stdinSha256,successful.stdinSha256);
  assert.equal(parsed.observation.cometIndex,1);assert.equal(parsed.observation.observedExecutionStatus,'rejected');
  assert.equal(parsed.observation.consensusFinality,false);assert.equal(parsed.observation.canRetry,false);
  const response=rejected.expectedResponse;
  assert.equal(response.code,'VERIFIED_TRANSACTION_REJECTED_DATA');
  assert.equal(response.result.executionCode,'2');assert.equal(response.result.executionData,null);
  assert.equal(response.result.executionSuccessful,false);assert.equal(response.result.outcome,'rejected');
  assert.equal(original.status,'signed-unsubmitted'); // Test fixture was never submitted.
});

test('actual partial Whole result with exit zero cannot enter the transfer-only invocation or SDK Member route',()=>{
  const whole=fixture.whole,response=whole.expectedResponse;
  assert.equal(response.code,'VERIFIED_TRANSACTION_PARTIAL_DATA');
  assert.equal(response.result.executionCode,'0');assert.equal(response.result.executionSuccessful,false);
  assert.equal(response.result.outcome,'partial');assert.equal(typeof response.result.executionData,'string');
  assert.ok(response.result.batchResults.some(row=>row.outcome==='admitted'));
  assert.ok(response.result.batchResults.some(row=>row.outcome==='rejected'));
  assert.throws(()=>preparePQTransferTransport(Buffer.from(whole.expectedTransaction.nativeWire,'base64')));
  assert.throws(()=>preparePQTransferFinalityInvocation(original,binding,whole.expectedTransaction,success.request.proof),{code:'PQ_FINALITY_INVOCATION_ORIGINAL_MISMATCH'});
});

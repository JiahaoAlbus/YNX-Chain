import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keyGen,batchSign,extract,encodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {encodePQNativeTransfer,decodePQTransferRequest,preparePQTransferTransport} from '../src/pq-wallet-authorization.js';
test('original-store decoder derives exact signed owner/network/U64 instead of caller labels, retains N1 limit',()=>{
  const key=keyGen({provider:'portable'}),batches=[];
  const transfer={chainId:'71'.repeat(32),nativeChainId:'6423',from:'0x'+'11'.repeat(20),to:'0x'+'22'.repeat(20),amount:'4294967297',fee:'1',nonce:'9007199254740993'};
  const meta={chainId:Buffer.from(transfer.chainId,'hex'),owner:transfer.from,purpose:'TX-BATCH'};
  try{
    const message=encodePQNativeTransfer(transfer),signed=batchSign(key.privateKey,meta,[message]);batches.push(signed.batch);
    const member=encodeMember(extract(signed.batch,0)),decoded=decodePQTransferRequest(member);
    assert.deepEqual(decoded.transfer,transfer);assert.equal(decoded.transportHash,preparePQTransferTransport(member).transportHash);
    assert.equal(decoded.pkA,key.publicKey.pkA.toString('hex'));assert.equal(decoded.pkB,key.publicKey.pkB.toString('hex'));
    member.fill(0);assert.equal(decoded.transfer.nonce,'9007199254740993');assert(Object.isFrozen(decoded.transfer));
    const aggregate=batchSign(key.privateKey,meta,[message,message]);batches.push(aggregate.batch);
    assert.throws(()=>decodePQTransferRequest(encodeMember(extract(aggregate.batch,0))),{code:'PQ_STANDALONE_N1_REQUIRED'});
    const crossed=batchSign(key.privateKey,{...meta,owner:transfer.to},[message]);batches.push(crossed.batch);
    assert.throws(()=>decodePQTransferRequest(encodeMember(extract(crossed.batch,0))),{code:'PQ_PROOF_CONTEXT_MISMATCH'});
  }finally{for(const b of batches)discardBatch(b);destroyKey(key.privateKey)}
});

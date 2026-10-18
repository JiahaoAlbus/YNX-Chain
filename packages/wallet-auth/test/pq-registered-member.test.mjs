import test from 'node:test';
import assert from 'node:assert/strict';
import {keyGen,batchSign,extract,encodeMember,decodeMember,discardBatch,destroyKey} from '@ynx/batch-v01-candidate';
import {parsePQAccountAuthorization,pqRegisteredPublicBinding} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {verifyPQRegisteredMemberData,assertPQRegisteredRecoveryBindingData} from '@ynx-chain/wallet-auth/pq-registered-member';

// PUBLIC synthetic registration DATA + ephemeral test keys, never Auth
// credentials, real chain registrations, account recovery or protected access.
test('shared registered verifier: both signatures/paths, U64 policy, rotation and recovery DATA',()=>{
  const key=keyGen({provider:'portable'}),other=keyGen({provider:'portable'});
  const network={chainId:'ab'.repeat(32),nativeChainId:'6423',owner:'0x'+'12'.repeat(20)};
  const purpose='PUBLIC-TEST-ONLY',message=Buffer.from('public exact request #1'),height='9007199254740993';
  const row=(pair,revision='1',registeredAt='10',activeFrom='11',ledgerNonce='1')=>({algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:pair.pkA.toString('hex'),pkB:pair.pkB.toString('hex'),revision,registeredAt,activeFrom,ledgerNonce});
  const raw=()=>({owner:network.owner,executionHeight:height,ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[row(key.publicKey)]});
  const parse=dto=>parsePQAccountAuthorization(dto,network);
  const expected={chainId:network.chainId,owner:network.owner,keyVersion:'1',executionHeight:height,purpose,message};
  const batch=batchSign(key.privateKey,{chainId:Buffer.from(network.chainId,'hex'),owner:network.owner,purpose},[Buffer.alloc(0),message]);
  try{
    const wire=encodeMember(extract(batch.batch,1)),snapshot=parse(raw());
    const verified=verifyPQRegisteredMemberData(snapshot,wire,expected);
    assert.equal(verified.signatureVerified,true);assert.equal(verified.keyVersion,'1');
    assert.equal(verified.executionHeight,height);assert.equal(verified.nativeAdmission,false);assert.equal(verified.dataOnly,true);
    assert(Object.isFrozen(verified));assert.equal('grant' in verified,false);
    assert.equal(decodeMember(wire).certificate.N,2); // Do not impose transfer-specific N1.
    assert.equal(verifyPQRegisteredMemberData(snapshot,encodeMember(extract(batch.batch,0)),{...expected,message:Buffer.alloc(0)}).memberIndex,0);
    const binding=pqRegisteredPublicBinding(snapshot);
    const {purpose:unusedPurpose,message:unusedMessage,...recoveryContext}=expected;
    assert.equal(assertPQRegisteredRecoveryBindingData(snapshot,binding,recoveryContext).nativeAdmission,false);
    for(const change of [{purpose:'TX-BATCH'},{message:Buffer.from('different request')},{owner:'0x'+'13'.repeat(20)},{chainId:'ac'.repeat(32)},{keyVersion:'2'},{executionHeight:'9007199254740992'}])assert.throws(()=>verifyPQRegisteredMemberData(snapshot,wire,{...expected,...change}));
    assert.throws(()=>verifyPQRegisteredMemberData({...snapshot},wire,expected),{code:'PQ_POLICY_SNAPSHOT_REQUIRED'});
    assert.throws(()=>verifyPQRegisteredMemberData(snapshot,wire,{...expected,keyVersion:1}),{code:'PQ_REGISTERED_DECIMAL_REQUIRED'});
    let invoked=false;
    assert.throws(()=>verifyPQRegisteredMemberData(snapshot,wire,{...expected,get purpose(){invoked=true;return purpose;}}));assert.equal(invoked,false);
    for(const field of ['sigmaA','sigmaB']){
      const changed=decodeMember(wire);changed.certificate[field][0]^=1;
      assert.throws(()=>verifyPQRegisteredMemberData(snapshot,encodeMember(changed),expected),{code:'PQ_REGISTERED_MEMBER_SIGNATURE_INVALID'});
    }
    for(const field of ['pathA','pathB']){
      const changed=decodeMember(wire);changed[field][0][0]^=1;
      assert.throws(()=>verifyPQRegisteredMemberData(snapshot,encodeMember(changed),expected),{code:'PQ_REGISTERED_MEMBER_SIGNATURE_INVALID'});
    }
    assert.throws(()=>verifyPQRegisteredMemberData(snapshot,Buffer.concat([wire,Buffer.of(0)]),expected));
    const foreign=parse({...raw(),records:[row(other.publicKey)]});
    assert.throws(()=>verifyPQRegisteredMemberData(foreign,wire,expected),{code:'PQ_REGISTERED_MEMBER_BINDING_MISMATCH'});
    assert.throws(()=>assertPQRegisteredRecoveryBindingData(foreign,binding,recoveryContext),{code:'PQ_BINDING_MISMATCH'});
    const rotated=parse({...raw(),activeRevision:'2',records:[row(key.publicKey),row(other.publicKey,'2','20','21','2')]});
    assert.throws(()=>verifyPQRegisteredMemberData(rotated,wire,expected),{code:'PQ_REGISTERED_KEY_VERSION_MISMATCH'});
    assert.throws(()=>assertPQRegisteredRecoveryBindingData(rotated,binding,{...recoveryContext,keyVersion:'2'}),{code:'PQ_BINDING_MISMATCH'});
    const tombstone={...raw(),executionHeight:'26',policyVersion:'YNX-ACCOUNT-POLICY/v2',revocations:[{owner:network.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:'25',revokedFrom:'26',ledgerNonce:'3'}]};
    const revoked=parse(tombstone),revokedExpected={...expected,executionHeight:'26'};
    assert.throws(()=>verifyPQRegisteredMemberData(revoked,wire,revokedExpected),{code:'PQ_REGISTERED_KEY_INACTIVE'});
    assert.throws(()=>assertPQRegisteredRecoveryBindingData(revoked,binding,{...recoveryContext,executionHeight:'26'}),{code:'PQ_REGISTERED_KEY_INACTIVE'});
    // New calls never inherit old positive certificate/policy results.
    assert.equal(verifyPQRegisteredMemberData(snapshot,wire,expected).signatureVerified,true);
    assert.throws(()=>verifyPQRegisteredMemberData(revoked,wire,revokedExpected));
    // Exercise actual activation/revocation boundaries above safe Number range,
    // reusing the same public test signature rather than signing again.
    const highRecord=row(key.publicKey,'1','9007199254740991',height);
    const beforeActivation={...raw(),executionHeight:'9007199254740992',algorithmVersion:'legacy',records:[highRecord]};delete beforeActivation.activeRevision;
    assert.throws(()=>verifyPQRegisteredMemberData(parse(beforeActivation),wire,{...expected,executionHeight:'9007199254740992'}),{code:'PQ_REGISTERED_KEY_INACTIVE'});
    assert.equal(verifyPQRegisteredMemberData(parse({...raw(),records:[highRecord]}),wire,expected).signatureVerified,true);
    const highRevocation={...raw(),policyVersion:'YNX-ACCOUNT-POLICY/v2',revocations:[{owner:network.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:height,revokedFrom:'9007199254740994',ledgerNonce:'3'}]};
    assert.equal(verifyPQRegisteredMemberData(parse(highRevocation),wire,expected).signatureVerified,true);
    assert.throws(()=>verifyPQRegisteredMemberData(parse({...highRevocation,executionHeight:'9007199254740994'}),wire,{...expected,executionHeight:'9007199254740994'}),{code:'PQ_REGISTERED_KEY_INACTIVE'});
  }finally{discardBatch(batch.batch);destroyKey(key.privateKey);destroyKey(other.privateKey);}
});

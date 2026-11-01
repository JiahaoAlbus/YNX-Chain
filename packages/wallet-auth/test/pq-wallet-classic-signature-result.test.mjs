import test from 'node:test';
import assert from 'node:assert/strict';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {parsePQAccountAuthorization,preparePQClassicMigrationAuthorization,preparePQClassicMigrationProof} from '../src/pq-wallet-policy.js';
const secret=Buffer.alloc(32);secret[31]=1;
const network={chainId:'71'.repeat(32),nativeChainId:'6423',owner:'0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'};
const dto={owner:network.owner,executionHeight:'100',ledgerNonce:'9007199254740993',algorithmVersion:'legacy',enabled:true,records:[],policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10'};
const intent={chainId:network.chainId,owner:network.owner,algorithmVersion:'YNX-BATCH/v0.1',pkA:'03'.repeat(2592),pkB:'04'.repeat(64),priorRevision:'0',newRevision:'1',ledgerNonce:'9007199254740994',activateAt:'101'};
test('original signer public r/s result converts to independently verified canonical low-S DER and original compressed owner key',()=>{
 const policy=parsePQAccountAuthorization(dto,network),prepared=preparePQClassicMigrationAuthorization(policy,intent);
 const compact=Buffer.from(secp256k1.sign(prepared.digest,secret,{prehash:false,format:'compact',lowS:true}));
 const input={publicKey:'0x'+Buffer.from(secp256k1.getPublicKey(secret,false)).toString('hex'),r:'0x'+compact.subarray(0,32).toString('hex'),s:'0x'+compact.subarray(32).toString('hex')};
 const proof=preparePQClassicMigrationProof(policy,intent,input);
 assert.equal(proof.classicPublicKey.length,33);assert.deepEqual(proof.classicPublicKey,new Uint8Array(secp256k1.getPublicKey(secret,true)));
 assert.equal(secp256k1.verify(proof.classicSignature,prepared.digest,proof.classicPublicKey,{prehash:false,lowS:true,format:'der'}),true);
 const copy=proof.classicSignature;copy.fill(0);assert.notDeepEqual(proof.classicSignature,copy);
 assert.throws(()=>preparePQClassicMigrationProof(policy,{...intent,activateAt:'102'},input),{code:'PQ_CLASSIC_AUTHORIZATION_INVALID'});
 assert.throws(()=>preparePQClassicMigrationProof(policy,intent,{...input,s:'0x'+'00'.repeat(32)}),{code:'PQ_CLASSIC_AUTHORIZATION_INVALID'});
 const n=secp256k1.Point.Fn.ORDER,high=(n-BigInt(input.s)).toString(16).padStart(64,'0');
 assert.throws(()=>preparePQClassicMigrationProof(policy,intent,{...input,s:'0x'+high}),{code:'PQ_CLASSIC_AUTHORIZATION_INVALID'});
});
test('active PQ policy rejects classic conversion before inspecting signer output',()=>{
 const current=parsePQAccountAuthorization({...dto,algorithmVersion:'YNX-BATCH/v0.1',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:'07'.repeat(2592),pkB:'08'.repeat(64),revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}]},network);
 assert.throws(()=>preparePQClassicMigrationProof(current,{...intent,priorRevision:'1',newRevision:'2'},null),{code:'PQ_ACTIVE_ACCOUNT_LEGACY_ENTRY_REFUSED'});
});

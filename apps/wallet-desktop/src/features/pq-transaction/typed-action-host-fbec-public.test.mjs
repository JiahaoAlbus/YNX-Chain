import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {decodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {decodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {validatePQTransactionProofDTO} from './finality-collector.mjs';
import {preparePQReviewedTypedActionFinalityTarget,preparePQReviewedTypedActionFinalityInvocation} from './finality-invocation.mjs';
import {bindPQReviewedTypedActionFinalityContext,bindSavedPQReviewedTypedActionFinalityInvocation} from './finality-saved-invocation.mjs';
import {parsePQReviewedTypedActionFinalityVerifierResult} from './finality-verifier-result.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const packed=readFileSync(new URL('./fixtures/typed-host-fbec-public.json.gz',import.meta.url));
assert.equal(packed.length,1191947);assert.equal(sha(packed),'bcf73aee6af688449a8b03f6847277967b53039ca917bed6c3423771a97fea7e');
const fixture=JSON.parse(gunzipSync(packed,{maxOutputLength:4<<20}));
const hashes={
 'typed-request.json':[1261388,'c4e63b91974d4cf2ef02df8fb8771edc150a473367752d797cc766f1acf06230'],
 'trust-context.json':[233642,'04abde4d6b444ad3606fbfaead9b9861264bf9b5ed07ddd39694d83ac276fc7f'],
 'delivery.json':[1800,'ecfc4d48d529243f84051d246a60dcd8dab37d575b5c00153fc1de7fcfbed02d'],
 'ynx-proof-host-typed-source-cli-public-receipt.json':[2429,'01fdbec72fb96c985c88a69fa1c5910d8c027e765ee27f5095273180e9fac9e4'],
};
const raws=Object.fromEntries(fixture.files.map(f=>{
 const name=f.path.split('/').at(-1),raw=Buffer.from(f.base64,'base64');
 assert.equal(raw.toString('base64'),f.base64);assert.deepEqual([raw.length,sha(raw)],hashes[name]);assert.equal(f.bytes,raw.length);assert.equal(f.sha256,sha(raw));return [name,raw];
}));
assert.deepEqual(Object.keys(raws).sort(),Object.keys(hashes).sort());
const request=JSON.parse(raws['typed-request.json']),context=JSON.parse(raws['trust-context.json']),delivery=JSON.parse(raws['delivery.json']),receipt=JSON.parse(raws['ynx-proof-host-typed-source-cli-public-receipt.json']);
const raw=Buffer.from(request.expected.envelope,'base64');
const sdkRequire=createRequire(import.meta.resolve('@ynx-chain/wallet-auth/pq-action-transport-node'));
const {decodeMember}=await import(pathToFileURL(sdkRequire.resolve('@ynx/batch-v01-candidate')));

test('actual fbec typed Host request bytes decode with SDK332 and preserve distinct Member and transport identities',()=>{
 const decoded=decodePQActionTransportData(raw),member=decodeMember(Buffer.from(decoded.member)),action=decodePQNativeAction(member.message),expected=request.expected;
 assert.equal(decoded.type,'pq_action');assert.equal(decoded.originals.length,0);assert.equal(member.index,0);
 assert.equal(action.kind,'stake');assert.equal(action.nonce,'2');assert.equal(action.owner,delivery.binding.account);assert.equal(action.chainId,delivery.binding.networkId);
 assert.equal(Buffer.from(decoded.member).toString('base64'),expected.nativeWire);assert.equal(raw.length,115661);assert.equal(decoded.member.length,57808);
 assert.equal(sha(raw),expected.transactionHash);assert.equal(sha(decoded.member),expected.nativeWireHash);assert.notEqual(expected.transactionHash,expected.nativeWireHash);
 assert.deepEqual(context.expectedTransaction,expected);assert.equal(expected.transactionType,'pq_action');assert.equal(expected.block.headerHeight,'12');assert.equal(expected.index,'0');
 assert.equal(delivery.binding.originalHash,'0x'+expected.nativeWireHash);assert.equal(delivery.binding.transactionHash,expected.transactionHash);
 // The public Protocol source binding uses Member as originalHash. Wallet's
 // typed journal instead uses the transport hash; never silently alias them.
 assert.notEqual(delivery.binding.originalHash,'0x'+expected.transactionHash);
});

test('actual typed Go proof DTO passes existing collector grammar while receipt remains synthetic Linux evidence',()=>{
 const proof=validatePQTransactionProofDTO(request.proof);assert.deepEqual(proof,request.proof);assert.ok(Object.isFrozen(proof));assert.ok(Object.isFrozen(proof.block));
 assert.equal(receipt.commit,'fbecfbefff09d1f20b059fc859cfcdd6affcabde');assert.equal(receipt.runId,'39955891165');assert.equal(receipt.requestSHA256,sha(raws['typed-request.json']));
 for(const k of ['transactionType','transactionHash','nativeWireHash','index'])assert.equal(receipt[k],request.expected[k]);
 assert.equal(receipt.height,'12');assert.equal(receipt.normalCLIExecuted,true);assert.equal(receipt.transactionProofVerified,true);assert.equal(receipt.syntheticOnly,true);
 assert.equal(receipt.binaryPins['ynx-consensus-proof-verify'].sha256,'b0b4f3fcced0318730596d57af31fa4fceab68a55d030e71717f8628ec63b6fb');
 assert.notEqual(receipt.binaryPins['ynx-consensus-proof-verify'].sha256,'a7e47ea79b3e4bdd40014c8c02aafbad7b37a69c9c15c7f45a9fd0c51d44479d');
 assert.equal(receipt.cases.length,6);assert(receipt.cases.every(c=>c.exitCode===0));
 for(const k of ['nativeRootAuthorized','sourceDeploymentQualified','actualCometNode','installedWallet','publicDeployment','pqActivation'])assert.equal(receipt[k],false);
 assert.equal(receipt.cases.find(c=>c.name==='typed-original-transaction-proof').stdoutSHA256,'a224ae2057c7ad4a3324681e6ee61f1442967edbbccf28cc7ec03edd8f745d6c');
 // Only the receipt digest is supplied, not stdout bytes. Do not fabricate
 // stdout from expected fields or treat a claimed result as the exact result.
 assert.equal(Object.hasOwn(raws,'stdout'),false);
 assert.throws(()=>validatePQTransactionProofDTO({...request.proof,trust:context}),{code:'PQ_FINALITY_PROOF_DATA_INVALID'});
});

test('actual typed Host bytes and receipt do not replace missing original Wallet review or archived policy snapshots',()=>{
 const denied={code:'PQ_REVIEWED_TRANSPORT_ORIGINAL_INVALID'},expected=request.expected;
 // The source package has no Wallet review/snapshots. All five reviewed APIs
 // remain unavailable; no pseudo review or snapshot is made from Host state.
 assert.throws(()=>preparePQReviewedTypedActionFinalityTarget(undefined,raw,undefined,expected),denied);
 assert.throws(()=>preparePQReviewedTypedActionFinalityInvocation(undefined,raw,undefined,expected,request.proof),denied);
 assert.throws(()=>bindPQReviewedTypedActionFinalityContext(undefined,raw,undefined,raws['trust-context.json']),denied);
 assert.throws(()=>bindSavedPQReviewedTypedActionFinalityInvocation(undefined,raw,undefined,raws['trust-context.json'],raws['typed-request.json']),denied);
 assert.throws(()=>parsePQReviewedTypedActionFinalityVerifierResult(undefined,raw,undefined,expected,receipt),denied);
});

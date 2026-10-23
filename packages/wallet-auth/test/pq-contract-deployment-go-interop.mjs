// Explicit original Go fixture consumer. No keys, signing, POST or grant.
// Run with the independently supplied whole-fixture SHA, not a self-trusted field.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {encodePQContractDeploymentTransportData,decodePQContractDeploymentTransportData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport';
import {preparePQContractDeploymentTransportData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport-node';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';

const [file,expectedSHA]=process.argv.slice(2);
assert.equal(process.argv.length,4,'usage: node test/pq-contract-deployment-go-interop.mjs FIXTURE INDEPENDENT_SHA256');
assert.match(expectedSHA,/^[0-9a-f]{64}$/);
assert(fs.statSync(file).size>0&&fs.statSync(file).size<=32<<20);
const raw=fs.readFileSync(file),hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(raw),expectedSHA,'original Go artifact identity');
const f=JSON.parse(raw);
assert.equal(f.version,'YNX-PQ-CONTRACT-DEPLOY-PUBLIC/v1');
assert.equal(f.classification,'data');assert.equal(f.syntheticOnly,true);
for(const name of ['broadcastExecuted','actualCometNode','independentFinality','nativeGrant','publicBFT','deployedSourceQualification'])assert.equal(f[name],false,name);
assert.equal(f.proofVerification,'not-performed');
assert.equal(f.actionKind,'contract_deploy');assert.equal(f.fee,'10');assert.equal(f.nativeChainId,'6423');
assert.equal(f.memberN,'2');assert.equal(f.memberIndex,'1');assert.equal(f.cometIndex,'0');
assert.deepEqual(f.transportFields,['version','type','wireHex','source','material']);
const bytes=value=>{
  assert.equal(typeof value,'string');const b=Buffer.from(value,'base64');
  assert.equal(b.toString('base64'),value,'canonical standard Base64');return b;
};
const files=new Map();
for(const row of f.files){
  assert(!files.has(row.role));const b=bytes(row.bytes);
  assert.equal(String(b.length),row.byteLength);assert.equal(hash(b),row.sha256);
  files.set(row.role,b);
}
assert.deepEqual([...files.keys()],['source','artifactFile','buildInfoFile']);
const member=bytes(f.nativeWire),transport=bytes(f.transport);
assert.equal(hash(member),f.nativeWireSha256);assert.equal(hash(transport),f.transportSha256);
const input={member,source:f.source,material:{artifactFile:files.get('artifactFile'),buildInfoFile:files.get('buildInfoFile')}};
// Use exactly the signed Go transport source, never trim raw files in the caller.
assert.deepEqual(Buffer.from(encodePQContractDeploymentTransportData(input)),transport);
const decoded=decodePQContractDeploymentTransportData(transport);
assert.deepEqual(Buffer.from(decoded.member),member);assert.equal(decoded.source,f.source);
assert.deepEqual(Buffer.from(decoded.material.artifactFile),files.get('artifactFile'));
assert.deepEqual(Buffer.from(decoded.material.buildInfoFile),files.get('buildInfoFile'));
assert.equal(decoded.compilerMaterialValidationRequired,true);assert.equal(decoded.nativeAdmission,false);
const request=f.preparedRequest;
assert.equal(request.method,'POST');assert.equal(request.path,'/transactions/pq/actions/broadcast');
assert.equal(request.contentType,'application/json');assert.equal(request.executed,false);
assert.deepEqual(bytes(request.body),transport);
assert.equal(request.encodedRpcBytes,String(4*Math.ceil(transport.length/3)+74));
assert.equal(request.maxRpcBytes,'792658');
assert.equal(request.eligibleForRpc,BigInt(request.encodedRpcBytes)<=BigInt(request.maxRpcBytes));

// Fixture-only projection from the original complete, committed prestate.
// This does not implement another production account observer or use consumed
// history.authorization. The existing strict SDK parser owns policy validation.
const before=f.accountBefore;
assert.equal(before.source,'comet-rpc');assert.equal(before.recordsView,'committed');
assert.equal(before.policyView,'next_execution');assert.equal(before.recordsComplete,true);
assert.equal(before.owner,f.owner);assert.equal(before.networkId,f.networkId);
assert.equal(before.nativeChainId,f.nativeChainId);assert.equal(before.enabled,true);
assert.equal(before.pqSigningEnabled,true);assert.equal(before.authorizationStatus,'active');
assert.equal(BigInt(before.committedHeight)+1n,BigInt(before.executionHeight));
assert.equal(before.executionHeight,f.executionHeight);assert.equal(BigInt(before.ledgerNonce)+1n,BigInt(f.nonce));
const policy=before.policy;
assert.equal(policy.networkId,f.networkId);
const active=policy.records.filter(r=>BigInt(r.activeFrom)<=BigInt(before.executionHeight)).at(-1);
assert(active);const dto={owner:before.owner,executionHeight:before.executionHeight,ledgerNonce:before.ledgerNonce,
  algorithmVersion:active.algorithmVersion,enabled:before.enabled,policyVersion:policy.version,
  networkId:policy.networkId,enableAt:policy.enableAt,activeRevision:active.revision,records:policy.records};
if(policy.revocations?.length)dto.revocations=policy.revocations;
const snapshot=parsePQAccountAuthorization(dto,{chainId:f.networkId,nativeChainId:f.nativeChainId,owner:f.owner});
const result=preparePQContractDeploymentTransportData(snapshot,input);
assert.deepEqual(Buffer.from(result.body),transport);assert.equal(result.signatureVerified,true);
assert.equal(result.memberCount,2);assert.equal(result.memberIndex,1);
assert.equal(result.action.kind,'contract_deploy');assert.equal(result.action.fee,'10');
assert.equal(result.action.nonce,f.nonce);assert.equal(result.action.nativeChainId,'6423');
assert.deepEqual(result.action.payload,f.payload,'complete signed Go payload, including value');
assert.equal(result.compilerMaterialValidationRequired,true);assert.equal(result.nativeAdmission,false);
assert.equal(f.http.length,4);
for(const response of f.http){
  assert.equal(response.method,'GET');assert.equal(response.cacheControl,'no-store');
  assert.equal(hash(bytes(response.body)),response.bodySha256);
}
console.log(JSON.stringify({fixtureSHA256:expectedSHA,memberSHA256:hash(member),transportSHA256:hash(transport),
  exactFiveFieldInterop:true,originalRegisteredDualMath:true,memberN:2,memberIndex:1,cometIndex:0,
  broadcastExecuted:false,independentFinality:false,nativeGrant:false}));

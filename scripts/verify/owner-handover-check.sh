#!/usr/bin/env bash
set -Eeuo pipefail
phase=setup
trap 'check_status=$?; printf "OWNER_HANDOVER_CHECK_FAILED phase=%s line=%s status=%s\n" "$phase" "$LINENO" "$check_status" >&2; exit "$check_status"' ERR

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/sources" "$tmp/packets"
chmod 700 "$tmp/sources" "$tmp/packets"
commit="$(git rev-parse --short=12 HEAD)"

node - "$tmp/sources/validators.json" "$tmp/sources/service-signers.json" "$tmp/sources/status.json" <<'NODE'
const crypto=require("crypto"),fs=require("fs");
const [validatorsPath,servicePath,statusPath]=process.argv.slice(2);
const roles=["primary","singapore","silicon-valley","seoul"];
const validators={version:1,purpose:"ynx-production-bft-candidate-public-keys-only",chainId:"ynx_6423-1",validators:roles.map((role,index)=>({validatorAddress:`ynx_validator_${role.replaceAll("-","_")}`,role,privateP2PHost:`10.77.42.${index+1}`,p2pPort:27656,nodeId:String(index+1).repeat(40),consensusKeyType:"tendermint/PubKeyEd25519",consensusPubKey:Buffer.alloc(32,index+1).toString("base64"),consensusAddress:String.fromCharCode(65+index).repeat(40)}))};
const serviceRoles=["faucet","ai","pay","trust","resource"];
const service={schemaVersion:1,purpose:"ynx-production-service-signer-public-manifest",generatedAt:new Date().toISOString(),records:serviceRoles.map((role,index)=>({role,purpose:`ynx-production-${role}-signer`,address:`0x${String(index+1).repeat(40)}`}))};
const serviceRaw=Buffer.from(`${JSON.stringify(service,null,2)}\n`);
const status={schemaVersion:1,purpose:"ynx-production-service-signer-ceremony-status",publicManifestSha256:crypto.createHash("sha256").update(serviceRaw).digest("hex"),signerCount:5,distinctAddressesVerified:true,ownerLocalKeysModeRestricted:true,ownerDesignatedRecoveryCopyMatched:true,remoteSignerInstallCompleted:false,offlineRecoveryVerified:false,ownerHandoverVerified:false,rotationProcedureVerified:false,independentCustodyReviewVerified:false};
fs.writeFileSync(validatorsPath,`${JSON.stringify(validators,null,2)}\n`,{mode:0o600});
fs.writeFileSync(servicePath,serviceRaw,{mode:0o600});
fs.writeFileSync(statusPath,`${JSON.stringify(status,null,2)}\n`,{mode:0o600});
NODE
chmod 600 "$tmp/sources"/*.json

write_packet() {
  local id="$1" catalog="${2:-docs/custody/OWNER_HANDOVER_OPERATIONAL_ACCOUNTS.json}"
  YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST="$tmp/sources/validators.json" \
  YNX_OWNER_HANDOVER_SERVICE_SIGNER_MANIFEST="$tmp/sources/service-signers.json" \
  YNX_OWNER_HANDOVER_SERVICE_SIGNER_STATUS="$tmp/sources/status.json" \
  YNX_OWNER_HANDOVER_OPERATIONAL_CATALOG="$catalog" \
  YNX_OWNER_HANDOVER_OUTPUT_DIR="$tmp/packets" \
  YNX_OWNER_HANDOVER_PACKET_ID="$id" \
  node scripts/ops/write-owner-handover-packet.mjs
}

phase=legacy_packet_generation
write_packet owner-handover-self-test >"$tmp/write.log"
packet="$tmp/packets/owner-handover-self-test"
inventory="$packet/inventory.json"
receipt="$packet/receipt.template.json"
request="$packet/HANDOVER_REQUEST.md"
phase=legacy_packet_permissions
stat_platform="$(uname -s)"
for file in "$inventory" "$receipt" "$request"; do
  # GNU stat -f selects filesystem reporting; its stdout can survive a failed
  # BSD-format attempt. Select one dialect without concatenating fallback output.
  case "$stat_platform" in
    Linux) file_mode="$(stat -c '%a' -- "$file")" ;;
    Darwin) file_mode="$(stat -f '%Lp' "$file")" ;;
    *) echo "unsupported stat platform for exact packet permissions" >&2; exit 1 ;;
  esac
  [[ "$file_mode" == 600 ]]
done
echo "OWNER_HANDOVER_PACKET_MODE_0600_VERIFIED"
phase=legacy_inventory_and_receipt
node - "$inventory" <<'NODE'
const fs=require("fs"),v=JSON.parse(fs.readFileSync(process.argv[2]));
if(v.records.length!==12||v.readiness.validatorCount!==4||v.readiness.serviceSignerCount!==5||v.readiness.handoverRequiredCount!==9||v.readiness.unknownOwnershipCount!==0||v.readiness.publicBFTReady!==false)process.exit(1);
const faucet=v.records.find(r=>r.id==="authoritative-faucet-runtime"),proof=v.records.find(r=>r.id==="public-address-proof-account");
if(faucet.identityType!=="authoritative-runtime-account"||faucet.handoverRequired||proof.custodyLocationClass!=="public-known-test-key-not-secure"||proof.handoverRequired)process.exit(1);
for(const record of v.records.filter(r=>r.category==="service-signer"))if(!/^ynx1[02-9ac-hj-np-z]{38}$/.test(record.publicAlias))process.exit(1);
if(!/^sha256:[0-9a-f]{64}$/.test(v.inventoryDigest)||JSON.stringify(v).match(/privateKey|mnemonic|seedPhrase|pemContent|secretPath/))process.exit(1);
NODE
if node scripts/verify/validate-owner-handover-receipt.mjs "$receipt" "$inventory" "$commit" >/dev/null 2>&1; then
  echo "unacknowledged owner handover receipt unexpectedly passed" >&2
  exit 1
fi

acknowledged_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
expires_at="$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)"
node - "$receipt" "$acknowledged_at" "$expires_at" <<'NODE'
const fs=require("fs");
const [file,acknowledgedAt,expiresAt]=process.argv.slice(2),v=JSON.parse(fs.readFileSync(file));
Object.assign(v,{receiptId:"owner-handover-self-test-001",owner:"YNX owner fixture",independentReviewer:"independent custody fixture",acknowledged:true,validatorRecoveryVerified:true,serviceSignerOfflineRecoveryVerified:true,ownerHandoverVerified:true,rotationProcedureVerified:true,validatorRecoveryEvidence:"offline:validator-restore-001",serviceSignerRecoveryEvidence:"offline:service-restore-001",ownerHandoverEvidence:"handover:owner-ack-001",rotationProcedureEvidence:"rotation:review-001",acknowledgedAt,expiresAt});
fs.writeFileSync(file,`${JSON.stringify(v,null,2)}\n`,{mode:0o600});
NODE
result="$(node scripts/verify/validate-owner-handover-receipt.mjs "$receipt" "$inventory" "$commit")"
node -e 'const v=JSON.parse(process.argv[1]);if(v.status!=="passed"||v.recordCount!==12||v.handoverRequiredCount!==9||v.publicBFTReady!==false||!/^sha256:[0-9a-f]{64}$/.test(v.handoverEvidence))process.exit(1)' "$result"

phase=legacy_rejection_controls
cp "$receipt" "$tmp/self-reviewed.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.independentReviewer=v.owner;fs.writeFileSync(p,JSON.stringify(v)+"\n",{mode:0o600})' "$tmp/self-reviewed.json"
if node scripts/verify/validate-owner-handover-receipt.mjs "$tmp/self-reviewed.json" "$inventory" "$commit" >/dev/null 2>&1; then
  echo "self-reviewed owner handover receipt unexpectedly passed" >&2
  exit 1
fi
cp "$inventory" "$tmp/tampered-inventory.json"
printf ' ' >>"$tmp/tampered-inventory.json"
chmod 600 "$tmp/tampered-inventory.json"
if node scripts/verify/validate-owner-handover-receipt.mjs "$receipt" "$tmp/tampered-inventory.json" "$commit" >/dev/null 2>&1; then
  echo "receipt bound to tampered inventory unexpectedly passed" >&2
  exit 1
fi
if node scripts/verify/validate-owner-handover-receipt.mjs "$receipt" "$inventory" 000000000000 >/dev/null 2>&1; then
  echo "stale-commit owner handover receipt unexpectedly passed" >&2
  exit 1
fi
if write_packet owner-handover-self-test >/dev/null 2>&1; then
  echo "owner handover generator unexpectedly overwrote an existing packet" >&2
  exit 1
fi

cp "$tmp/sources/status.json" "$tmp/original-status.json"
cp "$tmp/sources/service-signers.json" "$tmp/sources/duplicate-service.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.records[1].address=v.records[0].address;fs.writeFileSync(p,JSON.stringify(v)+"\n",{mode:0o600})' "$tmp/sources/duplicate-service.json"
duplicate_sha="$(shasum -a 256 "$tmp/sources/duplicate-service.json" | awk '{print $1}')"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.publicManifestSha256=process.argv[2];fs.writeFileSync(p,JSON.stringify(v)+"\n",{mode:0o600})' "$tmp/sources/status.json" "$duplicate_sha"
if YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST="$tmp/sources/validators.json" YNX_OWNER_HANDOVER_SERVICE_SIGNER_MANIFEST="$tmp/sources/duplicate-service.json" YNX_OWNER_HANDOVER_SERVICE_SIGNER_STATUS="$tmp/sources/status.json" YNX_OWNER_HANDOVER_OUTPUT_DIR="$tmp/packets" YNX_OWNER_HANDOVER_PACKET_ID=duplicate-service-test node scripts/ops/write-owner-handover-packet.mjs >/dev/null 2>&1; then
  echo "duplicate service signer identity unexpectedly passed" >&2
  exit 1
fi
cp "$tmp/original-status.json" "$tmp/sources/status.json"
chmod 600 "$tmp/sources/status.json"

cp docs/custody/OWNER_HANDOVER_OPERATIONAL_ACCOUNTS.json "$tmp/unknown-funded.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.records[1].category="external-or-unknown";fs.writeFileSync(p,JSON.stringify(v)+"\n")' "$tmp/unknown-funded.json"
if write_packet unknown-funded-test "$tmp/unknown-funded.json" >/dev/null 2>&1; then
  echo "funded account with unknown ownership unexpectedly passed" >&2
  exit 1
fi

phase=single_app_draft_controls
node --input-type=module - "$tmp" "$commit" <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sha256,validateInventory} from './scripts/verify/lib/owner-handover.mjs';
const [tmp,commit]=process.argv.slice(2),profile='single-app-gateway/v1';
const validator=path.join(tmp,'sources/validators.json'),original=fs.readFileSync(validator),out=path.join(tmp,'scoped-packets');
const base={...process.env,YNX_OWNER_HANDOVER_CUSTODY_PROFILE:profile,YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:validator,YNX_OWNER_HANDOVER_OPERATOR_PLAN_SHA256:'1'.repeat(64),YNX_OWNER_HANDOVER_RUNTIME_MANIFEST_SHA256:'2'.repeat(64),YNX_OWNER_HANDOVER_OUTPUT_DIR:out,
  // These do not exist: a scoped draft must never read legacy signer/catalog inputs.
  YNX_OWNER_HANDOVER_SERVICE_SIGNER_MANIFEST:path.join(tmp,'unavailable-service'),YNX_OWNER_HANDOVER_SERVICE_SIGNER_STATUS:path.join(tmp,'unavailable-status'),YNX_OWNER_HANDOVER_OPERATIONAL_CATALOG:path.join(tmp,'unavailable-catalog')};
const run=(id,change={},ok=false)=>{const env={...base,...change,YNX_OWNER_HANDOVER_PACKET_ID:id};for(const k of Object.keys(env))if(env[k]===undefined)delete env[k];const p=spawnSync(process.execPath,['scripts/ops/write-owner-handover-packet.mjs'],{env,encoding:'utf8'});assert.equal(p.status===0,ok,p.stderr);return p;};
run('single-app-draft',{},true);
const dir=path.join(out,'single-app-draft'),inventoryPath=path.join(dir,'inventory.json'),receiptPath=path.join(dir,'receipt.template.json');
const inventory=validateInventory(JSON.parse(fs.readFileSync(inventoryPath)),commit),receipt=JSON.parse(fs.readFileSync(receiptPath));
assert.equal(inventory.custodyProfile,profile);assert.equal(receipt.custodyProfile,profile);assert.equal(inventory.records.length,4);assert.equal(inventory.readiness.serviceSignerCount,0);assert.equal(inventory.readiness.publicBFTReady,false);
assert.deepEqual(inventory.sources,{validatorManifestSha256:sha256(original),operatorPlanSha256:'1'.repeat(64),runtimeManifestSha256:'2'.repeat(64)});
for(const k of ['acknowledged','validatorRecoveryVerified','ownerHandoverVerified','rotationProcedureVerified'])assert.equal(receipt[k],false);
for(const k of ['serviceSignerOfflineRecoveryVerified','serviceSignerRecoveryEvidence'])assert.equal(Object.hasOwn(receipt,k),false);
assert.equal(receipt.owner,'');assert.equal(receipt.independentReviewer,'');assert.equal(receipt.expiresAt,'');
for(const name of fs.readdirSync(dir))assert.equal(fs.statSync(path.join(dir,name)).mode&0o777,0o600);
const rejected=spawnSync(process.execPath,['scripts/verify/validate-owner-handover-receipt.mjs',receiptPath,inventoryPath,commit],{encoding:'utf8'});assert.notEqual(rejected.status,0,'false scoped template granted custody');
const saved=fs.readdirSync(dir).map(n=>[n,fs.readFileSync(path.join(dir,n))]);run('single-app-draft');saved.forEach(([n,b])=>assert.deepEqual(fs.readFileSync(path.join(dir,n)),b));
for(const [i,change]of [
  {YNX_OWNER_HANDOVER_CUSTODY_PROFILE:''},{YNX_OWNER_HANDOVER_CUSTODY_PROFILE:'unknown'},
  {YNX_OWNER_HANDOVER_CUSTODY_PROFILE:undefined},
  {YNX_OWNER_HANDOVER_OPERATOR_PLAN_SHA256:undefined},{YNX_OWNER_HANDOVER_RUNTIME_MANIFEST_SHA256:''},
  {YNX_OWNER_HANDOVER_OPERATOR_PLAN_SHA256:'0'.repeat(64)},{YNX_OWNER_HANDOVER_RUNTIME_MANIFEST_SHA256:'A'.repeat(64)},
].entries()){const id=`invalid-scoped-draft-${i}`;run(id,change);assert.equal(fs.existsSync(path.join(out,id)),false);}
const altered=JSON.parse(original);altered.validators[1].nodeId=altered.validators[0].nodeId;const wrong=path.join(tmp,'duplicate-scoped-validators.json');fs.writeFileSync(wrong,JSON.stringify(altered),{mode:0o600});run('duplicate-scoped-draft',{YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:wrong});
const partial=path.join(out,'partial-scoped-draft');fs.mkdirSync(partial,{mode:0o700});fs.writeFileSync(path.join(partial,'UNKNOWN'),'preserve-original',{mode:0o600});run('partial-scoped-draft');assert.equal(fs.readFileSync(path.join(partial,'UNKNOWN'),'utf8'),'preserve-original');
const target=path.join(tmp,'absent-target');fs.symlinkSync(target,path.join(out,'symlink-scoped-draft'));run('symlink-scoped-draft');assert.equal(fs.lstatSync(path.join(out,'symlink-scoped-draft')).isSymbolicLink(),true);assert.equal(fs.existsSync(target),false);
assert.deepEqual(fs.readFileSync(validator),original);
console.log('SINGLE_APP_OWNER_DRAFT_FALSE: exact four identities/pins, no service inputs, no authorization, exclusive originals preserved');
NODE

phase=validator_manifest_role_order_controls
node --input-type=module - "$tmp" "$commit" <<'NODE'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {inventoryCore, sha256, validateInventory, validatorRoles} from './scripts/verify/lib/owner-handover.mjs';
const [tmp,commit]=process.argv.slice(2),profile='single-app-gateway/v1';
const root=path.join(tmp,'manifest-order-only-public-fixtures');fs.mkdirSync(root,{mode:0o700});
// Fixed PUBLIC bytes only: no private keys, new key generation, or real custody assertion.
const original={version:1,purpose:'ynx-production-bft-candidate-public-keys-only',chainId:'ynx_6423-1',validators:validatorRoles.map((role,i)=>{
  const publicBytes=Buffer.alloc(32,i+1);
  return {validatorAddress:`ynx_validator_${role.replaceAll('-','_')}`,role,privateP2PHost:`10.77.42.${i+1}`,p2pPort:27656,nodeId:String(i+1).repeat(40),consensusKeyType:'tendermint/PubKeyEd25519',consensusPubKey:publicBytes.toString('base64'),consensusAddress:crypto.createHash('sha256').update(publicBytes).digest('hex').slice(0,40).toUpperCase()};
})};
const put=(file,value)=>{fs.writeFileSync(file,JSON.stringify(value),{flag:'wx',mode:0o600});return file;};
const run=(file,args,env,ok=true,reason)=>{const p=spawnSync(process.execPath,[file,...args],{env:{...process.env,...env},encoding:'utf8'});assert.equal(p.status===0,ok,p.stderr);if(reason)assert.match(p.stderr,reason);return p;};
const ownerEnv={YNX_OWNER_HANDOVER_CUSTODY_PROFILE:profile,YNX_OWNER_HANDOVER_OPERATOR_PLAN_SHA256:'1'.repeat(64),YNX_OWNER_HANDOVER_RUNTIME_MANIFEST_SHA256:'2'.repeat(64),YNX_OWNER_HANDOVER_OUTPUT_DIR:path.join(root,'owners'),YNX_OWNER_HANDOVER_SERVICE_SIGNER_MANIFEST:path.join(root,'absent-service'),YNX_OWNER_HANDOVER_SERVICE_SIGNER_STATUS:path.join(root,'absent-status'),YNX_OWNER_HANDOVER_OPERATIONAL_CATALOG:path.join(root,'absent-catalog')};
const owner=(id,manifest,ok=true,reason)=>run('scripts/ops/write-owner-handover-packet.mjs',[],{...ownerEnv,YNX_OWNER_HANDOVER_PACKET_ID:id,YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:manifest},ok,reason);
let originalRecords;
for(const [name,rows] of [['original-order',original.validators],['go-role-sorted',[...original.validators].sort((a,b)=>a.role.localeCompare(b.role))],['reverse-order',[...original.validators].reverse()]]){
  const manifest=put(path.join(root,`${name}.json`),{...original,validators:rows}),bytes=fs.readFileSync(manifest);
  owner(name,manifest);
  const directory=path.join(ownerEnv.YNX_OWNER_HANDOVER_OUTPUT_DIR,name),inventoryFile=path.join(directory,'inventory.json'),draftFile=path.join(directory,'receipt.template.json');
  const inventory=validateInventory(JSON.parse(fs.readFileSync(inventoryFile)),commit),draft=JSON.parse(fs.readFileSync(draftFile));
  assert.deepEqual(inventory.records.map(r=>r.role),validatorRoles);assert.equal(inventory.sources.validatorManifestSha256,sha256(bytes));
  if(originalRecords)assert.deepEqual(inventory.records,originalRecords);else originalRecords=inventory.records;
  assert.equal(draft.acknowledged,false);assert.equal(draft.owner,'');assert.equal(draft.independentReviewer,'');assert.equal(inventory.readiness.publicBFTReady,false);
  run('scripts/verify/validate-owner-handover-receipt.mjs',[draftFile,inventoryFile,commit],{},false);
  // A completed synthetic owner fixture is needed to reach the original review
  // producer. It is local test DATA, never a production receipt or reviewer.
  const now=new Date(),receipt={...draft,receiptId:`manifest-order-${name}`,owner:'manifest order owner fixture',independentReviewer:'manifest order handover fixture',acknowledged:true,validatorRecoveryVerified:true,ownerHandoverVerified:true,rotationProcedureVerified:true,validatorRecoveryEvidence:'fixture:manifest-order-recovery',ownerHandoverEvidence:'fixture:manifest-order-handover',rotationProcedureEvidence:'fixture:manifest-order-rotation',acknowledgedAt:now.toISOString(),expiresAt:new Date(now.getTime()+3600000).toISOString()};
  const receiptFile=put(path.join(directory,'completed-owner-fixture.json'),receipt);
  const reviewRoot=path.join(root,'reviews'),reviewEnv={YNX_OWNER_HANDOVER_INVENTORY:inventoryFile,YNX_OWNER_HANDOVER_RECEIPT:receiptFile,YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:manifest,YNX_PRODUCTION_CUSTODY_REVIEW_DIR:reviewRoot,YNX_PRODUCTION_CUSTODY_REVIEW_ID:name};
  const review=(id,changes={},ok=true,reason)=>run('scripts/ops/write-production-custody-review-packet.mjs',[],{...reviewEnv,...changes,YNX_PRODUCTION_CUSTODY_REVIEW_ID:id},ok,reason);
  review(name);
  const reviewDir=path.join(reviewRoot,name),reviewFile=path.join(reviewDir,'review.template.json'),result=JSON.parse(fs.readFileSync(reviewFile));
  assert.deepEqual(result.records,originalRecords.map(r=>({role:r.role,consensusAddress:r.publicIdentity,nodeId:r.secondaryPublicIdentity})));
  assert.equal(result.validatorManifestSha256,sha256(bytes));assert.equal(result.reviewed,false);assert.equal(result.reviewer,'');
  for(const flag of ['validatorKeyRecoveryVerified','ownerHandoverVerified','rotationProcedureVerified'])assert.equal(result[flag],false);
  run('scripts/verify/validate-production-custody-review.mjs',[reviewFile,commit,sha256(bytes)],{},false);
  assert.deepEqual(fs.readFileSync(path.join(reviewDir,'owner-handover-inventory.json')),fs.readFileSync(inventoryFile));
  assert.deepEqual(fs.readFileSync(path.join(reviewDir,'owner-handover-receipt.json')),fs.readFileSync(receiptFile));
  if(name==='go-role-sorted'){
    // Every original field is protected by the whole raw-manifest pin; even
    // changes outside the receipt's identity projection cannot pass by role.
    const changes={validatorAddress:'ynx_validator_other',role:'foreign',privateP2PHost:'10.77.43.1',p2pPort:27657,nodeId:'f'.repeat(40),consensusKeyType:'other',consensusPubKey:Buffer.alloc(32,9).toString('base64'),consensusAddress:'F'.repeat(40)};
    for(const [field,value]of Object.entries(changes)){
      const altered=structuredClone({...original,validators:rows});altered.validators[0][field]=value;const file=put(path.join(root,`changed-${field}.json`),altered),id=`changed-${field}`;
      review(id,{YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:file},false,/original validator manifest differs from the validated owner inventory/);assert.equal(fs.existsSync(path.join(reviewRoot,id)),false);
    }
    const rejectRebound=(id,alter,reason)=>{
      const altered=structuredClone({...original,validators:rows});alter(altered.validators);
      const file=put(path.join(root,`${id}.json`),altered),changed=structuredClone(inventory);
      changed.sources.validatorManifestSha256=sha256(fs.readFileSync(file));changed.inventoryDigest=`sha256:${sha256(JSON.stringify(inventoryCore(changed))+'\n')}`;
      const inv=put(path.join(root,`${id}-inventory.json`),changed),rc=put(path.join(root,`${id}-receipt.json`),{...receipt,inventoryDigest:changed.inventoryDigest,inventoryFileSha256:sha256(fs.readFileSync(inv))});
      review(id,{YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:file,YNX_OWNER_HANDOVER_INVENTORY:inv,YNX_OWNER_HANDOVER_RECEIPT:rc},false,reason);assert.equal(fs.existsSync(path.join(reviewRoot,id)),false);
    };
    rejectRebound('duplicate-role',r=>{r[1].role=r[0].role;},/four unique supported validator roles required/);
    rejectRebound('foreign-role',r=>{r[1].role='foreign';},/four unique supported validator roles required/);
    rejectRebound('changed-node',r=>{r[1].nodeId='f'.repeat(40);},/identity differs from owner evidence/);
    rejectRebound('changed-address',r=>{r[1].consensusAddress='F'.repeat(40);},/identity differs from owner evidence/);
    rejectRebound('invalid-ed-key',r=>{r[1].consensusPubKey='not-canonical-ed';},/identity differs from owner evidence/);
    const swapped=structuredClone(inventory);[swapped.records[1],swapped.records[3]]=[swapped.records[3],swapped.records[1]];
    swapped.inventoryDigest=`sha256:${sha256(JSON.stringify(inventoryCore(swapped))+'\n')}`;
    assert.throws(()=>validateInventory(swapped,commit),/single-App custody requires every original validator role exactly once/);
    const before=fs.readFileSync(reviewFile);review(name,{},false,/already exists/);assert.deepEqual(fs.readFileSync(reviewFile),before);
  }
  assert.deepEqual(fs.readFileSync(manifest),bytes);
}
for(const [name,change]of [['duplicate',r=>{r[1].role=r[0].role;}],['foreign',r=>{r[1].role='foreign';}],['missing',r=>r.pop()]]){
  const bad=structuredClone(original);change(bad.validators);const file=put(path.join(root,`owner-${name}.json`),bad);
  owner(`owner-${name}`,file,false,name==='missing'?/validator public manifest identity is invalid/:/four unique supported validator roles required/);
  assert.equal(fs.existsSync(path.join(ownerEnv.YNX_OWNER_HANDOVER_OUTPUT_DIR,`owner-${name}`)),false);
}
console.log('VALIDATOR_MANIFEST_ROLE_ORDER_PASS: original/Go-sorted/reverse public bytes accepted by both normal writers; fixed owner/review order, full raw pin, duplicate/foreign/identity/false/UNKNOWN refusals preserved; no authority');
NODE

echo "owner-handover-check passed: four validators, five service signers, runtime/test identity boundaries, inventory digest, mode-0600 receipt, non-overwrite, tamper/stale/self-review/duplicate/unknown rejection, and publicBFTReady=false"

#!/usr/bin/env bash
set -Eeuo pipefail
phase=setup
trap 'check_status=$?; printf "PRODUCTION_CUSTODY_CHECK_FAILED phase=%s line=%s status=%s\n" "$phase" "$LINENO" "$check_status" >&2; exit "$check_status"' ERR

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
custody="$tmp-owner-custody"
recovery="$tmp-owner-recovery"
trap 'rm -rf "$tmp" "$custody" "$recovery"' EXIT

phase=legacy_fixture_preparation
YNX_SERVICE_SIGNER_CEREMONY_MODE=create \
YNX_SERVICE_SIGNER_CEREMONY_APPROVED=yes \
YNX_SERVICE_SIGNER_CUSTODY_DIR="$custody" \
YNX_SERVICE_SIGNER_RECOVERY_DIR="$recovery" \
bash scripts/ops/init-production-service-signers.sh >/dev/null

commit="$(git rev-parse --short=12 HEAD)"
packet_id="custody-review-self-test"
owner_source="$tmp/owner-source"
node scripts/verify/write-owner-handover-fixture.mjs "$owner_source" "$commit" "$custody/public/service-signers.json" >/dev/null
phase=legacy_review_packet_generation
YNX_PRODUCTION_SERVICE_SIGNER_PUBLIC_MANIFEST="$custody/public/service-signers.json" \
YNX_PRODUCTION_SERVICE_SIGNER_CEREMONY_STATUS="$custody/public/CEREMONY_STATUS.json" \
YNX_OWNER_HANDOVER_INVENTORY="$owner_source/owner-handover-inventory.json" \
YNX_OWNER_HANDOVER_RECEIPT="$owner_source/owner-handover-receipt.json" \
YNX_PRODUCTION_CUSTODY_REVIEW_DIR="$tmp/packets" \
YNX_PRODUCTION_CUSTODY_REVIEW_ID="$packet_id" \
node scripts/ops/write-production-custody-review-packet.mjs >/dev/null

packet="$tmp/packets/$packet_id/review.template.json"
request="$tmp/packets/$packet_id/REVIEW_REQUEST.md"
owner_inventory="$tmp/packets/$packet_id/owner-handover-inventory.json"
owner_receipt="$tmp/packets/$packet_id/owner-handover-receipt.json"
manifest_sha="$(shasum -a 256 "$custody/public/service-signers.json" | awk '{print $1}')"
phase=legacy_review_packet_permissions
stat_platform="$(uname -s)"
for file in "$packet" "$request" "$owner_inventory" "$owner_receipt"; do
  # Never mix GNU filesystem-mode stdout with a BSD-format fallback.
  case "$stat_platform" in
    Linux) file_mode="$(stat -c '%a' -- "$file")" ;;
    Darwin) file_mode="$(stat -f '%Lp' "$file")" ;;
    *) echo "unsupported stat platform for exact packet permissions" >&2; exit 1 ;;
  esac
  [[ "$file_mode" == 600 ]]
done
echo "PRODUCTION_CUSTODY_PACKET_MODE_0600_VERIFIED"
phase=legacy_review_validation
if node scripts/verify/validate-production-custody-review.mjs "$packet" "$commit" "$manifest_sha" >/dev/null 2>&1; then
  echo "unreviewed custody template unexpectedly passed validation" >&2
  exit 1
fi

reviewed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
expires_at="$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)"
node - "$packet" "$reviewed_at" "$expires_at" <<'NODE'
const fs = require("fs");
const [file, reviewedAt, expiresAt] = process.argv.slice(2);
const review = JSON.parse(fs.readFileSync(file));
Object.assign(review, {
  reviewId: "review-self-test-001",
  reviewer: "independent custody fixture",
  reviewed: true,
  validatorKeyRecoveryVerified: true,
  serviceSignerRecoveryVerified: true,
  ownerHandoverVerified: true,
  rotationProcedureVerified: true,
  validatorRecoveryEvidence: "offline:validator-restore-001",
  serviceSignerRecoveryEvidence: "offline:service-restore-001",
  ownerHandoverEvidence: "handover:owner-ack-001",
  rotationProcedureEvidence: "rotation:review-001",
  reviewedAt,
  expiresAt,
});
fs.writeFileSync(file, JSON.stringify(review, null, 2) + "\n", { mode: 0o600 });
NODE

result="$(node scripts/verify/validate-production-custody-review.mjs "$packet" "$commit" "$manifest_sha")"
node -e 'const r=JSON.parse(process.argv[1]); if(r.status!=="passed" || !/^sha256:[0-9a-f]{64}$/.test(r.custodyEvidence) || !/^sha256:[0-9a-f]{64}$/.test(r.ownerHandoverReceiptEvidence) || r.reviewer!=="independent custody fixture" || r.owner!=="owner fixture" || r.ownerHandoverReviewer!=="independent handover fixture") process.exit(1)' "$result"

phase=legacy_rejection_controls
cp "$packet" "$tmp/incomplete.json"
node -e 'const fs=require("fs"),p=process.argv[1],r=JSON.parse(fs.readFileSync(p));r.serviceSignerRecoveryVerified=false;fs.writeFileSync(p,JSON.stringify(r)+"\n",{mode:0o600})' "$tmp/incomplete.json"
if node scripts/verify/validate-production-custody-review.mjs "$tmp/incomplete.json" "$commit" "$manifest_sha" >/dev/null 2>&1; then
  echo "incomplete custody review unexpectedly passed validation" >&2
  exit 1
fi
if node scripts/verify/validate-production-custody-review.mjs "$packet" "$commit" "$(printf '0%.0s' {1..64})" >/dev/null 2>&1; then
  echo "custody review bound to another manifest unexpectedly passed validation" >&2
  exit 1
fi
cp -R "$tmp/packets/$packet_id" "$tmp/tampered-owner"
printf ' ' >>"$tmp/tampered-owner/owner-handover-receipt.json"
if node scripts/verify/validate-production-custody-review.mjs "$tmp/tampered-owner/review.template.json" "$commit" "$manifest_sha" >/dev/null 2>&1; then
  echo "custody review with tampered owner receipt unexpectedly passed" >&2
  exit 1
fi
cp -R "$tmp/packets/$packet_id" "$tmp/colliding-reviewer"
node -e 'const fs=require("fs"),p=process.argv[1],r=JSON.parse(fs.readFileSync(p));r.reviewer="owner fixture";fs.writeFileSync(p,JSON.stringify(r)+"\n",{mode:0o600})' "$tmp/colliding-reviewer/review.template.json"
if node scripts/verify/validate-production-custody-review.mjs "$tmp/colliding-reviewer/review.template.json" "$commit" "$manifest_sha" >/dev/null 2>&1; then
  echo "custody review with owner acting as reviewer unexpectedly passed" >&2
  exit 1
fi
if YNX_PRODUCTION_SERVICE_SIGNER_PUBLIC_MANIFEST="$custody/public/service-signers.json" YNX_PRODUCTION_SERVICE_SIGNER_CEREMONY_STATUS="$custody/public/CEREMONY_STATUS.json" YNX_OWNER_HANDOVER_INVENTORY="$owner_source/owner-handover-inventory.json" YNX_OWNER_HANDOVER_RECEIPT="$owner_source/owner-handover-receipt.json" YNX_PRODUCTION_CUSTODY_REVIEW_DIR="$tmp/packets" YNX_PRODUCTION_CUSTODY_REVIEW_ID="$packet_id" node scripts/ops/write-production-custody-review-packet.mjs >/dev/null 2>&1; then
  echo "custody review generator unexpectedly overwrote an existing packet" >&2
  exit 1
fi

phase=single_app_draft_controls
node --input-type=module - "$tmp" "$commit" "$owner_source" <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {inventoryCore,sha256} from './scripts/verify/lib/owner-handover.mjs';
const [tmp,commit,legacy]=process.argv.slice(2),profile='single-app-gateway/v1';
const legacyPaths=['owner-handover-inventory.json','owner-handover-receipt.json'].map(n=>path.join(legacy,n)),savedLegacy=legacyPaths.map(p=>fs.readFileSync(p));
const originalInventory=JSON.parse(savedLegacy[0]),dir=path.join(tmp,'scoped-review-source');fs.mkdirSync(dir,{mode:0o700});
// Public synthetic source identities only; no ceremony, private key, or service.
const manifest={version:1,purpose:'ynx-production-bft-candidate-public-keys-only',chainId:'ynx_6423-1',validators:originalInventory.records.filter(r=>r.category==='production-validator').map((r,i)=>({role:r.role,validatorAddress:r.publicAlias,consensusKeyType:'tendermint/PubKeyEd25519',consensusPubKey:Buffer.alloc(32,i+1).toString('base64'),consensusAddress:r.publicIdentity,nodeId:r.secondaryPublicIdentity}))};
const manifestPath=path.join(dir,'validators.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest)+'\n',{mode:0o600});const manifestBytes=fs.readFileSync(manifestPath);
const run=(script,args,env,ok=true)=>{const p=spawnSync(process.execPath,[script,...args],{env:{...process.env,...env},encoding:'utf8'});assert.equal(p.status===0,ok,p.stderr);return p;};
run('scripts/ops/write-owner-handover-packet.mjs',[],{YNX_OWNER_HANDOVER_CUSTODY_PROFILE:profile,YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:manifestPath,YNX_OWNER_HANDOVER_OPERATOR_PLAN_SHA256:'3'.repeat(64),YNX_OWNER_HANDOVER_RUNTIME_MANIFEST_SHA256:'4'.repeat(64),YNX_OWNER_HANDOVER_OUTPUT_DIR:dir,YNX_OWNER_HANDOVER_PACKET_ID:'original-owner-draft',YNX_OWNER_HANDOVER_SERVICE_SIGNER_MANIFEST:path.join(dir,'no-service'),YNX_OWNER_HANDOVER_SERVICE_SIGNER_STATUS:path.join(dir,'no-status')});
const inventoryPath=path.join(dir,'original-owner-draft/inventory.json'),draftReceiptPath=path.join(dir,'original-owner-draft/receipt.template.json'),draftReceipt=fs.readFileSync(draftReceiptPath),receipt=JSON.parse(draftReceipt);
const now=new Date(),expiresAt=new Date(now.getTime()+3600000).toISOString();
Object.assign(receipt,{receiptId:'scoped-owner-fixture-001',owner:'scoped owner fixture',independentReviewer:'scoped handover fixture',acknowledged:true,validatorRecoveryVerified:true,ownerHandoverVerified:true,rotationProcedureVerified:true,validatorRecoveryEvidence:'offline:scoped-validator-fixture',ownerHandoverEvidence:'handover:scoped-owner-fixture',rotationProcedureEvidence:'rotation:scoped-validator-fixture',acknowledgedAt:now.toISOString(),expiresAt});
const receiptPath=path.join(dir,'completed-owner-fixture.json');fs.writeFileSync(receiptPath,JSON.stringify(receipt)+'\n',{mode:0o600});
run('scripts/verify/validate-owner-handover-receipt.mjs',[receiptPath,inventoryPath,commit],{});
const env={YNX_OWNER_HANDOVER_INVENTORY:inventoryPath,YNX_OWNER_HANDOVER_RECEIPT:receiptPath,YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:manifestPath,YNX_PRODUCTION_CUSTODY_REVIEW_DIR:path.join(dir,'reviews'),YNX_PRODUCTION_SERVICE_SIGNER_PUBLIC_MANIFEST:path.join(dir,'no-service'),YNX_PRODUCTION_SERVICE_SIGNER_CEREMONY_STATUS:path.join(dir,'no-status')};
const generate=(id,change={},ok=true)=>run('scripts/ops/write-production-custody-review-packet.mjs',[],{...env,...change,YNX_PRODUCTION_CUSTODY_REVIEW_ID:id},ok);
generate('scoped-review-draft');
const packet=path.join(env.YNX_PRODUCTION_CUSTODY_REVIEW_DIR,'scoped-review-draft'),draftPath=path.join(packet,'review.template.json'),draft=JSON.parse(fs.readFileSync(draftPath));
assert.equal(draft.custodyProfile,profile);assert.equal(draft.validatorCount,4);assert.equal(draft.records.length,4);assert.equal(draft.validatorManifestSha256,sha256(manifestBytes));assert.equal(draft.operatorPlanSha256,'3'.repeat(64));assert.equal(draft.runtimeManifestSha256,'4'.repeat(64));
for(const k of ['reviewed','validatorKeyRecoveryVerified','ownerHandoverVerified','rotationProcedureVerified'])assert.equal(draft[k],false);
for(const k of ['publicManifestSha256','sourceCeremonyStatusSha256','signerCount','serviceSignerRecoveryVerified','serviceSignerRecoveryEvidence'])assert.equal(Object.hasOwn(draft,k),false);
assert.equal(draft.reviewer,'');assert.equal(draft.reviewedAt,'');assert.equal(draft.expiresAt,'');
assert.deepEqual(fs.readFileSync(path.join(packet,'owner-handover-inventory.json')),fs.readFileSync(inventoryPath));assert.deepEqual(fs.readFileSync(path.join(packet,'owner-handover-receipt.json')),fs.readFileSync(receiptPath));
const check=(file,ok)=>run('scripts/verify/validate-production-custody-review.mjs',[file,commit,sha256(manifestBytes)],{},ok);check(draftPath,false);
const approved={...draft,reviewId:'scoped-custody-fixture-001',reviewer:'scoped custody fixture',reviewed:true,validatorKeyRecoveryVerified:true,ownerHandoverVerified:true,rotationProcedureVerified:true,reviewedAt:now.toISOString(),expiresAt};
const completed=path.join(packet,'completed-review-fixture.json');fs.writeFileSync(completed,JSON.stringify(approved)+'\n',{mode:0o600});const result=JSON.parse(check(completed,true).stdout);assert.equal(result.custodyProfile,profile);assert.equal(result.operatorPlanSha256,draft.operatorPlanSha256);assert.equal(Object.hasOwn(result,'serviceSignerRecoveryVerified'),false);
const saved=fs.readdirSync(packet).map(n=>[n,fs.readFileSync(path.join(packet,n))]);generate('scoped-review-draft',{},false);saved.forEach(([n,b])=>assert.deepEqual(fs.readFileSync(path.join(packet,n)),b));
const reject=(id,change)=>{generate(id,change,false);assert.equal(fs.existsSync(path.join(env.YNX_PRODUCTION_CUSTODY_REVIEW_DIR,id)),false);};
reject('unacknowledged-owner',{YNX_OWNER_HANDOVER_RECEIPT:draftReceiptPath});reject('missing-original-validator',{YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:''});
const changedManifest=path.join(dir,'changed-validators.json');fs.writeFileSync(changedManifest,Buffer.concat([manifestBytes,Buffer.from(' ')]),{mode:0o600});reject('different-original-bytes',{YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:changedManifest});
reject('env-cannot-scope-legacy',{YNX_OWNER_HANDOVER_INVENTORY:legacyPaths[0],YNX_OWNER_HANDOVER_RECEIPT:legacyPaths[1],YNX_OWNER_HANDOVER_CUSTODY_PROFILE:profile});
// Even a self-consistent changed raw-manifest hash must not substitute a
// different public identity for the original inventory records.
const changed=structuredClone(manifest);changed.validators[1].nodeId='f'.repeat(40);fs.writeFileSync(changedManifest,JSON.stringify(changed),{mode:0o600});
const changedInventory=JSON.parse(fs.readFileSync(inventoryPath));changedInventory.sources.validatorManifestSha256=sha256(fs.readFileSync(changedManifest));changedInventory.inventoryDigest='sha256:'+sha256(JSON.stringify(inventoryCore(changedInventory))+'\n');
const changedInventoryPath=path.join(dir,'changed-inventory.json');fs.writeFileSync(changedInventoryPath,JSON.stringify(changedInventory)+'\n',{mode:0o600});
const changedReceipt={...receipt,inventoryDigest:changedInventory.inventoryDigest,inventoryFileSha256:sha256(fs.readFileSync(changedInventoryPath))},changedReceiptPath=path.join(dir,'changed-receipt.json');fs.writeFileSync(changedReceiptPath,JSON.stringify(changedReceipt)+'\n',{mode:0o600});
reject('substituted-validator',{YNX_OWNER_HANDOVER_VALIDATOR_MANIFEST:changedManifest,YNX_OWNER_HANDOVER_INVENTORY:changedInventoryPath,YNX_OWNER_HANDOVER_RECEIPT:changedReceiptPath});
const symlink=path.join(env.YNX_PRODUCTION_CUSTODY_REVIEW_DIR,'unknown-review-draft'),absent=path.join(dir,'absent-review');fs.symlinkSync(absent,symlink);generate('unknown-review-draft',{},false);assert.equal(fs.lstatSync(symlink).isSymbolicLink(),true);assert.equal(fs.existsSync(absent),false);
for(const name of fs.readdirSync(packet))assert.equal(fs.statSync(path.join(packet,name)).mode&0o777,0o600);
legacyPaths.forEach((p,i)=>assert.deepEqual(fs.readFileSync(p),savedLegacy[i]));assert.deepEqual(fs.readFileSync(manifestPath),manifestBytes);assert.deepEqual(fs.readFileSync(draftReceiptPath),draftReceipt);
console.log('SINGLE_APP_CUSTODY_DRAFT_FALSE: validated original owner records, exact validator bytes/identities, no service inputs, no approval or overwrite');
NODE

echo "production-custody-review-check passed: owner receipt/inventory are revalidated, signer/hash/evidence binding and reviewer separation are enforced, packet remains default-false and non-overwriting, and tampering is rejected"

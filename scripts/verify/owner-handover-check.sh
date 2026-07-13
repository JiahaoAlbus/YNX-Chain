#!/usr/bin/env bash
set -Eeuo pipefail

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

write_packet owner-handover-self-test >"$tmp/write.log"
packet="$tmp/packets/owner-handover-self-test"
inventory="$packet/inventory.json"
receipt="$packet/receipt.template.json"
request="$packet/HANDOVER_REQUEST.md"
for file in "$inventory" "$receipt" "$request"; do
  [[ "$(stat -f %Lp "$file" 2>/dev/null || stat -c %a "$file")" == 600 ]]
done
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

echo "owner-handover-check passed: four validators, five service signers, runtime/test identity boundaries, inventory digest, mode-0600 receipt, non-overwrite, tamper/stale/self-review/duplicate/unknown rejection, and publicBFTReady=false"

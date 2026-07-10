#!/usr/bin/env bash
set -euo pipefail

source ./scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

check_native_rejection() {
  local payload="$1"
  local label="$2"
  local response
  response=$(curl -fsS -X POST "$YNX_REST_URL/governance/requests" -H 'content-type: application/json' -d "$payload")
  printf '%s' "$response" | LABEL="$label" node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (data.classification !== "ILLEGAL_OR_ABUSIVE" || data.status !== "rejected" || data.nativeYnxtProtected !== true || !data.ruleIds?.includes("native-ynxt-no-direct-freeze")) {
  console.error(`expected ${process.env.LABEL} to reject with native YNXT protection, got ${JSON.stringify(data)}`);
  process.exit(1);
}
'
}

check_native_rejection '{"requester":"native_freeze_check","subject":"ynx_native_subject","action":"freeze native YNXT","assetType":"YNXT","scope":"single account","description":"directly freeze user native YNXT","evidence":["case:native-freeze"]}' "native freeze request"
check_native_rejection '{"requester":"native_freeze_check","subject":"ynx_native_subject","action":"direct transfer user native YNXT","assetType":"native","scope":"single account","description":"transfer user native YNXT without user signature","evidence":["case:native-transfer"]}' "native direct transfer request"
check_native_rejection '{"requester":"native_freeze_check","subject":"ynx_native_subject","action":"seize native YNXT","assetType":"native_ynxt","scope":"single account","description":"confiscate user native YNXT by request","evidence":["case:native-seize"]}' "native seize request"
check_native_rejection '{"requester":"native_freeze_check","subject":"ynx_native_subject","action":"blacklist native YNXT account","assetType":"YNXT","scope":"single account","description":"blacklist native YNXT balance by protocol request","evidence":["case:native-blacklist"]}' "native blacklist request"

rejected_label=$(curl -sS -X POST "$YNX_REST_URL/trust/labels" -H 'content-type: application/json' -d '{"subject":"ynx_native_subject","label":"freeze-native","riskWeightBps":9000,"source":"native-freeze-check","evidenceHash":"sha256:native-freeze-check","assetEffect":"freeze_native_ynxt"}' -w '\n%{http_code}')
status_code=$(printf '%s' "$rejected_label" | tail -n 1)
[[ "$status_code" == "400" ]] || { echo "expected Trust label assetEffect freeze_native_ynxt to fail with HTTP 400, got $status_code"; exit 1; }

node <<'NODE'
const fs = require("fs");
const path = require("path");

const roots = ["cmd", "internal"];
const goFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".go") && !entry.name.endsWith("_test.go")) {
      goFiles.push(full);
    }
  }
}
for (const root of roots) walk(root);

const dangerousCodePatterns = [
  /\bfunc\s+\w*(Freeze|Seize|Confiscat|Blacklist)\w*\s*\(/,
  /\btype\s+\w*(Freeze|Seize|Confiscat|Blacklist)\w*\s+(struct|map|\[)/,
  /\bvar\s+\w*(Freeze|Seize|Confiscat|Blacklist)\w*\s*=/,
  /\b(frozen|blacklisted|seized|confiscated)(Accounts|Balances|Addresses)\b/,
  /\bNativeYNXT\w*(Freeze|Seize|Confiscat|Blacklist)\w*\b/,
  /\b(Freeze|Seize|Confiscat|Blacklist)\w*NativeYNXT\b/,
];
const allowedStringContexts = [
  "RequestValidityRule",
  "classifyGovernanceRequest",
  "classifyTrackingPolicyReview",
  "trustRiskSummary",
  "EvidencePacket",
  "ExportNotes",
  "ReviewerNotes",
  "errors.New",
  "fmt.Sprintf",
];

const findings = [];
for (const file of goFiles) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    if (!dangerousCodePatterns.some((pattern) => pattern.test(line))) continue;
    if (allowedStringContexts.some((allowed) => line.includes(allowed))) continue;
    findings.push(`${file}:${index + 1}: ${trimmed}`);
  }
}

if (findings.length > 0) {
  console.error("native YNXT hidden freeze static scan failed:");
  for (const finding of findings) console.error(finding);
  process.exit(1);
}
NODE

report=$(curl -fsS "$YNX_REST_URL/governance/transparency")
printf '%s' "$report" | node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (data.rejectedCount < 4 || !Array.isArray(data.entries) || data.entries.length < 4) {
  console.error(`expected native YNXT rejection transparency entries, got ${JSON.stringify(data)}`);
  process.exit(1);
}
'

echo "native-ynxt-no-hidden-freeze-check passed: native YNXT freeze/seize/confiscate/blacklist requests reject, Trust labels stay advisory-only, and runtime code has no hidden freeze hooks"

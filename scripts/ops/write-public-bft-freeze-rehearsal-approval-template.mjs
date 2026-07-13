#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const release = `ynx-bft-gateway-${commit}`;
const transactionId = process.env.PUBLIC_BFT_FREEZE_REHEARSAL_TRANSACTION_ID || `freeze-rehearsal-${commit}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(transactionId)) throw new Error("invalid PUBLIC_BFT_FREEZE_REHEARSAL_TRANSACTION_ID");

const outputRoot = path.resolve(repoRoot, process.env.PUBLIC_BFT_FREEZE_REHEARSAL_APPROVAL_DIR || "tmp/public-bft-freeze-rehearsal-approval", transactionId);
fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
fs.chmodSync(outputRoot, 0o700);
const approvalPath = path.join(outputRoot, "approval.template.json");
const requestPath = path.join(outputRoot, "APPROVAL_REQUEST.md");
if (fs.existsSync(approvalPath) || fs.existsSync(requestPath)) throw new Error(`approval packet already exists: ${outputRoot}`);

const approval = {
  schemaVersion: 1,
  action: "ynx-public-bft-freeze-rehearsal",
  approvalId: `pending-${transactionId}`,
  approver: "",
  custodyReviewer: "",
  custodyEvidence: "",
  approved: false,
  commit,
  release,
  transactionId,
  scopedBackupAuthorized: false,
  temporaryMutationFreezeAuthorized: false,
  automaticUnfreezeRequired: true,
  validatorKeyRecoveryVerified: false,
  serviceSignerRecoveryVerified: false,
  ownerHandoverVerified: false,
  rotationProcedureVerified: false,
  serviceSignerManifestSha256: "",
  authoritativePauseAuthorized: false,
  publicIngressChangeAuthorized: false,
  publicCutoverAuthorized: false,
  maxFreezeSeconds: 60,
  expiresAt: "",
};
fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(approvalPath, 0o600);

const shellQuote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;

const request = `# Public BFT Freeze Rehearsal Approval Request

This packet does not authorize any remote action. Review and edit the mode-0600 JSON only when a bounded live rehearsal is intended.

- Commit: \`${commit}\`
- BFT release: \`${release}\`
- Transaction: \`${transactionId}\`
- Allowed sequence: \`preflight -> backup -> freeze_mutations -> unfreeze_mutations -> verify_recovery\`
- Maximum freeze window: \`60 seconds\`
- Independent custody reviewer: required and must differ from the transaction approver
- Validator-key recovery: must be verified
- Faucet / AI / Pay / Trust / Resource signer recovery: must be verified
- Owner handover and rotation procedure: must be verified
- Authoritative pause: forbidden
- Candidate deployment: forbidden
- Public ingress change: forbidden
- Public cutover: forbidden

Approval requires an identified approver, a different identified custody reviewer, the exact reviewed custody file hash and service-signer manifest hash, \`approved=true\`, explicit recovery/handover/rotation attestations, scoped-backup and temporary-freeze consent, and an expiry no more than two hours in the future. The validator reads \`PUBLIC_BFT_CUSTODY_REVIEW_FILE\` and rejects a missing/tampered review, reviewer/hash/manifest mismatch, self-review, incomplete custody recovery, or any approval that permits pause, ingress change, or cutover.

Validation and execution:

\`node scripts/verify/validate-public-bft-freeze-rehearsal-approval.mjs ${shellQuote(approvalPath)} ${commit} ${release} ${transactionId} "$PUBLIC_BFT_CUSTODY_REVIEW_FILE"\`

\`PUBLIC_BFT_FREEZE_REHEARSAL_MODE=execute PUBLIC_BFT_FREEZE_REHEARSAL_APPROVED=yes PUBLIC_BFT_FREEZE_REHEARSAL_APPROVAL_FILE=${shellQuote(approvalPath)} PUBLIC_BFT_FREEZE_REHEARSAL_TRANSACTION_ID=${transactionId} bash scripts/ops/public-bft-freeze-rehearsal-transaction.sh\`
`;
fs.writeFileSync(requestPath, request, { mode: 0o600 });
fs.chmodSync(requestPath, 0o600);

console.log(`freeze rehearsal approval template: ${approvalPath}`);
console.log(`freeze rehearsal approval request: ${requestPath}`);
console.log("packet is unapproved and non-mutating; pause, ingress change, and public cutover remain forbidden");

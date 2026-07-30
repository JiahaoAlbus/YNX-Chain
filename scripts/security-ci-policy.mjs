#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const forbidden = [
  ["static cluster credential reference", /KUBECONFIG_[A-Z_]+/],
  ["direct Kubernetes mutation", /kubectl\s+(?:apply|delete|patch|replace|rollout\s+undo)\b/i],
  ["cloud cluster credential mutation", /(?:aws\s+eks\s+update-kubeconfig|gcloud\s+container\s+clusters\s+get-credentials)\b/i],
  ["production secret context", /\$\{\{\s*secrets\.[^}]+\}\}/i],
  ["OIDC write permission without deployment contract", /id-token:\s*write\b/i],
];

const required = [
  ["pull request gate for authoritative main", /pull_request:\s*\n\s+branches:\s*\n\s+-\s+main\b/],
  ["push gate for final branch", /push:\s*\n\s+branches:\s*\n\s+-\s+codex\/final-security-platform\b/],
  ["policy required-check job name", /name:\s*Policy, tests, supply chain, and manifests\b/],
  ["operator-control required-check job name", /name:\s*Deployment remains operator-controlled\b/],
];

export function auditWorkflow(workflow) {
  const failures = forbidden
    .filter(([, pattern]) => pattern.test(workflow))
    .map(([label]) => label);

  if (/^\s+paths(?:-ignore)?:\s*$/m.test(workflow)) {
    failures.push("required workflow uses path filters and can leave protected-branch checks permanently pending");
  }

  for (const [label, pattern] of required) {
    if (!pattern.test(workflow)) failures.push(`missing ${label}`);
  }

  return failures;
}

function main() {
  const workflow = readFileSync(resolve(root, ".github/workflows/security-platform-deploy.yml"), "utf8");
  const failures = auditWorkflow(workflow);
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("PASS required workflow runs for every product-branch push and authoritative-main pull request and remains validation-only\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

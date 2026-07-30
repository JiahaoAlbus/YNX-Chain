import assert from "node:assert/strict";
import test from "node:test";

import { auditWorkflow } from "./security-ci-policy.mjs";

const validWorkflow = `name: Security Platform Gates
on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - codex/final-security-platform
jobs:
  verify:
    name: Policy, tests, supply chain, and manifests
    steps:
      - run: npm run security:verify
  operator-control:
    name: Deployment remains operator-controlled
    steps:
      - run: node scripts/security-ci-policy.mjs
`;

test("accepts an always-on validation-only final-branch workflow", () => {
  assert.deepEqual(auditWorkflow(validWorkflow), []);
});

test("rejects path filters that can strand required checks", () => {
  const failures = auditWorkflow(validWorkflow.replace("  pull_request:\n    branches:", "  pull_request:\n    paths:\n      - release/**\n    branches:"));
  assert.match(failures.join("\n"), /path filters/);
});

test("rejects direct cluster mutation and production secret contexts", () => {
  const failures = auditWorkflow(`${validWorkflow}\n# kubectl apply -f infra/k8s\n# \${{ secrets.PRODUCTION_TOKEN }}\n`);
  assert.match(failures.join("\n"), /direct Kubernetes mutation/);
  assert.match(failures.join("\n"), /production secret context/);
});

test("rejects renamed or missing required check contexts", () => {
  const failures = auditWorkflow(validWorkflow.replace("Deployment remains operator-controlled", "Optional operator check"));
  assert.match(failures.join("\n"), /missing operator-control required-check job name/);
});

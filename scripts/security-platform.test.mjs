import test from "node:test";
import assert from "node:assert/strict";
import { verifyArtifactRegistry, verifyCapacityEvidence, verifyCompletionAudit, verifyExerciseMatrix, verifyKpiFramework, verifyProductRelease, verifyProviderInventory, verifySecretInventory, verifyTruthRecord } from "./security-platform.mjs";

const policy = {
  requiredTruthStates: ["implementedLocal", "deployedPublic"],
  artifactKinds: ["container"],
  signingClasses: ["test-signed"],
  secretClasses: ["deploy"],
};

test("a true release state fails closed without evidence", () => {
  const errors = verifyTruthRecord(policy, {
    sourceCommit: "a".repeat(40),
    states: { implementedLocal: true, deployedPublic: false },
    evidence: {},
  });
  assert.deepEqual(errors, ["truth state implementedLocal=true requires evidence"]);
});

test("false release states remain honest without evidence", () => {
  const errors = verifyTruthRecord(policy, {
    sourceCommit: "a".repeat(40),
    states: { implementedLocal: false, deployedPublic: false },
    evidence: {},
  });
  assert.deepEqual(errors, []);
});

test("artifact records require release and verification fields", () => {
  const errors = verifyArtifactRegistry(policy, { artifacts: [{ id: "gateway", kind: "container" }] });
  assert.ok(errors.some((error) => error.includes("invalid sourceCommit")));
  assert.ok(errors.some((error) => error.includes("missing sbom")));
  assert.ok(errors.some((error) => error.includes("invalid signingClass")));
});

test("signed artifact records require detached signature inputs", () => {
  const errors = verifyArtifactRegistry(policy, { artifacts: [{
    id: "signed-gateway", kind: "container", sourceCommit: "a".repeat(40), sha256: "b".repeat(64), bytes: 1,
    signingClass: "test-signed", buildRun: "run", sbom: "sbom", minimumOs: "linux", installEvidence: "evidence",
    revocation: "runbook", expiry: "2026-08-01T00:00:00Z",
  }] });
  assert.ok(errors.some((error) => error.includes("signed artifact missing manifest")));
  assert.ok(errors.some((error) => error.includes("signed artifact missing signature")));
  assert.ok(errors.some((error) => error.includes("signed artifact missing publicKey")));
});

test("secret inventory rejects value-bearing fields", () => {
  const errors = verifySecretInventory(policy, {
    secrets: [{
      id: "deploy-key",
      class: "deploy",
      owner: "release engineering",
      managerReference: "secret-manager://deploy/key",
      expiresAt: "2026-08-01T00:00:00Z",
      rotationRunbook: "OPERATIONS.md#rotation",
      lastRotationEvidence: "evidence/rotation.json",
      secretValue: "must-not-appear",
    }],
  });
  assert.ok(errors.some((error) => error.includes("forbidden value-bearing field")));
});

test("release records cannot select revoked artifacts", () => {
  const errors = verifyProductRelease({
    sourceCommit: "a".repeat(40), artifacts: ["old"], productionSigned: false, deployedPublic: false,
  }, { artifacts: [{ id: "old", sourceCommit: "a".repeat(40), revokedAt: "2026-07-22T00:00:00Z", publicReleaseEligible: false }] });
  assert.deepEqual(errors, ["release references revoked artifact old"]);
});

test("production release claims require production signatures and release time", () => {
  const errors = verifyProductRelease({
    sourceCommit: "a".repeat(40), artifacts: ["candidate"], productionSigned: true, deployedPublic: true, releasedAt: null,
  }, { artifacts: [{ id: "candidate", sourceCommit: "a".repeat(40), signingClass: "test-signed", publicReleaseEligible: false }] });
  assert.ok(errors.includes("productionSigned=true requires only production-signed artifacts"));
  assert.ok(errors.includes("deployedPublic=true requires releasedAt"));
});

test("completion audit cannot mark partial work without evidence and gaps", () => {
  const requirements = Array.from({ length: 22 }, (_, index) => ({ id: index + 1, requirement: `requirement ${index + 1}`, status: "missing", missingEvidence: ["proof"] }));
  requirements[0] = { id: 1, requirement: "recovery", status: "partial", evidence: [] };
  const errors = verifyCompletionAudit({ requirements });
  assert.ok(errors.includes("completion audit 1: partial requires evidence"));
  assert.ok(errors.includes("completion audit 1: partial requires missingEvidence"));
});

test("exercise matrix requires every named final drill", () => {
  const errors = verifyExerciseMatrix({ exercises: [{ id: "artifact-tamper", status: "passed-local", evidence: ["test"] }] });
  assert.ok(errors.includes("exercise matrix missing secret-rotation"));
  assert.ok(errors.includes("exercise matrix missing public-security-evidence"));
});

test("unmeasured KPIs cannot contain invented current values", () => {
  const metric = { id: "activation", definition: "d", formula: "f", window: "w", source: "s", owner: "o", status: "unmeasured", currentValue: 99 };
  const errors = verifyKpiFramework({ metrics: [metric] });
  assert.ok(errors.includes("KPI activation: unmeasured value must be null"));
  assert.ok(errors.includes("KPI framework missing retention-7d"));
});

test("capacity evidence enforces percentile ordering and local limitation", () => {
  const measurements = Object.fromEntries(["policyGate", "signatureVerify", "encryptedBackupCreate", "encryptedBackupRestore"].map((id) => [id, {
    samples: 1, p50: 3, p95: 2, p99: 1, mean: 2, throughputPerSecond: 1, errors: 0,
  }]));
  const errors = verifyCapacityEvidence({ sourceCommit: "a".repeat(40), coverage: "not public capacity evidence", measurements });
  assert.ok(errors.includes("capacity policyGate: percentile ordering invalid"));
});

test("provider inventory rejects credentials and missing governance fields", () => {
  const errors = verifyProviderInventory({ providers: [{ id: "registry", name: "Registry", credential: "must-not-exist" }] });
  assert.ok(errors.includes("provider registry: missing authority"));
  assert.ok(errors.includes("provider registry: inventory must not contain credential values"));
});

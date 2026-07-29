import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPublicArtifactEligible,
  createEphemeralTestSigner,
  cycloneDxFromLock,
  provenanceFor,
  signManifest,
  verifyManifestSignature,
} from "./security-artifact.mjs";

test("CycloneDX output is deterministic and sorted", () => {
  const commit = "a".repeat(40);
  const sbom = cycloneDxFromLock({ packages: {
    "node_modules/z": { name: "z", version: "1.0.0" },
    "node_modules/a": { version: "2.0.0" },
  } }, commit);
  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.deepEqual(sbom.components.map((item) => item.name), ["a", "z"]);
  assert.equal(sbom.metadata.properties[0].value, commit);
});

test("provenance refuses to imply signing or public release", () => {
  const provenance = provenanceFor({
    sourceCommit: "b".repeat(40),
    artifactName: "bundle.tar",
    digest: "c".repeat(64),
    bytes: 10,
    sbomName: "bundle.cdx.json",
    sbomDigest: "d".repeat(64),
    lockHash: "e".repeat(64),
    buildScriptHash: "f".repeat(64),
    buildRun: "local:test",
  });
  assert.equal(provenance.predicate.ynxRelease.signingClass, "unsigned-local");
  assert.equal(provenance.predicate.ynxRelease.publicReleaseEligible, false);
  assert.equal(provenance.predicate.buildDefinition.externalParameters.dependencyLockHash, "e".repeat(64));
});

test("in-memory Ed25519 test signature verifies without persisted signing material", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-artifact-sign-"));
  const manifestPath = join(directory, "manifest.json");
  const signaturePath = join(directory, "manifest.sig.json");
  const now = new Date("2026-07-25T07:00:00.000Z");
  const signer = createEphemeralTestSigner();
  writeFileSync(manifestPath, "{\"sha256\":\"trusted\"}\n");
  const signature = signManifest({ manifestPath, signaturePath, signer, now });
  assert.equal(signature.signingClass, "test-signed");
  assert.equal(signature.privateMaterialPersisted, false);
  assert.equal(signature.publicKeyFingerprint, signer.fingerprint);
  assert.equal(verifyManifestSignature({
    manifestPath,
    signaturePath,
    trustedFingerprints: [signer.fingerprint],
    now,
  }).verified, true);
});

test("manifest tampering and unknown signing identity fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-artifact-tamper-"));
  const manifestPath = join(directory, "manifest.json");
  const signaturePath = join(directory, "manifest.sig.json");
  const now = new Date("2026-07-25T07:00:00.000Z");
  const signer = createEphemeralTestSigner();
  writeFileSync(manifestPath, "{\"sha256\":\"trusted\"}\n");
  signManifest({ manifestPath, signaturePath, signer, now });

  assert.throws(() => verifyManifestSignature({
    manifestPath,
    signaturePath,
    trustedFingerprints: ["sha256:unknown"],
    now,
  }), /unknown artifact signing identity/);

  writeFileSync(manifestPath, "{\"sha256\":\"tampered\"}\n");
  assert.throws(() => verifyManifestSignature({ manifestPath, signaturePath, now }), /digest mismatch/);
});

test("expired and revoked test signatures are rejected", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-artifact-expiry-"));
  const manifestPath = join(directory, "manifest.json");
  const signaturePath = join(directory, "manifest.sig.json");
  const now = new Date("2026-07-25T07:00:00.000Z");
  writeFileSync(manifestPath, "{\"sha256\":\"trusted\"}\n");
  signManifest({ manifestPath, signaturePath, now, validitySeconds: 1 });
  assert.throws(() => verifyManifestSignature({
    manifestPath,
    signaturePath,
    now: new Date("2026-07-25T07:00:02.000Z"),
  }), /expired/);

  const record = JSON.parse(readFileSync(signaturePath, "utf8"));
  record.revokedAt = "2026-07-25T07:00:00.500Z";
  writeFileSync(signaturePath, `${JSON.stringify(record, null, 2)}\n`);
  assert.throws(() => verifyManifestSignature({ manifestPath, signaturePath, now }), /revoked/);
});

test("production signing cannot be performed by the local tool", () => {
  assert.throws(() => signManifest({
    manifestPath: "missing",
    signaturePath: "missing",
    signingClass: "production-signed",
  }), /explicit operator approval/);
  assert.throws(() => signManifest({
    manifestPath: "missing",
    signaturePath: "missing",
    signingClass: "production-signed",
    productionApproved: true,
  }), /external secure signer/);
});

test("test-signed artifact cannot become a public artifact", () => {
  assert.throws(() => assertPublicArtifactEligible({
    publicReleaseEligible: true,
    signing: { class: "test-signed" },
  }, {
    signingClass: "test-signed",
    transparencyRecord: null,
  }), /test-signed public artifact is forbidden/);
});

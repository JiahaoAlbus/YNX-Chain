import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";

const SOURCE_COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAXIMUM_BYTES = 1_048_576;
const FIELDS = ["manifestBytes", "manifestSha256", "schemaVersion", "sourceCommit"];

export function createDeploymentArtifactIntegrity(manifestText, sourceCommit) {
  const manifest = parseManifest(manifestText, sourceCommit);
  return Object.freeze({
    manifestBytes: byteLength(manifestText),
    manifestSha256: digest(manifestText),
    schemaVersion: 1,
    sourceCommit: manifest.sourceCommit,
  });
}

export function verifyDeploymentArtifactIntegrity(manifestText, integrityText, sourceCommit) {
  let integrity;
  try { integrity = JSON.parse(text(integrityText, "integrity sidecar")); } catch { mismatch("integrity sidecar is not JSON"); }
  try { exactFields(integrity, FIELDS, "Deployment artifact integrity"); } catch { mismatch("integrity sidecar schema is invalid"); }
  if (integrityText !== canonicalJSON(integrity) || integrity.schemaVersion !== 1 || !SOURCE_COMMIT.test(integrity.sourceCommit ?? "") || !SHA256.test(integrity.manifestSha256 ?? "") || !Number.isSafeInteger(integrity.manifestBytes) || integrity.manifestBytes < 1 || integrity.manifestBytes > MAXIMUM_BYTES) mismatch("integrity sidecar is not canonical");
  const expected = createDeploymentArtifactIntegrity(manifestText, sourceCommit);
  if (canonicalJSON(integrity) !== canonicalJSON(expected)) mismatch("deployment artifact bytes or source do not match");
  return Object.freeze(integrity);
}

function parseManifest(value, sourceCommit) {
  const raw = text(value, "deployment manifest");
  if (byteLength(raw) > MAXIMUM_BYTES || !SOURCE_COMMIT.test(sourceCommit ?? "")) mismatch("deployment manifest identity is invalid");
  let manifest;
  try { manifest = JSON.parse(raw); } catch { mismatch("deployment manifest is not JSON"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.schemaVersion !== 1 || manifest.chainId !== 6423 || manifest.sourceCommit !== sourceCommit) mismatch("deployment manifest source does not match");
  return manifest;
}

function text(value, label) { if (typeof value !== "string" || value.length < 1) mismatch(`${label} is empty`); return value; }
function byteLength(value) { return utf8ToBytes(value).length; }
function digest(value) { return bytesToHex(sha256(utf8ToBytes(value))); }
function mismatch(message) { throw new WalletAuthError("DEPLOYMENT_ARTIFACT_MISMATCH", message); }

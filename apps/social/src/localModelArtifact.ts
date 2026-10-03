import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const categories = ['gore', 'explicit_violence', 'sexual_content'] as const;
const digestPattern = /^[a-f0-9]{64}$/;
const supportedImages = new Set(['image/jpeg', 'image/png', 'image/webp']);
const permittedLicenses = new Set(['Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause']);
const maximumModelBytes = 128 * 1024 * 1024;

export type LocalModelManifest = Readonly<{
  format: 'ynx-social-local-model-v1';
  modelId: string;
  version: string;
  sourceURL: string;
  sourceRevision: string;
  license: string;
  modelSHA256: string;
  modelBytes: number;
  calibrationSHA256: string;
  categories: readonly string[];
  supportedMimeTypes: readonly string[];
}>;

/** Values must originate in a reviewed source-bound product release, not the
 * download response. There is deliberately no default signer or trust-on-first-use.
 */
export type ExpectedLocalModel = Readonly<{
  modelId: string;
  version: string;
  manifestSHA256: string;
  signingPublicKey: Uint8Array;
}>;

function parseManifest(bytes: Uint8Array): LocalModelManifest {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Invalid local model manifest'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid local model manifest');
  const value = parsed as Record<string, unknown>;
  const manifestCategories = value.categories;
  const keys = ['format', 'modelId', 'version', 'sourceURL', 'sourceRevision', 'license', 'modelSHA256', 'modelBytes',
    'calibrationSHA256', 'categories', 'supportedMimeTypes'];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
    value.format !== 'ynx-social-local-model-v1' ||
    typeof value.modelId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/.test(value.modelId) ||
    typeof value.version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value.version) ||
    typeof value.sourceURL !== 'string' || value.sourceURL.length > 2048 ||
    typeof value.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceRevision) ||
    typeof value.license !== 'string' || !permittedLicenses.has(value.license) ||
    typeof value.modelSHA256 !== 'string' || !digestPattern.test(value.modelSHA256) ||
    typeof value.calibrationSHA256 !== 'string' || !digestPattern.test(value.calibrationSHA256) ||
    typeof value.modelBytes !== 'number' || !Number.isSafeInteger(value.modelBytes) || value.modelBytes < 1 || value.modelBytes > maximumModelBytes ||
    !Array.isArray(manifestCategories) || manifestCategories.length !== categories.length ||
    categories.some((category, index) => manifestCategories[index] !== category) ||
    !Array.isArray(value.supportedMimeTypes) || value.supportedMimeTypes.length < 1 || value.supportedMimeTypes.length > supportedImages.size ||
    value.supportedMimeTypes.some(mime => typeof mime !== 'string' || !supportedImages.has(mime)) ||
    new Set(value.supportedMimeTypes).size !== value.supportedMimeTypes.length) {
    throw new Error('Unsupported local model manifest');
  }
  let source: URL;
  try { source = new URL(value.sourceURL); } catch { throw new Error('Invalid model source URL'); }
  if (source.protocol !== 'https:' || source.username || source.password || source.hash || source.search) {
    throw new Error('Invalid model source URL');
  }
  return Object.freeze({
    format: 'ynx-social-local-model-v1', modelId: value.modelId, version: value.version,
    sourceURL: value.sourceURL, sourceRevision: value.sourceRevision, license: value.license,
    modelSHA256: value.modelSHA256, modelBytes: value.modelBytes, calibrationSHA256: value.calibrationSHA256,
    categories: Object.freeze([...categories]), supportedMimeTypes: Object.freeze([...value.supportedMimeTypes] as string[]),
  });
}

/** Byte verification is NOT classification, suitability, license legal approval,
 * installed runtime isolation or performance acceptance. Never execute downloaded
 * JS/Python/custom operators from this object. No download/network is performed.
 */
export class VerifiedLocalModelArtifact {
  readonly manifest: LocalModelManifest;
  readonly manifestSHA256: string;
  #modelBytes: Uint8Array;
  #calibrationBytes: Uint8Array;

  private constructor(manifest: LocalModelManifest, manifestSHA256: string, model: Uint8Array, calibration: Uint8Array) {
    this.manifest = manifest;
    this.manifestSHA256 = manifestSHA256;
    this.#modelBytes = model;
    this.#calibrationBytes = calibration;
    Object.freeze(this);
  }

  static verify(expected: ExpectedLocalModel, input: Readonly<{
    manifest: Uint8Array; signature: Uint8Array; model: Uint8Array; calibration: Uint8Array;
  }>): VerifiedLocalModelArtifact {
    if (!digestPattern.test(expected.manifestSHA256) || expected.signingPublicKey.byteLength !== 32 ||
      input.signature.byteLength !== 64 || input.manifest.byteLength < 1 || input.manifest.byteLength > 16 * 1024 ||
      input.model.byteLength < 1 || input.model.byteLength > maximumModelBytes ||
      input.calibration.byteLength < 1 || input.calibration.byteLength > 1024 * 1024) {
      throw new Error('Invalid local model artifact limits or trust anchor');
    }
    const manifestBytes = input.manifest.slice();
    if (bytesToHex(sha256(manifestBytes)) !== expected.manifestSHA256 ||
      !ed25519.verify(input.signature, manifestBytes, expected.signingPublicKey, { zip215: false })) {
      throw new Error('Local model manifest authenticity failed');
    }
    const manifest = parseManifest(manifestBytes);
    if (manifest.modelId !== expected.modelId || manifest.version !== expected.version) {
      throw new Error('Local model release binding failed');
    }
    const model = input.model.slice();
    const calibration = input.calibration.slice();
    if (model.byteLength !== manifest.modelBytes || bytesToHex(sha256(model)) !== manifest.modelSHA256 ||
      bytesToHex(sha256(calibration)) !== manifest.calibrationSHA256) {
      throw new Error('Local model artifact integrity failed');
    }
    return new VerifiedLocalModelArtifact(manifest, expected.manifestSHA256, model, calibration);
  }

  /** A fresh copy for the admitted local runtime. Copies must not be persisted
   * or uploaded by consumers; the runtime adapter remains a separate trust gate.
   */
  copyModelBytes(): Uint8Array { return this.#modelBytes.slice(); }
  copyCalibrationBytes(): Uint8Array { return this.#calibrationBytes.slice(); }
}

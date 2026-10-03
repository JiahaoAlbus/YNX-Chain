import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const LOCAL_MODEL_BUNDLE_ROLES = ['gore-sexual-classifier', 'violence-encoder', 'violence-head', 'violence-head-data'] as const;
export type LocalModelBundleRole = typeof LOCAL_MODEL_BUNDLE_ROLES[number];
export type LocalModelBundleAsset = Readonly<{
  role: LocalModelBundleRole; fileName: string; sourceURL: string; sourceRevision: string;
  license: string; sha256: string; bytes: number;
}>;
export type LocalModelBundleManifest = Readonly<{
  format: 'ynx-social-local-model-bundle-v1'; bundleId: string; version: string;
  pipeline: 'xs-siglip2-violence-v1'; assets: readonly LocalModelBundleAsset[];
  calibrationSHA256: string; noticesSHA256: string;
}>;
export type ExpectedLocalModelBundle = Readonly<{
  bundleId: string; version: string; manifestSHA256: string; signingPublicKey: Uint8Array;
}>;
export type LocalModelBundleInput = Readonly<{
  manifestBytes: Uint8Array; signature: Uint8Array;
  assets: Readonly<Record<LocalModelBundleRole, Uint8Array>>;
  calibrationBytes: Uint8Array; noticesBytes: Uint8Array;
  expected: ExpectedLocalModelBundle;
}>;

const files: Record<LocalModelBundleRole, string> = {
  'gore-sexual-classifier': 'image-safety-classifier-xs.onnx',
  'violence-encoder': 'vision_model_q4.onnx',
  'violence-head': 'violence_head.onnx',
  'violence-head-data': 'violence_head.onnx.data',
};
const digestPattern = /^[a-f0-9]{64}$/;
const identityPattern = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/;
const versionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const permittedLicenses = new Set(['Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause']);
const maximumAssetBytes = 128 * 1024 * 1024;
const maximumBundleBytes = 192 * 1024 * 1024;
function digest(bytes: Uint8Array): string { return bytesToHex(sha256(bytes)); }
function exactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Object.keys(value).length === fields.length &&
    fields.every(field => Object.hasOwn(value, field)) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field => 'value' in field);
}
function copyBounded(bytes: Uint8Array, maximum: number, label: string): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maximum) {
    throw new Error('Invalid local bundle ' + label);
  }
  return bytes.slice();
}
function parseManifest(bytes: Uint8Array): LocalModelBundleManifest {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Invalid local bundle manifest'); }
  if (!exactRecord(parsed, ['format', 'bundleId', 'version', 'pipeline', 'assets', 'calibrationSHA256', 'noticesSHA256']) ||
    parsed.format !== 'ynx-social-local-model-bundle-v1' || parsed.pipeline !== 'xs-siglip2-violence-v1' ||
    typeof parsed.bundleId !== 'string' || !identityPattern.test(parsed.bundleId) ||
    typeof parsed.version !== 'string' || !versionPattern.test(parsed.version) ||
    typeof parsed.calibrationSHA256 !== 'string' || !digestPattern.test(parsed.calibrationSHA256) ||
    typeof parsed.noticesSHA256 !== 'string' || !digestPattern.test(parsed.noticesSHA256)) {
    throw new Error('Unsupported local bundle manifest');
  }
  const rawAssets = parsed.assets;
  if (!Array.isArray(rawAssets) || rawAssets.length !== LOCAL_MODEL_BUNDLE_ROLES.length) {
    throw new Error('Invalid local bundle asset set');
  }
  let totalBytes = 0;
  const assets = LOCAL_MODEL_BUNDLE_ROLES.map((role, index): LocalModelBundleAsset => {
    const asset: unknown = rawAssets[index];
    if (!exactRecord(asset, ['role', 'fileName', 'sourceURL', 'sourceRevision', 'license', 'sha256', 'bytes']) ||
      asset.role !== role || asset.fileName !== files[role] ||
      typeof asset.sourceURL !== 'string' || asset.sourceURL.length > 2048 ||
      typeof asset.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(asset.sourceRevision) ||
      typeof asset.license !== 'string' || !permittedLicenses.has(asset.license) ||
      typeof asset.sha256 !== 'string' || !digestPattern.test(asset.sha256) ||
      typeof asset.bytes !== 'number' || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > maximumAssetBytes) {
      throw new Error('Invalid local bundle asset descriptor');
    }
    let source: URL;
    try { source = new URL(asset.sourceURL); } catch { throw new Error('Invalid local bundle source'); }
    if (source.protocol !== 'https:' || source.username || source.password || source.search || source.hash ||
      !source.pathname.includes('/' + asset.sourceRevision + '/') || !source.pathname.endsWith('/' + asset.fileName)) {
      throw new Error('Invalid immutable local bundle source');
    }
    totalBytes += asset.bytes;
    if (totalBytes > maximumBundleBytes) throw new Error('Local bundle size limit exceeded');
    return Object.freeze({ role, fileName: files[role], sourceURL: source.href, sourceRevision: asset.sourceRevision,
      license: asset.license, sha256: asset.sha256, bytes: asset.bytes });
  });
  const head = assets.find(asset => asset.role === 'violence-head');
  const data = assets.find(asset => asset.role === 'violence-head-data');
  if (!head || !data || head.sourceRevision !== data.sourceRevision || head.license !== data.license ||
    head.sourceURL.slice(0, head.sourceURL.lastIndexOf('/')) !== data.sourceURL.slice(0, data.sourceURL.lastIndexOf('/'))) {
    throw new Error('Violence graph/data source mismatch');
  }
  return Object.freeze({ format: 'ynx-social-local-model-bundle-v1', bundleId: parsed.bundleId,
    version: parsed.version, pipeline: 'xs-siglip2-violence-v1', assets: Object.freeze(assets),
    calibrationSHA256: parsed.calibrationSHA256, noticesSHA256: parsed.noticesSHA256 });
}

class LocalModelBundleIntegrity {
  readonly manifest: LocalModelBundleManifest;
  readonly #assets: ReadonlyMap<LocalModelBundleRole, Uint8Array>;
  readonly #calibration: Uint8Array;
  readonly #notices: Uint8Array;
  constructor(manifest: LocalModelBundleManifest, assets: ReadonlyMap<LocalModelBundleRole, Uint8Array>,
    calibration: Uint8Array, notices: Uint8Array) {
    this.manifest = manifest; this.#assets = assets; this.#calibration = calibration; this.#notices = notices;
    Object.freeze(this);
  }
  assetCopy(role: LocalModelBundleRole): Uint8Array {
    const bytes = this.#assets.get(role);
    if (!bytes) throw new Error('Unknown local bundle asset');
    return bytes.slice();
  }
  calibrationCopy(): Uint8Array { return this.#calibration.slice(); }
  noticesCopy(): Uint8Array { return this.#notices.slice(); }
}
export type VerifiedLocalModelBundleIntegrity = LocalModelBundleIntegrity;

// Integrity only: the expected identity, digest and public key must come from a
// trusted release review, never from the downloaded manifest or a first-use UI.
// Calibration bytes/notices are authenticated, not scientifically/legal approved.
// Hash/copy work belongs off the UI thread. No network, executable model loading,
// signing-key collection, default trust, filter activation or persistence here.
export function verifyLocalModelBundleIntegrity(input: LocalModelBundleInput): VerifiedLocalModelBundleIntegrity {
  const expected = input.expected;
  if (typeof expected.bundleId !== 'string' || !identityPattern.test(expected.bundleId) ||
    typeof expected.version !== 'string' || !versionPattern.test(expected.version) ||
    typeof expected.manifestSHA256 !== 'string' || !digestPattern.test(expected.manifestSHA256) ||
    !(expected.signingPublicKey instanceof Uint8Array) || expected.signingPublicKey.byteLength !== 32 ||
    !(input.signature instanceof Uint8Array) || input.signature.byteLength !== 64) {
    throw new Error('Invalid trusted local bundle identity');
  }
  const manifestBytes = copyBounded(input.manifestBytes, 16 * 1024, 'manifest');
  if (digest(manifestBytes) !== expected.manifestSHA256) throw new Error('Local bundle manifest digest mismatch');
  let validSignature = false;
  try { validSignature = ed25519.verify(input.signature.slice(), manifestBytes, expected.signingPublicKey.slice(), { zip215: false }); }
  catch { throw new Error('Invalid local bundle signature'); }
  if (!validSignature) throw new Error('Invalid local bundle signature');
  const manifest = parseManifest(manifestBytes);
  if (manifest.bundleId !== expected.bundleId || manifest.version !== expected.version) {
    throw new Error('Local bundle release identity mismatch');
  }
  if (!exactRecord(input.assets, LOCAL_MODEL_BUNDLE_ROLES)) throw new Error('Invalid local bundle supplied asset set');
  const verified = new Map<LocalModelBundleRole, Uint8Array>();
  for (const asset of manifest.assets) {
    const bytes = copyBounded(input.assets[asset.role], maximumAssetBytes, asset.role);
    if (bytes.byteLength !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error('Local bundle asset digest/size mismatch');
    verified.set(asset.role, bytes);
  }
  const calibration = copyBounded(input.calibrationBytes, 1024 * 1024, 'calibration');
  const notices = copyBounded(input.noticesBytes, 128 * 1024, 'notices');
  if (digest(calibration) !== manifest.calibrationSHA256 || digest(notices) !== manifest.noticesSHA256) {
    throw new Error('Local bundle calibration/notices digest mismatch');
  }
  return new LocalModelBundleIntegrity(manifest, verified, calibration, notices);
}

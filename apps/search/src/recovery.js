import { createHash, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalDigest, validateIndexReceipt } from "../../../packages/web4-permissions/src/index.js";
import { SEARCH_DATA_POLICY, SEARCH_SOURCE_USE_POLICY, assertPublicIndexContent, validateAllowedDataClasses, validateDocumentDataClass } from "./data-policy.js";
import { SearchStore, validateSource } from "./store.js";

export const SEARCH_BACKUP_FORMAT = Object.freeze({
  schemaVersion: "1.0.0",
  product: "YNX Search",
  databaseVersion: 4,
  dataFile: "search-index-v4.json",
  manifestFile: "manifest.json",
  maximumBytes: 1_073_741_824,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, field) {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function pathDigest(path) {
  return sha256(resolve(path));
}

function isPathWithin(parentPath, candidatePath) {
  const relation = relative(resolve(parentPath), resolve(candidatePath));
  return relation === "" || (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`));
}

function snapshotCounts(snapshot) {
  return {
    sources: Object.keys(snapshot.sources).length,
    documents: Object.keys(snapshot.documents).length,
    cases: Object.keys(snapshot.cases).length,
    aiAudit: snapshot.aiAudit.length,
    privacyAudit: snapshot.privacyAudit.length,
    walletChallenges: Object.keys(snapshot.walletChallenges).length,
  };
}

function sourceContractRecord(source) {
  return {
    id: source.id,
    url: source.url,
    origin: source.origin,
    label: source.label,
    sourceType: source.sourceType,
    owner: source.owner,
    jurisdiction: source.jurisdiction,
    authorization: source.authorization,
    robots: source.robots,
    permittedScope: source.permittedScope,
    terms: source.terms,
    dataRights: source.dataRights,
    dataPolicy: source.dataPolicy,
    retentionDays: source.retentionDays,
    remedies: source.remedies,
    languages: source.languages,
    crawlPolicy: source.crawlPolicy,
    enabled: source.enabled,
  };
}

function validateSourceRecord(source, sourceId) {
  requireRecord(source, `source ${sourceId}`);
  if (source.id !== sourceId) throw new Error(`source ${sourceId} id mismatch`);
  if (source.dataPolicy?.version !== SEARCH_DATA_POLICY.version) throw new Error(`source ${sourceId} data policy version mismatch`);
  const allowedClasses = validateAllowedDataClasses(source.dataPolicy.allowedClasses);
  if (!allowedClasses.includes(source.dataPolicy.defaultClass)) throw new Error(`source ${sourceId} default data class is outside policy`);
  if (!source.authorization?.referenceDigest || !source.authorization?.reference) throw new Error(`source ${sourceId} authorization evidence is incomplete`);
  if (sha256(source.authorization.reference) !== source.authorization.referenceDigest) throw new Error(`source ${sourceId} authorization evidence digest mismatch`);
  if (!source.robots?.policy || !source.crawlPolicy || !source.dataRights || !source.terms || !source.remedies) throw new Error(`source ${sourceId} governance is incomplete`);
  if (!Array.isArray(source.permittedScope) || !source.permittedScope.length) throw new Error(`source ${sourceId} permitted scope is incomplete`);
  if (!Array.isArray(source.languages) || !source.languages.length) throw new Error(`source ${sourceId} languages are incomplete`);
  const url = new URL(source.url);
  if (url.origin !== source.origin) throw new Error(`source ${sourceId} origin mismatch`);
  const normalized = validateSource(registrationInput(source));
  if (canonicalDigest("YNX_SEARCH_SOURCE_REGISTRY_V4", sourceContractRecord(source)) !== canonicalDigest("YNX_SEARCH_SOURCE_REGISTRY_V4", normalized)) throw new Error(`source ${sourceId} governance normalization mismatch`);
  return source;
}

function validateDocumentRecord(document, documentId, sources) {
  requireRecord(document, `document ${documentId}`);
  if (document.id !== documentId) throw new Error(`document ${documentId} id mismatch`);
  const source = sources[document.sourceId];
  if (!source) throw new Error(`document ${documentId} source is missing`);
  const url = new URL(document.url);
  if (url.origin !== source.origin) throw new Error(`document ${documentId} origin is outside source`);
  if (sha256(url.href) !== documentId) throw new Error(`document ${documentId} URL digest mismatch`);
  if (typeof document.title !== "string" || typeof document.text !== "string") throw new Error(`document ${documentId} text fields are invalid`);
  if (source.dataRights.storage !== true) throw new Error(`document ${documentId} exceeds source storage rights`);
  if (!source.languages.includes(document.language)) throw new Error(`document ${documentId} language is outside source policy`);
  if (source.terms.permittedUse === "metadata-only" && document.text.length !== 0) throw new Error(`document ${documentId} exceeds metadata-only use`);
  if (source.terms.permittedUse === "index-snippet-link" && document.text.length > SEARCH_SOURCE_USE_POLICY.snippetStorageLimit) throw new Error(`document ${documentId} exceeds snippet storage limit`);
  if (!Number.isFinite(Date.parse(document.fetchedAt)) || !Number.isFinite(Date.parse(document.indexedAt)) || Date.parse(document.indexedAt) < Date.parse(document.fetchedAt)) throw new Error(`document ${documentId} timestamps are invalid`);
  if (document.publishedAt !== null && document.publishedAt !== undefined && !Number.isFinite(Date.parse(document.publishedAt))) throw new Error(`document ${documentId} publication time is invalid`);
  const dataClass = validateDocumentDataClass(source, document.dataClass);
  assertPublicIndexContent(`${document.title}\n${url.href}\n${document.text}`);
  const contentDigest = sha256(String(document.text ?? ""));
  if (contentDigest !== document.contentDigest) throw new Error(`document ${documentId} content digest mismatch`);
  const { digest, ...receiptInput } = requireRecord(document.indexReceipt, `document ${documentId} receipt`);
  const receipt = validateIndexReceipt(receiptInput);
  if (receipt.sourceId !== document.sourceId || receipt.sourceUrl !== url.href || receipt.authorizationRef !== source.authorization.referenceDigest || receipt.contentDigest !== contentDigest || receipt.fetchedAt !== document.fetchedAt || receipt.indexedAt !== document.indexedAt || receipt.status !== "ready") {
    throw new Error(`document ${documentId} receipt binding mismatch`);
  }
  const receiptDigest = canonicalDigest("YNX_INDEX_RECEIPT_V1", receipt);
  if (receiptDigest !== digest) throw new Error(`document ${documentId} receipt digest mismatch`);
  if (dataClass !== document.dataClass) throw new Error(`document ${documentId} data class normalization mismatch`);
  return document;
}

export function validateSearchSnapshot(input) {
  const snapshot = requireRecord(input, "Search snapshot");
  if (snapshot.version !== SEARCH_BACKUP_FORMAT.databaseVersion) throw new Error(`Search database version ${SEARCH_BACKUP_FORMAT.databaseVersion} required`);
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) throw new Error("Search revision is invalid");
  const sources = requireRecord(snapshot.sources, "sources");
  const documents = requireRecord(snapshot.documents, "documents");
  requireRecord(snapshot.cases, "cases");
  requireArray(snapshot.aiAudit, "aiAudit");
  requireArray(snapshot.privacyAudit, "privacyAudit");
  requireRecord(snapshot.walletChallenges, "walletChallenges");
  for (const [sourceId, source] of Object.entries(sources)) validateSourceRecord(source, sourceId);
  for (const [documentId, document] of Object.entries(documents)) validateDocumentRecord(document, documentId, sources);
  for (const [sourceId, source] of Object.entries(sources)) {
    const expected = Object.values(documents).filter(document => document.sourceId === sourceId).length;
    if ((source.documentCount ?? 0) !== expected) throw new Error(`source ${sourceId} document count mismatch`);
  }
  return snapshot;
}

export function publicIndexProjection(snapshotInput) {
  const snapshot = validateSearchSnapshot(snapshotInput);
  const enabledSourceIds = new Set(Object.values(snapshot.sources).filter(source => source.enabled === true).map(source => source.id));
  return stableValue({
    schemaVersion: "1.0.0",
    dataPolicyVersion: SEARCH_DATA_POLICY.version,
    sourceUsePolicyVersion: SEARCH_SOURCE_USE_POLICY.version,
    sources: Object.values(snapshot.sources)
      .filter(source => source.enabled === true)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(source => ({
        id: source.id,
        url: source.url,
        origin: source.origin,
        label: source.label,
        sourceType: source.sourceType,
        owner: source.owner,
        jurisdiction: source.jurisdiction,
        authorizationDigest: source.authorization.referenceDigest,
        authorizationReviewedAt: source.authorization.reviewedAt,
        robotsPolicy: source.robots.policy,
        robotsOverrideDigest: source.robots.overrideReferenceDigest ?? null,
        permittedScope: [...source.permittedScope].sort(),
        terms: source.terms,
        dataRights: source.dataRights,
        dataPolicy: { ...source.dataPolicy, allowedClasses: [...source.dataPolicy.allowedClasses].sort() },
        retentionDays: source.retentionDays,
        remedies: source.remedies,
        languages: [...source.languages].sort(),
        crawlPolicy: source.crawlPolicy,
      })),
    documents: Object.values(snapshot.documents)
      .filter(document => enabledSourceIds.has(document.sourceId))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(document => ({
        id: document.id,
        sourceId: document.sourceId,
        url: document.url,
        title: document.title,
        text: document.text,
        dataClass: document.dataClass,
        language: document.language,
        contentType: document.contentType,
        publishedAt: document.publishedAt,
        fetchedAt: document.fetchedAt,
        contentDigest: document.contentDigest,
      })),
  });
}

export function publicIndexProjectionDigest(snapshot) {
  return canonicalDigest("YNX_SEARCH_PUBLIC_REINDEX_V1", publicIndexProjection(snapshot));
}

async function readRegularFile(path, maximumBytes = SEARCH_BACKUP_FORMAT.maximumBytes) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("regular non-symlink file required");
  if (info.size < 2 || info.size > maximumBytes) throw new Error("file size is outside backup limits");
  return readFile(path);
}

async function ensureDestinationAbsent(path) {
  try {
    await lstat(path);
    throw new Error("restore destination already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function resolveNewDestination(path) {
  const requested = resolve(path);
  await mkdir(dirname(requested), { recursive: true, mode: 0o700 });
  const physicalParent = await realpath(dirname(requested));
  return resolve(physicalParent, basename(requested));
}

async function atomicWriteNew(path, bytes, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await ensureDestinationAbsent(path);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
    await unlink(temporary);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await chmod(path, mode);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function parseSnapshot(bytes) {
  let snapshot;
  try {
    snapshot = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Search backup data is not valid JSON");
  }
  return validateSearchSnapshot(snapshot);
}

function validateManifest(input) {
  const manifest = requireRecord(input, "backup manifest");
  if (manifest.schemaVersion !== SEARCH_BACKUP_FORMAT.schemaVersion || manifest.product !== SEARCH_BACKUP_FORMAT.product) throw new Error("unsupported Search backup manifest");
  if (manifest.databaseVersion !== SEARCH_BACKUP_FORMAT.databaseVersion || manifest.dataPolicyVersion !== SEARCH_DATA_POLICY.version || manifest.sourceUsePolicyVersion !== SEARCH_SOURCE_USE_POLICY.version) throw new Error("unsupported Search backup database policy");
  if (manifest.dataFile !== basename(manifest.dataFile) || manifest.dataFile !== SEARCH_BACKUP_FORMAT.dataFile) throw new Error("unsafe Search backup data path");
  if (!Number.isInteger(manifest.bytes) || manifest.bytes < 2 || manifest.bytes > SEARCH_BACKUP_FORMAT.maximumBytes) throw new Error("invalid Search backup byte count");
  if (!/^[a-f0-9]{64}$/u.test(manifest.sha256) || !/^[a-f0-9]{64}$/u.test(manifest.sourcePathDigest) || !/^[a-f0-9]{64}$/u.test(manifest.publicIndexProjectionDigest)) throw new Error("invalid Search backup digest");
  if (!Number.isInteger(manifest.sourceRevision) || manifest.sourceRevision < 0) throw new Error("invalid Search backup revision");
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("invalid Search backup creation time");
  if (typeof manifest.sourceFile !== "string" || !manifest.sourceFile || manifest.sourceFile !== basename(manifest.sourceFile)) throw new Error("invalid Search backup source file");
  const counts = requireRecord(manifest.counts, "backup counts");
  const countKeys = ["sources", "documents", "cases", "aiAudit", "privacyAudit", "walletChallenges"];
  if (Object.keys(counts).sort().join("\n") !== [...countKeys].sort().join("\n") || countKeys.some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0)) throw new Error("invalid Search backup counts");
  return manifest;
}

export async function createSearchBackup({ sourcePath, bundleDir, clock = () => new Date().toISOString() }) {
  if (!sourcePath || !bundleDir) throw new Error("sourcePath and bundleDir are required");
  const sourceResolved = resolve(sourcePath);
  const bundleResolved = resolve(bundleDir);
  const bytes = await readRegularFile(sourceResolved);
  const sourcePhysical = await realpath(sourceResolved);
  const snapshot = parseSnapshot(bytes);
  await mkdir(dirname(bundleResolved), { recursive: true, mode: 0o700 });
  await mkdir(bundleResolved, { mode: 0o700 });
  const bundlePhysical = await realpath(bundleResolved);
  if (sourcePhysical === bundlePhysical || isPathWithin(bundlePhysical, sourcePhysical)) throw new Error("backup bundle must be separate from the source file");
  await chmod(bundlePhysical, 0o700);
  const dataPath = resolve(bundlePhysical, SEARCH_BACKUP_FORMAT.dataFile);
  const manifestPath = resolve(bundlePhysical, SEARCH_BACKUP_FORMAT.manifestFile);
  await atomicWriteNew(dataPath, bytes);
  const manifest = {
    schemaVersion: SEARCH_BACKUP_FORMAT.schemaVersion,
    product: SEARCH_BACKUP_FORMAT.product,
    createdAt: new Date(clock()).toISOString(),
    databaseVersion: snapshot.version,
    dataPolicyVersion: SEARCH_DATA_POLICY.version,
    sourceUsePolicyVersion: SEARCH_SOURCE_USE_POLICY.version,
    sourceFile: basename(sourcePhysical),
    sourcePathDigest: pathDigest(sourcePhysical),
    sourceRevision: snapshot.revision,
    dataFile: SEARCH_BACKUP_FORMAT.dataFile,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    publicIndexProjectionDigest: publicIndexProjectionDigest(snapshot),
    counts: snapshotCounts(snapshot),
  };
  await atomicWriteNew(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return { bundleDir: bundlePhysical, manifestPath, dataPath, manifest, manifestDigest: canonicalDigest("YNX_SEARCH_BACKUP_MANIFEST_V1", manifest) };
}

export async function verifySearchBackup(manifestPath) {
  const manifestResolved = resolve(manifestPath);
  const manifestBytes = await readRegularFile(manifestResolved, 1_048_576);
  const manifestPhysical = await realpath(manifestResolved);
  let manifest;
  try {
    manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8")));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Search backup manifest is not valid JSON");
    throw error;
  }
  const bundleDir = dirname(manifestPhysical);
  const dataPath = resolve(bundleDir, manifest.dataFile);
  if (dirname(dataPath) !== bundleDir) throw new Error("Search backup data escapes its bundle");
  const bytes = await readRegularFile(dataPath);
  if (bytes.byteLength !== manifest.bytes) throw new Error("Search backup byte count mismatch");
  if (sha256(bytes) !== manifest.sha256) throw new Error("Search backup SHA-256 mismatch");
  const snapshot = parseSnapshot(bytes);
  if (snapshot.version !== manifest.databaseVersion || snapshot.revision !== manifest.sourceRevision) throw new Error("Search backup database metadata mismatch");
  if (JSON.stringify(snapshotCounts(snapshot)) !== JSON.stringify(manifest.counts)) throw new Error("Search backup counts mismatch");
  const projectionDigest = publicIndexProjectionDigest(snapshot);
  if (projectionDigest !== manifest.publicIndexProjectionDigest) throw new Error("Search backup public index projection mismatch");
  return { manifestPath: manifestPhysical, dataPath, manifest, snapshot, bytes, manifestDigest: canonicalDigest("YNX_SEARCH_BACKUP_MANIFEST_V1", manifest) };
}

export async function restoreSearchBackup({ manifestPath, destinationPath }) {
  if (!destinationPath) throw new Error("destinationPath is required");
  const verified = await verifySearchBackup(manifestPath);
  const destinationResolved = await resolveNewDestination(destinationPath);
  if (pathDigest(destinationResolved) === verified.manifest.sourcePathDigest) throw new Error("in-place Search restore is prohibited");
  if (isPathWithin(dirname(verified.manifestPath), destinationResolved)) throw new Error("Search restore destination must be outside the backup bundle");
  await atomicWriteNew(destinationResolved, verified.bytes);
  const restoredBytes = await readRegularFile(destinationResolved);
  if (sha256(restoredBytes) !== verified.manifest.sha256) throw new Error("restored Search database hash mismatch");
  const snapshot = parseSnapshot(restoredBytes);
  if (publicIndexProjectionDigest(snapshot) !== verified.manifest.publicIndexProjectionDigest) throw new Error("restored Search public index projection mismatch");
  return { destinationPath: destinationResolved, bytes: restoredBytes.byteLength, sha256: sha256(restoredBytes), revision: snapshot.revision, publicIndexProjectionDigest: publicIndexProjectionDigest(snapshot) };
}

function registrationInput(source) {
  return {
    id: source.id,
    url: source.url,
    label: source.label,
    sourceType: source.sourceType,
    owner: source.owner,
    jurisdiction: source.jurisdiction,
    authorizationEvidence: source.authorization.reference,
    authorizationReviewedAt: source.authorization.reviewedAt,
    robotsPolicy: source.robots.policy,
    overrideEvidence: source.robots.overrideReference,
    permittedScope: source.permittedScope,
    termsUrl: source.terms.url,
    permittedUse: source.terms.permittedUse,
    storageRight: source.dataRights.storage,
    snippetRight: source.dataRights.snippets,
    aiRetrievalRight: source.dataRights.aiRetrieval,
    retentionDays: source.retentionDays,
    languages: source.languages,
    freshnessSloSeconds: source.crawlPolicy.freshnessSloSeconds,
    maxRequestsPerMinute: source.crawlPolicy.maxRequestsPerMinute,
    backoffSeconds: source.crawlPolicy.backoffSeconds,
    allowedDataClasses: source.dataPolicy.allowedClasses,
    defaultDataClass: source.dataPolicy.defaultClass,
    removalUrl: source.remedies.removalUrl,
    correctionUrl: source.remedies.correctionUrl,
    enabled: source.enabled,
  };
}

export async function reindexSearchBackup({ manifestPath, destinationPath, clock }) {
  if (!destinationPath) throw new Error("destinationPath is required");
  const verified = await verifySearchBackup(manifestPath);
  const destinationResolved = await resolveNewDestination(destinationPath);
  if (pathDigest(destinationResolved) === verified.manifest.sourcePathDigest) throw new Error("in-place Search reindex is prohibited");
  if (isPathWithin(dirname(verified.manifestPath), destinationResolved)) throw new Error("Search reindex destination must be outside the backup bundle");
  await ensureDestinationAbsent(destinationResolved);
  const store = new SearchStore(destinationResolved, { clock: clock ?? (() => verified.manifest.createdAt) });
  const sources = Object.values(verified.snapshot.sources).sort((left, right) => left.id.localeCompare(right.id));
  for (const source of sources) await store.registerSource(registrationInput(source));
  const documents = Object.values(verified.snapshot.documents)
    .filter(document => verified.snapshot.sources[document.sourceId]?.enabled === true)
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const document of documents) {
    await store.indexDocument(document.sourceId, {
      url: document.url,
      title: document.title,
      text: document.text,
      dataClass: document.dataClass,
      language: document.language,
      contentType: document.contentType,
      publishedAt: document.publishedAt,
      fetchedAt: document.fetchedAt,
    });
  }
  const rebuilt = await store.snapshot();
  const rebuiltDigest = publicIndexProjectionDigest(rebuilt);
  if (rebuiltDigest !== verified.manifest.publicIndexProjectionDigest) throw new Error("deterministic Search reindex projection mismatch");
  return { destinationPath: destinationResolved, sourceCount: sources.filter(source => source.enabled === true).length, documentCount: documents.length, publicIndexProjectionDigest: rebuiltDigest };
}

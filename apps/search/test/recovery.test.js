import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { SearchStore } from "../src/store.js";
import {
  SEARCH_BACKUP_FORMAT,
  createSearchBackup,
  publicIndexProjectionDigest,
  reindexSearchBackup,
  restoreSearchBackup,
  verifySearchBackup,
} from "../src/recovery.js";

const NOW = "2026-07-27T12:00:00.000Z";
const execute = promisify(execFile);
const recoveryCli = fileURLToPath(new URL("../scripts/recovery.mjs", import.meta.url));
const sourceInput = {
  url: "https://recovery.example/",
  label: "Recovery Docs",
  sourceType: "ynx-official",
  owner: "YNX Search Recovery",
  jurisdiction: "Global public documentation",
  authorizationEvidence: "reviewed recovery source approval 2026-07-27",
  authorizationReviewedAt: NOW,
  robotsPolicy: "respect",
  permittedScope: ["public recovery documentation"],
  termsUrl: "https://recovery.example/terms",
  permittedUse: "index-fulltext-link",
  storageRight: true,
  snippetRight: true,
  aiRetrievalRight: true,
  retentionDays: 365,
  languages: ["en"],
  freshnessSloSeconds: 3600,
  maxRequestsPerMinute: 30,
  backoffSeconds: 60,
  allowedDataClasses: ["public-docs"],
  defaultDataClass: "public-docs",
  removalUrl: "https://recovery.example/removal",
  correctionUrl: "https://recovery.example/correction",
};

async function recoveryFixture({ includePrivateState = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ynx-search-recovery-"));
  const databasePath = join(root, "live", "index.json");
  const store = new SearchStore(databasePath, { clock: () => NOW });
  const source = await store.registerSource(sourceInput);
  await store.indexDocument(source.id, {
    url: "https://recovery.example/public/recovery",
    title: "Search recovery procedure",
    text: "A reviewed public Search index can be backed up, restored to a separate path, and deterministically reindexed with integrity checks.",
    dataClass: "public-docs",
    language: "en",
    contentType: "text/html",
    publishedAt: NOW,
    fetchedAt: NOW,
  });
  if (includePrivateState) {
    await store.createCase("correction", {
      sourceUrl: "https://recovery.example/public/recovery",
      reason: "Correct the public recovery procedure after review.",
      evidenceUrls: ["https://recovery.example/evidence"],
    });
    await store.auditAi({ requestId: "recovery-audit", status: "cancelled" });
    await store.createWalletChallenge({ nonce: "r".repeat(32), expiresAt: "2026-07-27T12:05:00.000Z" });
  }
  return { root, databasePath, store, source };
}

function permissionBits(info) {
  return info.mode & 0o777;
}

test("v4 backup verifies, restores exact bytes, and reindexes the public projection", async () => {
  const { root, databasePath } = await recoveryFixture({ includePrivateState: true });
  const bundleDir = join(root, "backup", "search-v4");
  const backup = await createSearchBackup({ sourcePath: databasePath, bundleDir, clock: () => NOW });
  const verified = await verifySearchBackup(backup.manifestPath);
  assert.equal(verified.manifest.databaseVersion, 4);
  assert.equal(verified.manifest.dataPolicyVersion, "1.0.0");
  assert.equal(verified.manifest.sourceUsePolicyVersion, "1.0.0");
  assert.deepEqual(verified.manifest.counts, { sources: 1, documents: 1, cases: 1, aiAudit: 1, privacyAudit: 0, walletChallenges: 1 });
  assert.equal(verified.manifest.publicIndexProjectionDigest, publicIndexProjectionDigest(verified.snapshot));

  const restoredPath = join(root, "restored", "index.json");
  const restored = await restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: restoredPath });
  assert.equal(restored.sha256, verified.manifest.sha256);
  assert.deepEqual(await readFile(restoredPath), await readFile(databasePath));
  const restoredStore = new SearchStore(restoredPath, { clock: () => NOW });
  assert.equal((await restoredStore.search("recovery procedure")).total, 1);

  const reindexedPath = join(root, "reindexed", "index.json");
  const reindexed = await reindexSearchBackup({ manifestPath: backup.manifestPath, destinationPath: reindexedPath, clock: () => NOW });
  assert.equal(reindexed.sourceCount, 1);
  assert.equal(reindexed.documentCount, 1);
  assert.equal(reindexed.publicIndexProjectionDigest, verified.manifest.publicIndexProjectionDigest);
  const reindexedSnapshot = await new SearchStore(reindexedPath, { clock: () => NOW }).snapshot();
  assert.equal(Object.keys(reindexedSnapshot.cases).length, 0);
  assert.equal(reindexedSnapshot.aiAudit.length, 0);
  assert.equal(Object.keys(reindexedSnapshot.walletChallenges).length, 0);

  if (process.platform !== "win32") {
    assert.equal(permissionBits(await stat(bundleDir)), 0o700);
    assert.equal(permissionBits(await stat(backup.dataPath)), 0o600);
    assert.equal(permissionBits(await stat(backup.manifestPath)), 0o600);
    assert.equal(permissionBits(await stat(restoredPath)), 0o600);
  }
});

test("recovery preserves source-use limits without widening metadata or snippet rights", async () => {
  const root = await mkdtemp(join(tmpdir(), "ynx-search-rights-recovery-"));
  const databasePath = join(root, "live", "index.json");
  const store = new SearchStore(databasePath, { clock: () => NOW });
  const metadata = await store.registerSource({
    ...sourceInput,
    url: "https://metadata-recovery.example/",
    termsUrl: "https://metadata-recovery.example/terms",
    removalUrl: "https://metadata-recovery.example/removal",
    correctionUrl: "https://metadata-recovery.example/correction",
    owner: "Metadata Recovery Owner",
    authorizationEvidence: "reviewed metadata recovery approval",
    permittedUse: "metadata-only",
    snippetRight: false,
    aiRetrievalRight: false,
  });
  await store.indexDocument(metadata.id, {
    url: "https://metadata-recovery.example/catalogue",
    title: "Recovery metadata catalogue",
    text: "discardedbodyterm is observed for indexing but cannot be retained under metadata-only source terms.",
    language: "en",
  });
  const fulltext = await store.registerSource({
    ...sourceInput,
    url: "https://fulltext-recovery.example/",
    termsUrl: "https://fulltext-recovery.example/terms",
    removalUrl: "https://fulltext-recovery.example/removal",
    correctionUrl: "https://fulltext-recovery.example/correction",
    owner: "Fulltext Recovery Owner",
    authorizationEvidence: "reviewed fulltext recovery approval",
    permittedUse: "index-fulltext-link",
    snippetRight: false,
    aiRetrievalRight: false,
  });
  await store.indexDocument(fulltext.id, {
    url: "https://fulltext-recovery.example/runbook",
    title: "Recovery fulltext runbook",
    text: "Fulltext recovery content remains searchable while display snippets and AI context stay prohibited.",
    language: "en",
  });

  const backup = await createSearchBackup({ sourcePath: databasePath, bundleDir: join(root, "backup"), clock: () => NOW });
  const reindexedPath = join(root, "reindexed", "index.json");
  await reindexSearchBackup({ manifestPath: backup.manifestPath, destinationPath: reindexedPath, clock: () => NOW });
  const rebuilt = new SearchStore(reindexedPath, { clock: () => NOW });
  assert.equal((await rebuilt.search("discardedbodyterm")).total, 0);
  const metadataResult = (await rebuilt.search("Recovery metadata catalogue")).results[0];
  assert.equal(metadataResult.snippet, null);
  assert.equal(metadataResult.sourceUse.permittedUse, "metadata-only");
  const fulltextResult = (await rebuilt.search("Fulltext recovery content")).results[0];
  assert.equal(fulltextResult.snippet, null);
  assert.equal(fulltextResult.sourceUse.permittedUse, "index-fulltext-link");
  assert.equal((await rebuilt.search("Fulltext recovery content", { aiRetrievalOnly: true })).total, 0);
});

test("backup verification rejects tampered bytes, manifest traversal, and receipt drift", async () => {
  const first = await recoveryFixture();
  const firstBackup = await createSearchBackup({ sourcePath: first.databasePath, bundleDir: join(first.root, "backup"), clock: () => NOW });
  await writeFile(firstBackup.dataPath, Buffer.concat([await readFile(firstBackup.dataPath), Buffer.from(" ")]));
  await assert.rejects(verifySearchBackup(firstBackup.manifestPath), /byte count mismatch|SHA-256 mismatch/);

  const second = await recoveryFixture();
  const secondBackup = await createSearchBackup({ sourcePath: second.databasePath, bundleDir: join(second.root, "backup"), clock: () => NOW });
  const traversalManifest = JSON.parse(await readFile(secondBackup.manifestPath, "utf8"));
  traversalManifest.dataFile = "../index.json";
  await writeFile(secondBackup.manifestPath, `${JSON.stringify(traversalManifest, null, 2)}\n`);
  await assert.rejects(verifySearchBackup(secondBackup.manifestPath), /unsafe Search backup data path/);

  const third = await recoveryFixture();
  const raw = JSON.parse(await readFile(third.databasePath, "utf8"));
  const [document] = Object.values(raw.documents);
  document.indexReceipt.digest = "0".repeat(64);
  await writeFile(third.databasePath, `${JSON.stringify(raw, null, 2)}\n`);
  await assert.rejects(createSearchBackup({ sourcePath: third.databasePath, bundleDir: join(third.root, "backup"), clock: () => NOW }), /receipt digest mismatch/);

  const fourth = await recoveryFixture();
  const fourthBackup = await createSearchBackup({ sourcePath: fourth.databasePath, bundleDir: join(fourth.root, "backup"), clock: () => NOW });
  const countManifest = JSON.parse(await readFile(fourthBackup.manifestPath, "utf8"));
  countManifest.counts.documents += 1;
  await writeFile(fourthBackup.manifestPath, `${JSON.stringify(countManifest, null, 2)}\n`);
  await assert.rejects(verifySearchBackup(fourthBackup.manifestPath), /backup counts mismatch/);
});

test("restore and reindex prohibit in-place, in-bundle, and overwrite operations", async () => {
  const { root, databasePath } = await recoveryFixture();
  const backup = await createSearchBackup({ sourcePath: databasePath, bundleDir: join(root, "backup"), clock: () => NOW });
  await assert.rejects(restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: databasePath }), /in-place Search restore is prohibited/);
  await assert.rejects(restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: join(backup.bundleDir, "restored.json") }), /outside the backup bundle/);
  await assert.rejects(restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: join(backup.bundleDir, "..inside.json") }), /outside the backup bundle/);
  await assert.rejects(reindexSearchBackup({ manifestPath: backup.manifestPath, destinationPath: join(backup.bundleDir, "..rebuilt.json"), clock: () => NOW }), /outside the backup bundle/);
  if (process.platform !== "win32") {
    const bundleLink = join(root, "bundle-link");
    await symlink(backup.bundleDir, bundleLink, "dir");
    await assert.rejects(restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: join(bundleLink, "linked-restore.json") }), /outside the backup bundle/);
    const liveLink = join(root, "live-link");
    await symlink(join(root, "live"), liveLink, "dir");
    await assert.rejects(restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: join(liveLink, "index.json") }), /in-place Search restore is prohibited/);
  }
  const existingPath = join(root, "existing.json");
  await writeFile(existingPath, "{}\n");
  await assert.rejects(restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: existingPath }), /restore destination already exists/);
  await assert.rejects(reindexSearchBackup({ manifestPath: backup.manifestPath, destinationPath: existingPath, clock: () => NOW }), /restore destination already exists/);
  await assert.rejects(reindexSearchBackup({ manifestPath: backup.manifestPath, destinationPath: databasePath, clock: () => NOW }), /in-place Search reindex is prohibited/);
});

test("backup rejects pre-v4 databases instead of silently migrating them", async () => {
  const root = await mkdtemp(join(tmpdir(), "ynx-search-legacy-backup-"));
  const databasePath = join(root, "legacy.json");
  await writeFile(databasePath, `${JSON.stringify({ version: 3, revision: 0, sources: {}, documents: {}, cases: {}, aiAudit: [], privacyAudit: [], walletChallenges: {} })}\n`);
  await assert.rejects(createSearchBackup({ sourcePath: databasePath, bundleDir: join(root, "backup"), clock: () => NOW }), /Search database version 4 required/);
});

test("operator recovery CLI executes backup, verify, restore, reindex, and bounded errors", async () => {
  const { root, databasePath } = await recoveryFixture();
  const bundleDir = join(root, "cli-backup");
  const backupRun = await execute(process.execPath, [recoveryCli, "backup", "--source", databasePath, "--bundle", bundleDir]);
  const backup = JSON.parse(backupRun.stdout);
  assert.equal(backup.action, "backup");
  assert.equal(backup.result, "pass");
  assert.equal(backup.databaseVersion, 4);

  const verifyRun = await execute(process.execPath, [recoveryCli, "verify", "--manifest", backup.manifestPath]);
  const verified = JSON.parse(verifyRun.stdout);
  assert.equal(verified.action, "verify");
  assert.equal(verified.sha256, backup.sha256);

  const restoredPath = join(root, "cli-restored", "index.json");
  const restoreRun = await execute(process.execPath, [recoveryCli, "restore", "--manifest", backup.manifestPath, "--destination", restoredPath]);
  const restored = JSON.parse(restoreRun.stdout);
  assert.equal(restored.action, "restore");
  assert.equal(restored.sha256, backup.sha256);

  const reindexedPath = join(root, "cli-reindexed", "index.json");
  const reindexRun = await execute(process.execPath, [recoveryCli, "reindex", "--manifest", backup.manifestPath, "--destination", reindexedPath]);
  const reindexed = JSON.parse(reindexRun.stdout);
  assert.equal(reindexed.action, "reindex");
  assert.equal(reindexed.publicIndexProjectionDigest, backup.publicIndexProjectionDigest);

  await assert.rejects(
    execute(process.execPath, [recoveryCli, "restore", "--manifest", backup.manifestPath, "--destination", restoredPath]),
    error => {
      const failure = JSON.parse(error.stderr);
      assert.equal(failure.result, "failed");
      assert.match(failure.error, /restore destination already exists/);
      assert.doesNotMatch(error.stderr, /at file:|node:internal/u);
      return true;
    },
  );
});

test("backup format is immutable and bounded", () => {
  assert.deepEqual(SEARCH_BACKUP_FORMAT, {
    schemaVersion: "1.0.0",
    product: "YNX Search",
    databaseVersion: 4,
    dataFile: "search-index-v4.json",
    manifestFile: "manifest.json",
    maximumBytes: 1_073_741_824,
  });
  assert.equal(Object.isFrozen(SEARCH_BACKUP_FORMAT), true);
});

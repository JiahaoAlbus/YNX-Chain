import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SearchStore } from "../src/store.js";
import {
  createSearchBackup,
  reindexSearchBackup,
  restoreSearchBackup,
  verifySearchBackup,
} from "../src/recovery.js";

const NOW = "2026-07-27T12:00:00.000Z";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function rejects(operation, pattern) {
  try {
    await operation();
  } catch (error) {
    if (pattern.test(String(error?.message ?? error))) return true;
    throw error;
  }
  throw new Error(`expected recovery rejection matching ${pattern}`);
}

function permissionBits(info) {
  return info.mode & 0o777;
}

const evidencePath = option("--evidence");
const sourceCommit = option("--source-commit");
const root = await mkdtemp(join(tmpdir(), "ynx-search-recovery-drill-"));

try {
  const databasePath = join(root, "live", "index.json");
  const store = new SearchStore(databasePath, { clock: () => NOW });
  const source = await store.registerSource({
    url: "https://recovery-drill.example/",
    label: "Recovery Drill",
    sourceType: "ynx-official",
    owner: "YNX Search Recovery Drill",
    jurisdiction: "Global public documentation",
    authorizationEvidence: "reviewed recovery drill authorization 2026-07-27",
    authorizationReviewedAt: NOW,
    robotsPolicy: "respect",
    permittedScope: ["public recovery drill documentation"],
    termsUrl: "https://recovery-drill.example/terms",
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
    removalUrl: "https://recovery-drill.example/removal",
    correctionUrl: "https://recovery-drill.example/correction",
  });
  await store.indexDocument(source.id, {
    url: "https://recovery-drill.example/public/runbook",
    title: "Search recovery drill runbook",
    text: "The Search recovery drill verifies an exact backup, a separate-path restore, deterministic public reindexing, integrity rejection, and rollback boundaries.",
    dataClass: "public-docs",
    language: "en",
    contentType: "text/html",
    publishedAt: NOW,
    fetchedAt: NOW,
  });

  const backup = await createSearchBackup({ sourcePath: databasePath, bundleDir: join(root, "backup", "search-v4"), clock: () => NOW });
  const verified = await verifySearchBackup(backup.manifestPath);
  const restoredPath = join(root, "restored", "index.json");
  const restored = await restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: restoredPath });
  const reindexed = await reindexSearchBackup({ manifestPath: backup.manifestPath, destinationPath: join(root, "reindexed", "index.json"), clock: () => NOW });

  const inPlaceRestoreRejected = await rejects(
    () => restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: databasePath }),
    /in-place Search restore is prohibited/,
  );
  const overwritePath = join(root, "existing", "index.json");
  await mkdir(dirname(overwritePath), { recursive: true });
  await writeFile(overwritePath, "{}\n");
  const overwriteRejected = await rejects(
    () => restoreSearchBackup({ manifestPath: backup.manifestPath, destinationPath: overwritePath }),
    /restore destination already exists/,
  );

  await writeFile(backup.dataPath, Buffer.concat([await readFile(backup.dataPath), Buffer.from(" ")]));
  const tamperRejected = await rejects(() => verifySearchBackup(backup.manifestPath), /byte count mismatch|SHA-256 mismatch/);

  const permissions = process.platform === "win32"
    ? { enforced: false, reason: "POSIX mode evidence is not applicable on Windows" }
    : {
        enforced: true,
        bundle: permissionBits(await stat(backup.bundleDir)),
        data: permissionBits(await stat(backup.dataPath)),
        manifest: permissionBits(await stat(backup.manifestPath)),
        restored: permissionBits(await stat(restoredPath)),
      };
  if (permissions.enforced && (permissions.bundle !== 0o700 || permissions.data !== 0o600 || permissions.manifest !== 0o600 || permissions.restored !== 0o600)) {
    throw new Error("recovery file permissions are not restrictive");
  }

  const evidence = {
    schemaVersion: "1.0.0",
    product: "YNX Search",
    drill: "source-registry-v4-backup-restore-reindex",
    performedAt: NOW,
    sourceCommit: sourceCommit ?? null,
    databaseVersion: verified.manifest.databaseVersion,
    dataPolicyVersion: verified.manifest.dataPolicyVersion,
    sourceUsePolicyVersion: verified.manifest.sourceUsePolicyVersion,
    sourceRevision: verified.manifest.sourceRevision,
    manifestDigest: verified.manifestDigest,
    dataSha256: verified.manifest.sha256,
    bytes: verified.manifest.bytes,
    counts: verified.manifest.counts,
    restored: {
      sha256: restored.sha256,
      revision: restored.revision,
      exactBytes: restored.sha256 === verified.manifest.sha256,
      publicIndexProjectionDigest: restored.publicIndexProjectionDigest,
    },
    reindexed: {
      sourceCount: reindexed.sourceCount,
      documentCount: reindexed.documentCount,
      publicIndexProjectionDigest: reindexed.publicIndexProjectionDigest,
      projectionMatches: reindexed.publicIndexProjectionDigest === verified.manifest.publicIndexProjectionDigest,
    },
    negativePaths: { inPlaceRestoreRejected, overwriteRejected, tamperRejected },
    permissions,
    result: "pass",
  };

  if (evidencePath) {
    const output = resolve(evidencePath);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}

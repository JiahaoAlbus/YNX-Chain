import {
  createSearchBackup,
  reindexSearchBackup,
  restoreSearchBackup,
  verifySearchBackup,
} from "../src/recovery.js";

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error("recovery options must be --name value pairs");
    const name = key.slice(2);
    if (options[name] !== undefined) throw new Error(`duplicate recovery option --${name}`);
    options[name] = value;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function assertOnly(options, allowed) {
  const unexpected = Object.keys(options).filter(name => !allowed.includes(name));
  if (unexpected.length) throw new Error(`unsupported recovery option --${unexpected[0]}`);
}

function publicVerification(verified) {
  return {
    manifestPath: verified.manifestPath,
    dataPath: verified.dataPath,
    manifestDigest: verified.manifestDigest,
    databaseVersion: verified.manifest.databaseVersion,
    dataPolicyVersion: verified.manifest.dataPolicyVersion,
    sourceUsePolicyVersion: verified.manifest.sourceUsePolicyVersion,
    sourceRevision: verified.manifest.sourceRevision,
    bytes: verified.manifest.bytes,
    sha256: verified.manifest.sha256,
    publicIndexProjectionDigest: verified.manifest.publicIndexProjectionDigest,
    counts: verified.manifest.counts,
  };
}

async function run() {
  const action = process.argv[2];
  const options = parseArguments(process.argv.slice(3));
  switch (action) {
    case "backup": {
      assertOnly(options, ["source", "bundle"]);
      const result = await createSearchBackup({ sourcePath: required(options, "source"), bundleDir: required(options, "bundle") });
      return {
        action,
        result: "pass",
        bundleDir: result.bundleDir,
        manifestPath: result.manifestPath,
        dataPath: result.dataPath,
        manifestDigest: result.manifestDigest,
        databaseVersion: result.manifest.databaseVersion,
        dataPolicyVersion: result.manifest.dataPolicyVersion,
        sourceUsePolicyVersion: result.manifest.sourceUsePolicyVersion,
        sourceRevision: result.manifest.sourceRevision,
        bytes: result.manifest.bytes,
        sha256: result.manifest.sha256,
        publicIndexProjectionDigest: result.manifest.publicIndexProjectionDigest,
        counts: result.manifest.counts,
      };
    }
    case "verify": {
      assertOnly(options, ["manifest"]);
      return { action, result: "pass", ...publicVerification(await verifySearchBackup(required(options, "manifest"))) };
    }
    case "restore": {
      assertOnly(options, ["manifest", "destination"]);
      const result = await restoreSearchBackup({ manifestPath: required(options, "manifest"), destinationPath: required(options, "destination") });
      return { action, result: "pass", ...result };
    }
    case "reindex": {
      assertOnly(options, ["manifest", "destination"]);
      const result = await reindexSearchBackup({ manifestPath: required(options, "manifest"), destinationPath: required(options, "destination") });
      return { action, result: "pass", ...result };
    }
    default:
      throw new Error("recovery action must be backup, verify, restore, or reindex");
  }
}

try {
  process.stdout.write(`${JSON.stringify(await run())}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ result: "failed", error: String(error?.message ?? error) })}\n`);
  process.exitCode = 1;
}

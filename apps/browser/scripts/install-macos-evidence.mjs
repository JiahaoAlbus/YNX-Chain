#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_ROOT = path.resolve(ROOT, "../..");
const SOURCE_APP = path.join(
  ROOT,
  "dist",
  "macos",
  "YNX Browser Testnet Preview.app",
);
const BUNDLE_ID = "com.ynxweb4.browser.macos";
const URL_SCHEME = "ynxbrowser";
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
let emergencyRecovery = null;

export function redactHome(input, home = homedir()) {
  if (input === home) return "~";
  if (input.startsWith(`${home}${path.sep}`)) {
    return `~${input.slice(home.length)}`;
  }
  return input;
}

export function immutableInstallName(sourceCommit, binarySha256) {
  const commit = sourceCommit.slice(0, 12).replace(/[^a-f0-9]/gi, "");
  const binary = binarySha256.slice(0, 12).replace(/[^a-f0-9]/gi, "");
  if (commit.length !== 12 || binary.length !== 12) {
    throw new Error(
      "source commit and binary hash must contain at least 12 hexadecimal characters",
    );
  }
  return `YNX Browser Testnet Preview-${commit}-${binary}.app`;
}

export function classifyBundleRecord({
  appPath,
  sourcePath,
  installedPath,
  binarySha256,
  sourceSha256,
}) {
  let role =
    binarySha256 === sourceSha256 ? "matching-copy" : "collision";
  if (path.resolve(appPath) === path.resolve(sourcePath)) role = "source-artifact";
  if (path.resolve(appPath) === path.resolve(installedPath)) role = "reviewed-install";
  return {
    path: redactHome(path.resolve(appPath)),
    role,
    binarySha256,
    matchesReviewedBinary: binarySha256 === sourceSha256,
  };
}

function parseArgs(argv) {
  const options = {
    skipBuild: false,
    installRoot: path.join(homedir(), "Applications"),
    evidenceOutput: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--install-root") {
      const value = argv[++index];
      if (!value) throw new Error("--install-root requires a path");
      options.installRoot = path.resolve(value);
    } else if (arg === "--evidence-output") {
      const value = argv[++index];
      if (!value) throw new Error("--evidence-output requires a path");
      options.evidenceOutput = path.resolve(value);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function run(
  command,
  args,
  {
    cwd = ROOT,
    allowFailure = false,
    env = process.env,
    timeoutMs = 120_000,
  } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${detail}`,
    );
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function plistValue(appPath, key) {
  const plist = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const result = run(PLIST_BUDDY, ["-c", `Print :${key}`, plist], {
    allowFailure: true,
  });
  return result.status === 0 ? result.stdout : null;
}

function executablePath(appPath) {
  const executable = plistValue(appPath, "CFBundleExecutable");
  if (!executable) return null;
  const candidate = path.join(appPath, "Contents", "MacOS", executable);
  return existsSync(candidate) ? candidate : null;
}

function inspectApp(appPath, sourcePath, installedPath, sourceSha256) {
  const executable = executablePath(appPath);
  if (!executable) return null;
  return classifyBundleRecord({
    appPath,
    sourcePath,
    installedPath,
    binarySha256: sha256File(executable),
    sourceSha256,
  });
}

function scanApplications(root, maxDepth = 4) {
  const found = [];
  const visit = (directory, depth) => {
    if (depth > maxDepth || !existsSync(directory)) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && entry.name.endsWith(".app")) {
        found.push(candidate);
        continue;
      }
      if (entry.isDirectory()) visit(candidate, depth + 1);
    }
  };
  visit(root, 0);
  return found;
}

function discoverSameBundleApps(extraPaths = []) {
  const candidates = new Set(
    extraPaths.filter(Boolean).map((value) => path.resolve(value)),
  );

  const spotlight = run(
    "mdfind",
    [`kMDItemCFBundleIdentifier == '${BUNDLE_ID}'c`],
    { allowFailure: true },
  );
  if (spotlight.status === 0 && spotlight.stdout) {
    for (const line of spotlight.stdout.split("\n")) {
      if (line.trim()) candidates.add(path.resolve(line.trim()));
    }
  }

  for (const root of ["/Applications", path.join(homedir(), "Applications")]) {
    for (const app of scanApplications(root)) candidates.add(path.resolve(app));
  }

  return [...candidates]
    .filter(
      (candidate) =>
        existsSync(candidate) && lstatSync(candidate).isDirectory(),
    )
    .filter(
      (candidate) =>
        plistValue(candidate, "CFBundleIdentifier") === BUNDLE_ID,
    )
    .sort((left, right) => left.localeCompare(right));
}

function nextPreservationPath(originalPath, binarySha256, preservationRoot) {
  const base = path.basename(originalPath, ".app");
  const stem = `${base}-preserved-${binarySha256.slice(0, 12)}`;
  let candidate = path.join(preservationRoot, `${stem}.app`);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = path.join(preservationRoot, `${stem}-${suffix}.app`);
    suffix += 1;
  }
  return candidate;
}

function preserveUserApplicationCollisions(
  appPaths,
  installedPath,
  sourceSha256,
) {
  const applicationsRoot = path.resolve(homedir(), "Applications");
  const preservationRoot = path.join(
    applicationsRoot,
    "YNX Browser Preserved",
  );
  mkdirSync(preservationRoot, { recursive: true });

  const moves = [];
  for (const appPath of appPaths) {
    const absolute = path.resolve(appPath);
    if (absolute === path.resolve(installedPath)) continue;
    if (!absolute.startsWith(`${applicationsRoot}${path.sep}`)) continue;
    if (absolute.startsWith(`${preservationRoot}${path.sep}`)) continue;

    const executable = executablePath(absolute);
    if (!executable) continue;
    const binarySha256 = sha256File(executable);
    if (binarySha256 === sourceSha256) continue;

    const preservedPath = nextPreservationPath(
      absolute,
      binarySha256,
      preservationRoot,
    );
    renameSync(absolute, preservedPath);
    const preservedExecutable = executablePath(preservedPath);
    if (
      !preservedExecutable ||
      sha256File(preservedExecutable) !== binarySha256
    ) {
      throw new Error(
        `preserved collision hash mismatch: ${preservedPath}`,
      );
    }
    moves.push({
      originalAbsolute: absolute,
      preservedAbsolute: preservedPath,
      binarySha256,
    });
  }
  return moves;
}

function restorePreservedCollisions(moves) {
  const results = [];
  for (const move of [...moves].reverse()) {
    let result = "pass";
    let detail = null;
    try {
      if (existsSync(move.originalAbsolute)) {
        throw new Error("original path is no longer free");
      }
      renameSync(move.preservedAbsolute, move.originalAbsolute);
      const executable = executablePath(move.originalAbsolute);
      if (!executable || sha256File(executable) !== move.binarySha256) {
        throw new Error("restored executable hash mismatch");
      }
    } catch (error) {
      result = "failed";
      detail = error instanceof Error ? error.message : String(error);
    }
    results.push({
      originalPath: redactHome(move.originalAbsolute),
      preservedPath: redactHome(move.preservedAbsolute),
      binarySha256: move.binarySha256,
      result,
      detail,
    });
  }
  return results;
}

function verifyPreserved(
  beforeRecords,
  sourcePath,
  installedPath,
  sourceSha256,
  moves,
) {
  const collisions = beforeRecords.filter(
    (record) => record.role === "collision",
  );
  const moveByOriginal = new Map(
    moves.map((move) => [redactHome(move.originalAbsolute), move]),
  );
  const afterByPath = new Map(
    discoverSameBundleApps([
      sourcePath,
      installedPath,
      ...moves.map((move) => move.preservedAbsolute),
    ])
      .map((appPath) =>
        inspectApp(appPath, sourcePath, installedPath, sourceSha256),
      )
      .filter(Boolean)
      .map((record) => [record.path, record]),
  );

  const preserved = collisions.map((before) => {
    const move = moveByOriginal.get(before.path);
    const expectedPath = move
      ? redactHome(move.preservedAbsolute)
      : before.path;
    const after = afterByPath.get(expectedPath);
    return {
      originalPath: before.path,
      preservedPath: expectedPath,
      beforeSha256: before.binarySha256,
      afterSha256: after?.binarySha256 ?? null,
      preserved: Boolean(
        after && after.binarySha256 === before.binarySha256,
      ),
    };
  });

  return {
    records: preserved,
    verified: preserved.every((record) => record.preserved),
  };
}

function copyImmutable(sourceApp, installedApp, sourceSha256) {
  mkdirSync(path.dirname(installedApp), { recursive: true });
  if (existsSync(installedApp)) {
    const existingExecutable = executablePath(installedApp);
    if (
      !existingExecutable ||
      sha256File(existingExecutable) !== sourceSha256
    ) {
      throw new Error(
        `immutable install path already exists with different content: ${installedApp}`,
      );
    }
    return "reused-identical";
  }

  const scratch = mkdtempSync(
    path.join(path.dirname(installedApp), ".ynx-browser-install-"),
  );
  const staged = path.join(scratch, path.basename(installedApp));
  try {
    run("ditto", ["--noqtn", sourceApp, staged]);
    const stagedExecutable = executablePath(staged);
    if (
      !stagedExecutable ||
      sha256File(stagedExecutable) !== sourceSha256
    ) {
      throw new Error(
        "staged app executable hash does not match the reviewed artifact",
      );
    }
    renameSync(staged, installedApp);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return "installed-new";
}

function resolveHandler(url) {
  const scratch = mkdtempSync(path.join(homedir(), ".ynx-browser-resolver-"));
  const resolver = path.join(scratch, "resolve-macos-handler");
  try {
    run(
      "xcrun",
      [
        "swiftc",
        "-framework",
        "AppKit",
        path.join(SCRIPT_DIR, "resolve-macos-handler.swift"),
        "-o",
        resolver,
      ],
      { timeoutMs: 60_000 },
    );

    let last = null;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const result = run(resolver, [url], {
        allowFailure: true,
        timeoutMs: 5_000,
      });
      last = result;
      if (result.status === 0 && result.stdout) {
        return path.resolve(result.stdout.split("\n").at(-1));
      }
      run("sleep", ["0.25"], { timeoutMs: 2_000 });
    }
    throw new Error(
      `LaunchServices did not resolve ${url}: ${last?.stderr || last?.stdout || "unknown error"}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function stopExactInstalledApp(appPath) {
  const executable = executablePath(appPath);
  if (!executable) {
    return { result: "not-running", pids: [] };
  }
  const lookup = run("pgrep", ["-f", executable], {
    allowFailure: true,
    timeoutMs: 5_000,
  });
  const pids = lookup.status === 0
    ? lookup.stdout
        .split("\n")
        .map((value) => value.trim())
        .filter((value) => /^\d+$/.test(value))
    : [];
  const results = pids.map((pid) => {
    const stopped = run("kill", [pid], {
      allowFailure: true,
      timeoutMs: 5_000,
    });
    return {
      pid: Number(pid),
      result: stopped.status === 0 ? "pass" : "failed",
      exitCode: stopped.status,
    };
  });
  return {
    result: results.every((entry) => entry.result === "pass")
      ? "pass"
      : "failed",
    pids: results,
  };
}

function recoverAfterUnexpectedFailure({ installedApp, preservedMoves }) {
  const launchCleanup = stopExactInstalledApp(installedApp);
  const pendingMoves = preservedMoves.filter(
    (move) =>
      existsSync(move.preservedAbsolute) &&
      !existsSync(move.originalAbsolute),
  );
  const collisionRollback = restorePreservedCollisions(pendingMoves);
  const registrationRollback = collisionRollback
    .filter((record) => record.result === "pass")
    .map((record) => {
      const originalPath = record.originalPath.startsWith("~/")
        ? path.join(homedir(), record.originalPath.slice(2))
        : record.originalPath;
      const result = run("open", ["-g", "-n", "-a", originalPath], {
        allowFailure: true,
        timeoutMs: 15_000,
      });
      const cleanup = stopExactInstalledApp(originalPath);
      return {
        path: record.originalPath,
        result: result.status === 0 ? "pass" : "failed",
        exitCode: result.status,
        cleanup,
      };
    });
  return {
    launchCleanup,
    collisionRollback,
    registrationRollback,
    recovered:
      collisionRollback.every((record) => record.result === "pass") &&
      registrationRollback.every((record) => record.result === "pass"),
  };
}

function writeEvidence(filePath, evidence) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  renameSync(temporary, filePath);
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("macOS install evidence requires a Darwin host");
  }

  const options = parseArgs(process.argv.slice(2));
  if (!options.skipBuild) run("npm", ["run", "build:macos"]);
  if (!existsSync(SOURCE_APP)) {
    throw new Error(`reviewed app is missing: ${SOURCE_APP}`);
  }

  const sourceCommit = run("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
  }).stdout;
  const sourceExecutable = executablePath(SOURCE_APP);
  if (!sourceExecutable) {
    throw new Error("reviewed app executable is missing");
  }
  const sourceSha256 = sha256File(sourceExecutable);
  const installName = immutableInstallName(sourceCommit, sourceSha256);
  const installedApp = path.join(options.installRoot, installName);
  const evidenceOutput =
    options.evidenceOutput ??
    path.join(
      ROOT,
      "evidence",
      `macos-install-${sourceCommit.slice(0, 7)}.json`,
    );

  const discoveredBeforePaths = discoverSameBundleApps([
    SOURCE_APP,
    installedApp,
  ]);
  const discoveredBefore = discoveredBeforePaths
    .map((appPath) =>
      inspectApp(appPath, SOURCE_APP, installedApp, sourceSha256),
    )
    .filter(Boolean);

  const preservedMoves = preserveUserApplicationCollisions(
    discoveredBeforePaths,
    installedApp,
    sourceSha256,
  );
  emergencyRecovery = { installedApp, preservedMoves };
  const installResult = copyImmutable(
    SOURCE_APP,
    installedApp,
    sourceSha256,
  );
  run("codesign", ["--verify", "--deep", "--strict", installedApp]);
  run("open", ["-g", "-n", "-a", installedApp], {
    timeoutMs: 15_000,
  });
  run("sleep", ["0.75"], { timeoutMs: 2_000 });

  const protocolProbe = `${URL_SCHEME}://${BUNDLE_ID}/evidence/handler-resolution?source=${sourceCommit.slice(0, 12)}`;
  const resolvedApp = resolveHandler(protocolProbe);
  const resolvedExecutable = executablePath(resolvedApp);
  if (!resolvedExecutable) {
    throw new Error(`resolved app has no executable: ${resolvedApp}`);
  }
  const resolvedSha256 = sha256File(resolvedExecutable);
  const installedExecutable = executablePath(installedApp);
  if (!installedExecutable) {
    throw new Error(
      "installed app executable is missing after registration",
    );
  }
  const installedSha256 = sha256File(installedExecutable);
  const preservation = verifyPreserved(
    discoveredBefore,
    SOURCE_APP,
    installedApp,
    sourceSha256,
    preservedMoves,
  );
  const handlerMatchesReviewedBinary = resolvedSha256 === sourceSha256;
  const handlerResolvesReviewedInstall =
    path.resolve(resolvedApp) === path.resolve(installedApp);
  const exactInstallVerified =
    installedSha256 === sourceSha256 &&
    handlerMatchesReviewedBinary &&
    handlerResolvesReviewedInstall &&
    preservation.verified;

  let collisionRollback = [];
  let registrationRollback = [];
  if (!exactInstallVerified) {
    collisionRollback = restorePreservedCollisions(preservedMoves);
    registrationRollback = collisionRollback
      .filter((record) => record.result === "pass")
      .map((record) => {
        const originalPath = record.originalPath.startsWith("~/")
          ? path.join(homedir(), record.originalPath.slice(2))
          : record.originalPath;
        const result = run("open", ["-g", "-n", "-a", originalPath], {
          allowFailure: true,
          timeoutMs: 15_000,
        });
        const cleanup = stopExactInstalledApp(originalPath);
        return {
          path: record.originalPath,
          action: "restore-registration-after-failed-verification",
          result: result.status === 0 ? "pass" : "failed",
          exitCode: result.status,
          cleanup,
        };
      });
  }

  const launchCleanup = stopExactInstalledApp(installedApp);

  const discoveredAfter = discoverSameBundleApps([
    SOURCE_APP,
    installedApp,
    resolvedApp,
  ])
    .map((appPath) =>
      inspectApp(appPath, SOURCE_APP, installedApp, sourceSha256),
    )
    .filter(Boolean);

  const evidence = {
    schemaVersion: "ynx.browser.macos-install-evidence.v1",
    product: "YNX Browser",
    platform: "macOS",
    sourceCommit,
    generatedAt: new Date().toISOString(),
    bundleId: BUNDLE_ID,
    reviewedArtifact: {
      app: "apps/browser/dist/macos/YNX Browser Testnet Preview.app",
      executableSha256: sourceSha256,
      bytes: statSync(sourceExecutable).size,
      signingClass: "adhoc",
    },
    collisionAudit: {
      before: discoveredBefore,
      after: discoveredAfter,
      preservationMoves: preservedMoves.map((move) => ({
        originalPath: redactHome(move.originalAbsolute),
        preservedPath: redactHome(move.preservedAbsolute),
        binarySha256: move.binarySha256,
        result: "pass",
      })),
      collisionRollback,
      preservedExistingCopies: preservation.records,
      preservationVerified: preservation.verified,
    },
    install: {
      result: installResult,
      path: redactHome(installedApp),
      immutableName: installName,
      executableSha256: installedSha256,
      exactArtifactHash: installedSha256 === sourceSha256,
      codesignVerify: "pass",
    },
    launchServices: {
      registration: "explicit-path-launch-registration-after-preserving-user-collision",
      launchCleanup,
      registrationRollback,
      protocolProbe,
      resolvedApp: redactHome(resolvedApp),
      resolvedExecutableSha256: resolvedSha256,
      resolvesReviewedInstall: handlerResolvesReviewedInstall,
      exactReviewedBinaryHash: handlerMatchesReviewedBinary,
    },
    verifiedStates: {
      installedLocalMacosEvidenceHost: exactInstallVerified,
      productionSigned: false,
      notarized: false,
      storeReleased: false,
      downloadHosted: false,
    },
    truthBoundary: exactInstallVerified
      ? "This proves a non-destructive user-local installation of the exact reviewed ad-hoc Testnet Preview and LaunchServices resolution to that installed executable on this evidence host. It does not prove Developer ID signing, notarization, public hosting, store release, cross-host reproducibility or central Wallet/Auth acceptance."
      : "The exact reviewed executable was copied without overwriting any existing app, but LaunchServices did not resolve the protocol to the reviewed installation. Previous registrations were restored and installedLocal remains false.",
  };

  writeEvidence(evidenceOutput, evidence);
  emergencyRecovery = null;
  process.stdout.write(
    `${JSON.stringify(
      {
        evidence: redactHome(evidenceOutput),
        exactInstallVerified,
      },
      null,
      2,
    )}\n`,
  );

  if (!exactInstallVerified) {
    throw new Error(
      `fail closed: LaunchServices resolved ${redactHome(resolvedApp)} with ${resolvedSha256}, expected ${redactHome(installedApp)} with ${sourceSha256}`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    const recovery = emergencyRecovery
      ? recoverAfterUnexpectedFailure(emergencyRecovery)
      : null;
    emergencyRecovery = null;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      recovery
        ? `${message}\nemergencyRecovery=${JSON.stringify(recovery)}\n`
        : `${message}\n`,
    );
    process.exitCode = 1;
  }
}

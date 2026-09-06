import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function desktopReleaseIdentity(cwd = projectDir, version) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const sourceCommit = git(root, "rev-parse", "HEAD");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("An exact source commit is required");
  if (process.env.GITHUB_SHA && sourceCommit !== process.env.GITHUB_SHA) throw new Error("CI source and checkout differ");
  // A package identity must never describe a tracked dirty source as a commit.
  git(root, "diff", "--exit-code", "HEAD", "--", "apps/wallet-desktop", "packages/wallet-auth");
  const metadata = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Package version is invalid");
  return Object.freeze({ schemaVersion: 1, product: "YNX Wallet", version, sourceVersion: metadata.version, sourceCommit,
    walletTree: git(root, "rev-parse", `${sourceCommit}:apps/wallet-desktop`),
    walletAuthTree: git(root, "rev-parse", `${sourceCommit}:packages/wallet-auth`),
    distribution: "testnet-preview", productionSigned: false, storeReleased: false,
    installedRuntimeVerified: false, publicDownloadVerified: false });
}

export function verifyDesktopPackage(resources, cwd = projectDir) {
  const require = createRequire(path.join(cwd, "package.json"));
  const asar = require("@electron/asar");
  const archive = path.join(resources, "app.asar");
  // Verification must read the current archive, including after an in-process rebuild.
  asar.uncache(archive);
  const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  const expected = desktopReleaseIdentity(cwd, metadata.version);
  const actual = JSON.parse(readFileSync(path.join(resources, "ynx-wallet-build-identity.json"), "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Embedded build identity does not match the checkout");
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const names = git(root, "ls-tree", "-r", "--name-only", expected.sourceCommit, "apps/wallet-desktop/src", "packages/wallet-auth/src", "packages/wallet-auth/package.json").split("\n");
  const verified = [];
  for (const name of names) {
    const packedName = name.startsWith("apps/wallet-desktop/") ? name.slice("apps/wallet-desktop/".length)
      : `node_modules/@ynx-chain/wallet-auth/${name.slice("packages/wallet-auth/".length)}`;
    const source = execFileSync("git", ["show", `${expected.sourceCommit}:${name}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    const packed = asar.extractFile(archive, packedName);
    if (!source.equals(packed)) throw new Error(`Packaged source differs: ${name}`);
    verified.push({ path: packedName, bytes: packed.length, sha256: digest(packed) });
  }
  return { ...expected, packagedSourceVerified: true, asarSHA256: digest(readFileSync(archive)), files: verified };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [resources, outputDirectory] = process.argv.slice(2);
  if (!resources || !outputDirectory) throw new Error("Usage: release-provenance.mjs <resources-directory> <artifact-directory>");
  const verification = verifyDesktopPackage(path.resolve(resources));
  const artifacts = readdirSync(outputDirectory, { withFileTypes: true })
    .filter(item => item.isFile() && /\.(?:exe|deb|AppImage|dmg)$/.test(item.name))
    .map(item => { const bytes = readFileSync(path.join(outputDirectory, item.name)); return { filename: item.name, bytes: bytes.length, sha256: digest(bytes) }; });
  if (!artifacts.length) throw new Error("No distributable installer was produced");
  const manifest = { ...verification, buildPlatform: process.platform, buildArchitecture: process.arch, artifacts };
  writeFileSync(path.join(outputDirectory, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ sourceCommit: manifest.sourceCommit, version: manifest.version, verifiedFiles: manifest.files.length, artifacts }));
}

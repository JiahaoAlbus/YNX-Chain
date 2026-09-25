/** Bind a QA-only run to the original, already-built 0.6.10 x64 installer. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const sourceCommit = "ffaf3ca0d85f81622e6b1ba20c7648abb09a2574";
const originalRun = 36106645368;
const artifactId = 10851168846;
const archiveBytes = 121073653;
const archiveSHA256 = "d5bfd9c08eb4e1e705f081e7e3f403ad47189f4ae23fef0c167da0391677bd4c";
const installerName = "ynx-wallet-desktop-0.6.10-x64.exe";
const installerBytes = 121050861;
const installerSHA256 = "c7f76121988f58e88979e049f820514bc352c039850e8251b86ae10badefb4f8";
const fail = code => { throw new Error(code); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function find(directory, name, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) await find(location, name, found);
    else if (entry.isFile() && entry.name === name) found.push(location);
  }
  return found;
}

const [mode, source, destination] = process.argv.slice(2);
if (process.platform !== "win32" || process.arch !== "x64" || !["download", "verify"].includes(mode) || !source || (mode === "verify" && !destination) || !process.env.GITHUB_TOKEN) fail("IMMUTABLE_QA_ENVIRONMENT_UNAVAILABLE");
const endpoint = `https://api.github.com/repos/JiahaoAlbus/YNX-Chain/actions/artifacts/${artifactId}`;
const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };
const response = await fetch(endpoint, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
if (!response.ok) fail("IMMUTABLE_QA_METADATA_UNAVAILABLE");
const metadata = await response.json();
if (metadata.id !== artifactId || metadata.workflow_run?.id !== originalRun || metadata.workflow_run?.head_sha !== sourceCommit || metadata.name !== `wallet-current-windows-x64-${sourceCommit}` || metadata.size_in_bytes !== archiveBytes || metadata.digest !== `sha256:${archiveSHA256}` || metadata.expired) fail("IMMUTABLE_QA_ARTIFACT_BINDING_MISMATCH");
if (mode === "download") {
  const redirect = await fetch(`${endpoint}/zip`, { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (redirect.status !== 302) fail("IMMUTABLE_QA_ARCHIVE_REDIRECT_UNAVAILABLE");
  const url = new URL(redirect.headers.get("location"));
  if (url.protocol !== "https:" || url.username || url.password) fail("IMMUTABLE_QA_ARCHIVE_URL_UNSAFE");
  const archive = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(300_000) });
  if (!archive.ok || !archive.body) fail("IMMUTABLE_QA_ARCHIVE_UNAVAILABLE");
  const hash = createHash("sha256"); let bytes = 0;
  const meter = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > archiveBytes) return callback(new Error("IMMUTABLE_QA_ARCHIVE_TOO_LARGE"));
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(archive.body), meter, createWriteStream(source, { flags: "wx" }));
  if (bytes !== archiveBytes || hash.digest("hex") !== archiveSHA256) fail("IMMUTABLE_QA_ARCHIVE_HASH_MISMATCH");
  console.log(JSON.stringify({ sourceCommit, qaCommit: process.env.GITHUB_SHA, originalRun, artifactId, archiveBytes, archiveSHA256, completeArchiveHashVerified: true }));
  process.exit(0);
}
const installers = await find(source, installerName);
const manifests = await find(source, "release-manifest.json");
if (installers.length !== 1 || manifests.length !== 1) fail("IMMUTABLE_QA_AMBIGUOUS_CONTENTS");
const installer = await readFile(installers[0]);
if (installer.length !== installerBytes || digest(installer) !== installerSHA256) fail("IMMUTABLE_QA_INSTALLER_HASH_MISMATCH");
const manifest = JSON.parse(await readFile(manifests[0], "utf8"));
if (manifest.sourceCommit !== sourceCommit || manifest.version !== "0.6.10" || manifest.buildPlatform !== "win32" || manifest.buildArchitecture !== "x64" || manifest.packagedSourceVerified !== true || manifest.files?.length !== 94 || !/^[a-f0-9]{64}$/.test(manifest.asarSHA256 ?? "") || manifest.artifacts?.length !== 1 || manifest.artifacts[0]?.filename !== installerName || manifest.artifacts[0]?.bytes !== installerBytes || manifest.artifacts[0]?.sha256 !== installerSHA256 || manifest.productionSigned !== false) fail("IMMUTABLE_QA_SOURCE_MANIFEST_MISMATCH");
await mkdir(destination, { recursive: true });
await copyFile(installers[0], path.join(destination, installerName), constants.COPYFILE_EXCL);
await copyFile(manifests[0], path.join(destination, "release-manifest.json"), constants.COPYFILE_EXCL);
const copied = await stat(path.join(destination, installerName));
if (copied.size !== installerBytes) fail("IMMUTABLE_QA_COPY_CHANGED");
const evidence = { sourceCommit, qaCommit: process.env.GITHUB_SHA, originalRun, artifactId, archiveBytes, archiveSHA256, installerName, installerBytes, installerSHA256, exactOriginalArtifactMetadataAndInstallerVerified: true, candidateInstalledLifecycleVerified: false };
await writeFile(path.join(destination, "windows-immutable-x64-artifact.json"), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(evidence));

import {createHash} from "node:crypto";
import {execFileSync, spawnSync} from "node:child_process";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";

const [packageDir, expectedMode] = process.argv.slice(2);
if (!packageDir || !["test-only", "owner-approved"].includes(expectedMode)) {
  throw new Error("usage: mobile-android-release-verify.mjs <package-dir> <test-only|owner-approved>");
}
const fail = (message) => { throw new Error(`mobile Android release verification failed: ${message}`); };
const hashFile = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;
const manifestPath = path.join(packageDir, "manifest.json");
const manifestText = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
if (manifestText !== canonical(manifest)) fail("manifest is not canonical JSON");
const expectedKeys = ["schema", "releaseMode", "sourceCommit", "sourceTreeDigest", "sourceTreeDirty", "packageName", "versionName", "versionCode", "signerCertificateSHA256", "canonicalLogoSHA256", "productionSigningApproved", "realDeviceVerified", "storeSubmitted", "storeAccepted", "iosArtifactIncluded", "artifacts"];
if (JSON.stringify(Object.keys(manifest)) !== JSON.stringify(expectedKeys)) fail("manifest fields differ from schema");
if (manifest.schema !== "ynx-mobile-android-release/v1" || manifest.releaseMode !== expectedMode) fail("schema or mode mismatch");
if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit) || !/^[0-9a-f]{64}$/.test(manifest.sourceTreeDigest)) fail("invalid source identity");
const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim();
if (manifest.sourceCommit !== currentCommit) fail("source commit differs from the current checkout");
const tracked = execFileSync("git", ["ls-files", "-z", "apps/mobile"], {encoding: "buffer"})
  .toString("utf8").split("\0").filter(Boolean).sort();
const treeHash = createHash("sha256");
for (const file of tracked) {
  treeHash.update(file).update("\0").update(await hashFile(file)).update("\0");
}
if (manifest.sourceTreeDigest !== treeHash.digest("hex")) fail("mobile source tree digest mismatch");
const currentDirty = execFileSync("git", ["status", "--porcelain"], {encoding: "utf8"}).trim().length > 0;
if (manifest.sourceTreeDirty !== currentDirty) fail("source dirty status differs from the current checkout");
if (!["com.ynxweb4.mobile", "com.ynxweb4.social", "com.ynxweb4.wallet"].includes(manifest.packageName) || manifest.versionName !== "1.0.0" || manifest.versionCode !== 1) fail("application identity mismatch");
if (!/^[0-9a-f]{64}$/.test(manifest.signerCertificateSHA256)) fail("invalid signer certificate digest");
if (manifest.canonicalLogoSHA256 !== await hashFile("assets/brand/ynx-logo.png")) fail("canonical Logo digest mismatch");
if (expectedMode === "owner-approved") {
  if (!manifest.productionSigningApproved || manifest.sourceTreeDirty) fail("owner release is not clean and approved");
} else if (manifest.productionSigningApproved) {
  fail("test-only package claims production signing approval");
}
for (const field of ["realDeviceVerified", "storeSubmitted", "storeAccepted", "iosArtifactIncluded"]) {
  if (manifest[field] !== false) fail(`${field} must remain false without external evidence`);
}
const expectedArtifacts = new Map([["ynx-mobile-android.aab", "android-app-bundle"], ["ynx-mobile-android.apk", "android-package"]]);
if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== expectedArtifacts.size) fail("artifact set mismatch");
for (const artifact of manifest.artifacts) {
  if (expectedArtifacts.get(artifact.name) !== artifact.type || path.basename(artifact.name) !== artifact.name) fail("unsafe or unknown artifact");
  const file = path.join(packageDir, artifact.name);
  if ((await stat(file)).size !== artifact.size || await hashFile(file) !== artifact.sha256) fail(`artifact mismatch: ${artifact.name}`);
  expectedArtifacts.delete(artifact.name);
}
if (expectedArtifacts.size) fail("required artifact missing");

const aab = path.join(packageDir, "ynx-mobile-android.aab");
const apk = path.join(packageDir, "ynx-mobile-android.apk");
const jarVerify = spawnSync("jarsigner", ["-verify", "-certs", aab], {encoding: "utf8"});
if (jarVerify.status !== 0 || !/^jar verified\.$/m.test(jarVerify.stdout)) fail("AAB JAR signature is invalid");
const certOutput = execFileSync("keytool", ["-printcert", "-jarfile", aab], {encoding: "utf8"});
const certMatch = certOutput.match(/SHA256:\s*([0-9A-F:]{95})/);
if (!certMatch || certMatch[1].replaceAll(":", "").toLowerCase() !== manifest.signerCertificateSHA256) fail("AAB certificate digest mismatch");

const androidHome = process.env.ANDROID_HOME || "/opt/homebrew/share/android-commandlinetools";
const buildTools = path.join(androidHome, "build-tools");
const versions = execFileSync("find", [buildTools, "-type", "f", "-name", "apksigner", "-perm", "-111"], {encoding: "utf8"}).trim().split("\n").filter(Boolean).sort();
const apksigner = versions.at(-1);
if (!apksigner) fail("apksigner is unavailable");
const apkVerify = execFileSync(apksigner, ["verify", "--verbose", "--print-certs", apk], {encoding: "utf8"});
if (!/^Verifies$/m.test(apkVerify) || !/APK Signature Scheme v2\): true/m.test(apkVerify)) fail("APK v2 signature is invalid");
const apkCert = apkVerify.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/);
if (!apkCert || apkCert[1] !== manifest.signerCertificateSHA256) fail("APK certificate digest mismatch");

const forbidden = ["password", "keystorePath", "keyAlias", "/Users/", "/tmp/", "/var/folders/"];
for (const value of forbidden) if (manifestText.includes(value)) fail(`manifest leaks forbidden value: ${value}`);
console.log(`mobile-android-release-verify passed: mode=${expectedMode} signer=${manifest.signerCertificateSHA256}`);

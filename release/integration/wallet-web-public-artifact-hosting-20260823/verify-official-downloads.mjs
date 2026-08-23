import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const carrierCommit = "8190b1b7b8a3b6258d52814445e9fbb285877fcd";
const artifacts = [
  { name: "ynx-wallet-web-pwa-0.1.0.zip", gitPath: "apps/wallet-web/artifacts/ynx-wallet-web-pwa-0.1.0.zip", bytes: 286356, sha256: "040e1f03956b6fb0a9298c8af5b76a5ed2895de0e5510a6208543bed9e3df055" },
  { name: "ynx-wallet-chrome-edge-0.1.0.zip", gitPath: "apps/wallet-web/artifacts/ynx-wallet-chrome-edge-0.1.0.zip", bytes: 471181, sha256: "2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d" },
  { name: "ynx-wallet-firefox-0.1.0.zip", gitPath: "apps/wallet-web/artifacts/ynx-wallet-firefox-0.1.0.zip", bytes: 471216, sha256: "29fe890612ebe9518a99d80492b44cb222c5e9e37ce8d761ebc84b8243b5a896" }
].map((artifact) => ({
  ...artifact,
  url: `https://www.ynxweb4.com/downloads/wallet-web/sha256-${artifact.sha256}/${artifact.name}`
}));
const rollbackArtifacts = [
  { name: "ynx-wallet-web-pwa-0.1.0.zip", bytes: 272706, sha256: "63d83cd20925f2d52c0f21f548fa7a857a4d056e03e5fa16244f173164a7d287" },
  { name: "ynx-wallet-chrome-edge-0.1.0.zip", bytes: 188846, sha256: "c733093dea47c6612c8a9d5ecea40be2227f62402f4b4966955c9e1accf4e2aa" },
  { name: "ynx-wallet-firefox-0.1.0.zip", bytes: 188883, sha256: "417d9b9e5babf05fdfdf8161504389eb99c636be75f94444bf4ff91a9b4536b3" }
].map((artifact) => ({
  ...artifact,
  url: `https://www.ynxweb4.com/downloads/wallet-web/sha256-${artifact.sha256}/${artifact.name}`,
  requiredCacheTokens: ["public", "max-age=31536000"],
  immutableRequired: false
}));

const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const headerTokens = (value) => new Set(String(value || "").toLowerCase().split(",").map((token) => token.trim()));

async function checkArtifact(fetcher, artifact) {
  const record = { name: artifact.name, url: artifact.url, passed: false, errors: [] };
  try {
    const response = await fetcher(artifact.url, { redirect: "error", signal: AbortSignal.timeout(30000) });
    const body = Buffer.from(await response.arrayBuffer());
    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    const contentDisposition = response.headers.get("content-disposition") || "";
    const cacheControl = response.headers.get("cache-control") || "";
    const cacheTokens = headerTokens(cacheControl);
    const contentLength = response.headers.get("content-length");
    Object.assign(record, {
      status: response.status,
      responseUrl: response.url || artifact.url,
      contentType,
      contentDisposition,
      contentLength: contentLength === null ? null : Number(contentLength),
      cacheControl,
      immutableObserved: cacheTokens.has("immutable"),
      xContentTypeOptions: response.headers.get("x-content-type-options"),
      downloadedBytes: body.length,
      downloadedSha256: sha256(body)
    });
    if (response.status !== 200) record.errors.push("HTTP_STATUS");
    if ((response.url || artifact.url) !== artifact.url) record.errors.push("REDIRECTED");
    if (contentType !== "application/zip") record.errors.push("CONTENT_TYPE");
    if (!/^attachment(?:;|$)/iu.test(contentDisposition)) record.errors.push("CONTENT_DISPOSITION");
    if (contentDisposition.includes("filename=") && !contentDisposition.includes(artifact.name)) record.errors.push("CONTENT_DISPOSITION_FILENAME");
    if (Number(contentLength) !== artifact.bytes) record.errors.push("CONTENT_LENGTH");
    const requiredCacheTokens = artifact.requiredCacheTokens || ["public", "max-age=31536000", "immutable"];
    if (!requiredCacheTokens.every((token) => cacheTokens.has(token))) record.errors.push("CACHE_CONTROL");
    if ((record.xContentTypeOptions || "").toLowerCase() !== "nosniff") record.errors.push("X_CONTENT_TYPE_OPTIONS");
    if (body.length !== artifact.bytes) record.errors.push("BODY_BYTES");
    if (record.downloadedSha256 !== artifact.sha256) record.errors.push("BODY_SHA256");
    record.passed = record.errors.length === 0;
  } catch (error) {
    record.errors.push(error?.message || String(error));
  }
  return record;
}

const exactHeaders = (artifact) => ({
  "content-type": "application/zip",
  "content-disposition": `attachment; filename=${artifact.name}`,
  "content-length": String(artifact.bytes),
  "cache-control": "public, max-age=31536000, immutable",
  "x-content-type-options": "nosniff"
});

async function selfTest() {
  const bodies = new Map(artifacts.map((artifact) => [artifact.name, execFileSync("git", ["show", `${carrierCommit}:${artifact.gitPath}`], { maxBuffer: 2_000_000 })]));
  const positiveFetch = async (url) => {
    const artifact = artifacts.find((entry) => entry.url === url);
    return new Response(bodies.get(artifact.name), { status: 200, headers: exactHeaders(artifact) });
  };
  const positive = await Promise.all(artifacts.map((artifact) => checkArtifact(positiveFetch, artifact)));
  const tamperedFetch = async (url) => {
    const artifact = artifacts.find((entry) => entry.url === url);
    const body = Buffer.from(bodies.get(artifact.name));
    body[0] ^= 0xff;
    return new Response(body, { status: 200, headers: exactHeaders(artifact) });
  };
  const negative = await checkArtifact(tamperedFetch, artifacts[0]);
  const passed = positive.every((record) => record.passed) && !negative.passed && negative.errors.includes("BODY_SHA256");
  console.log(JSON.stringify({ mode: "self-test", carrierCommit, positive, negative, passed }, null, 2));
  process.exit(passed ? 0 : 1);
}

const mode = process.argv[2] || "production-positive";
if (mode === "self-test") await selfTest();
if (!["production-positive", "expect-current-mismatch", "rollback-baseline"].includes(mode)) throw new Error(`unsupported mode: ${mode}`);
const selectedArtifacts = mode === "rollback-baseline" ? rollbackArtifacts : artifacts;
const records = await Promise.all(selectedArtifacts.map((artifact) => checkArtifact(fetch, artifact)));
const allPassed = records.every((record) => record.passed);
const gatePassed = mode === "expect-current-mismatch" ? records.every((record) => !record.passed) : allPassed;
const successorDownloadHosted = mode === "production-positive" && allPassed;
console.log(JSON.stringify({ mode, carrierCommit, observedAt: new Date().toISOString(), records, allPassed, gatePassed, rollbackBaselineOnly: mode === "rollback-baseline", downloadHosted: successorDownloadHosted, productionSigned: false, storeReleased: false, installedLocal: false, publicParity: false }, null, 2));
process.exit(gatePassed ? 0 : 1);

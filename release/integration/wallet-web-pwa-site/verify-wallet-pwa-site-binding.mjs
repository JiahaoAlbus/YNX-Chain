import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const frozenManifest = JSON.parse(await readFile(join(here, "frozen-wallet-manifest.webmanifest"), "utf8"));
const evidencePath = join(repoRoot, "apps/wallet-web/evidence/runtime/official-wallet-pwa-manifest-publication-gate-20260814.json");
const pageUrl = "https://www.ynxweb4.com/dapp/wallet";
const manifestUrl = "https://www.ynxweb4.com/wallet/companion/manifest.webmanifest";
const iconContract = new Map([
  ["./ynx-icon-192.png", {bytes: 9838, width: 192, height: 192, sha256: "02bd7b202a6683d83bbe4b17c246afc969b43284ee945e97167d9606e6df04af"}],
  ["./ynx-icon-512.png", {bytes: 45914, width: 512, height: 512, sha256: "5a6fb80c48a2047ad5632cf0b69f410ebaefd8aff0bb3da7dce28c1ce8c992c7"}],
  ["./ynx-icon-maskable-512.png", {bytes: 45914, width: 512, height: 512, sha256: "5a6fb80c48a2047ad5632cf0b69f410ebaefd8aff0bb3da7dce28c1ce8c992c7"}],
]);

const sha256 = body => createHash("sha256").update(body).digest("hex");
const pngDimensions = body => body.length >= 24 && body.subarray(1, 4).toString() === "PNG"
  ? {width: body.readUInt32BE(16), height: body.readUInt32BE(20)}
  : null;

function manifestHrefs(html) {
  return [...html.matchAll(/<link\b[^>]*>/giu)]
    .map(match => match[0])
    .filter(tag => /\brel\s*=\s*(["'])manifest\1/iu.test(tag))
    .map(tag => tag.match(/\bhref\s*=\s*(["'])(.*?)\1/iu)?.[2] ?? null)
    .filter(Boolean);
}

async function request(fetcher, url, type) {
  const response = await fetcher(url, {redirect: "error", signal: AbortSignal.timeout(15_000)});
  if ((response.url || url) !== url) throw new Error(`${type}:redirected`);
  if (response.status !== 200) throw new Error(`${type}:status:${response.status}`);
  return response;
}

export async function verifyWalletPwaSite(fetcher = fetch) {
  const result = {pageUrl, manifestUrl, page: null, manifest: null, icons: [], passed: false, error: null};
  try {
    const pageResponse = await request(fetcher, pageUrl, "page");
    const pageType = pageResponse.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (pageType !== "text/html") throw new Error("page:content-type");
    const hrefs = manifestHrefs(await pageResponse.text());
    const exactHrefCount = hrefs.filter(href => new URL(href, pageUrl).href === manifestUrl).length;
    result.page = {status: 200, contentType: pageType, manifestHrefs: hrefs, exactHrefCount};
    if (exactHrefCount !== 1) throw new Error("page:wallet-manifest-link");

    const manifestResponse = await request(fetcher, manifestUrl, "manifest");
    const manifestType = manifestResponse.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!["application/manifest+json", "application/json"].includes(manifestType)) throw new Error("manifest:content-type");
    const observedManifest = await manifestResponse.json();
    result.manifest = {status: 200, contentType: manifestType, exact: isDeepStrictEqual(observedManifest, frozenManifest)};
    if (!result.manifest.exact) throw new Error("manifest:identity-drift");

    for (const icon of frozenManifest.icons) {
      const expected = iconContract.get(icon.src);
      if (!expected) throw new Error(`icon:unfrozen:${icon.src}`);
      const url = new URL(icon.src, manifestUrl).href;
      const iconResponse = await request(fetcher, url, "icon");
      const contentType = iconResponse.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      const body = Buffer.from(await iconResponse.arrayBuffer());
      const dimensions = pngDimensions(body);
      const observed = {url, status: 200, contentType, bytes: body.length, sha256: sha256(body), ...dimensions, passed: false};
      observed.passed = contentType === "image/png" && observed.bytes === expected.bytes && observed.sha256 === expected.sha256 && observed.width === expected.width && observed.height === expected.height;
      result.icons.push(observed);
      if (!observed.passed) throw new Error(`icon:identity-drift:${icon.src}`);
    }
    result.passed = true;
  } catch (error) {
    result.error = error?.message || String(error);
  }
  return result;
}

async function selfTest() {
  const iconBodies = new Map();
  for (const icon of frozenManifest.icons) iconBodies.set(new URL(icon.src, manifestUrl).href, await readFile(join(repoRoot, "apps/wallet-web/public", icon.src)));
  const exactFetch = async url => {
    if (url === pageUrl) return new Response(`<link rel="manifest" href="${manifestUrl}">`, {status: 200, headers: {"content-type": "text/html"}});
    if (url === manifestUrl) return new Response(JSON.stringify(frozenManifest), {status: 200, headers: {"content-type": "application/manifest+json"}});
    const body = iconBodies.get(url);
    if (body) return new Response(body, {status: 200, headers: {"content-type": "image/png"}});
    return new Response("missing", {status: 404});
  };
  const exact = await verifyWalletPwaSite(exactFetch);
  const drift = await verifyWalletPwaSite(async url => url === pageUrl
    ? new Response('<link rel="manifest" href="/manifest.webmanifest">', {status: 200, headers: {"content-type": "text/html"}})
    : exactFetch(url));
  const passed = exact.passed && !drift.passed && drift.error === "page:wallet-manifest-link";
  console.log(JSON.stringify({mode: "self-test", passed, exact, drift}, null, 2));
  process.exit(passed ? 0 : 1);
}

if (process.argv.includes("--self-test")) await selfTest();
const expectUnpublished = process.argv.includes("--expect-unpublished");
const checks = await verifyWalletPwaSite();
const evidence = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  mode: expectUnpublished ? "truthful-unpublished-monitor" : "production-release-gate",
  ...checks,
  walletManifestDeployedPublic: checks.passed,
  installedLocal: false,
  coldLaunchProved: false,
  secondLaunchProved: false,
  gatePassed: expectUnpublished ? !checks.passed : checks.passed,
};
await mkdir(dirname(evidencePath), {recursive: true});
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.gatePassed ? 0 : 1);

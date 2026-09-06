import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";

/**
 * Validate a release manifest supplied by a trusted YNX publisher. This does not
 * fetch an artifact, attest its installed behavior, or discover the latest build.
 * Consumers must ship/verify the COMPLETE SDK and trusted manifest together.
 * Legacy registry downloadUrl, walletConnectionChoices and signing bytes remain
 * unchanged. This helper never falls back to a website or automatically downloads.
 */
export const WALLET_DOWNLOAD_MANIFEST_SCHEMA_VERSION = 1;
const PLATFORMS = ["android", "ios", "linux", "macos", "web-extension", "windows"];
const ARCHITECTURES = ["any", "arm64", "universal", "x64"];
const BROWSERS = ["chromium", "firefox", "safari"];
const FIELDS = ["id", "status", "sourceCommit", "sha256", "bytes", "filename", "mimeType", "platform", "architecture", "browser", "installation", "url", "storeStatus"];
const FORMATS = Object.freeze({
  apk: { platform: "android", architectures: ["arm64", "x64", "universal"], browser: null, extension: ".apk", mime: ["application/vnd.android.package-archive"] },
  "ios-ad-hoc": { platform: "ios", architectures: ["arm64"], browser: null, extension: ".ipa", mime: ["application/octet-stream", "application/x-itunes-ipa"] },
  dmg: { platform: "macos", architectures: ["arm64", "x64", "universal"], browser: null, extension: ".dmg", mime: ["application/x-apple-diskimage", "application/octet-stream"] },
  exe: { platform: "windows", architectures: ["arm64", "x64"], browser: null, extension: ".exe", mime: ["application/vnd.microsoft.portable-executable", "application/x-msdownload", "application/octet-stream"] },
  deb: { platform: "linux", architectures: ["arm64", "x64"], browser: null, extension: ".deb", mime: ["application/vnd.debian.binary-package", "application/x-debian-package", "application/octet-stream"] },
  rpm: { platform: "linux", architectures: ["arm64", "x64"], browser: null, extension: ".rpm", mime: ["application/x-rpm", "application/octet-stream"] },
  appimage: { platform: "linux", architectures: ["arm64", "x64"], browser: null, extension: ".AppImage", mime: ["application/vnd.appimage", "application/octet-stream"] },
  "extension-unpacked": { platform: "web-extension", architectures: ["any"], browser: "chromium", extension: ".zip", mime: ["application/zip"] },
  "extension-temporary": { platform: "web-extension", architectures: ["any"], browser: "firefox", extension: ".zip", mime: ["application/zip"] },
});

export function parseWalletDownloadManifest(input) {
  let value = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > 1_048_576) fail("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release manifest exceeds its byte limit");
    try { value = JSON.parse(input); } catch { fail("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release manifest is not JSON"); }
    if (canonicalJSON(value) !== input) fail("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release manifest must use exact canonical JSON");
  }
  exactFields(value, ["schemaVersion", "product", "artifacts"], "Wallet download manifest");
  if (value.schemaVersion !== 1 || value.product !== "ynx-wallet" || !Array.isArray(value.artifacts) || value.artifacts.length > 128) fail("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release manifest version, product or capacity is invalid");
  const artifacts = value.artifacts.map(parseArtifact), ids = new Set(), published = new Set();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) fail("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release artifact IDs must be unique"); ids.add(artifact.id);
    const target = selectionKey(artifact);
    // Keep failed/unhosted future candidates beside the currently published
    // build, without guessing which source commit or array element is newer.
    if (artifact.status === "published") {
      if (published.has(target)) fail("AMBIGUOUS_WALLET_DOWNLOAD", "A target must have exactly one active published artifact");
      published.add(target);
    }
  }
  return freeze({ schemaVersion: 1, product: "ynx-wallet", artifacts });
}

/** Explicit selection only: no user-agent heuristics, fetch, redirect or click. */
export function selectWalletDownload(manifestInput, selector = {}) {
  const manifest = parseWalletDownloadManifest(manifestInput), target = parseSelector(selector);
  if (target.platform === undefined) return choose("platform", PLATFORMS, target);
  if (!PLATFORMS.includes(target.platform)) return unavailable("unsupported-target", target, []);
  if (target.platform !== "web-extension" && target.browser !== undefined) return unavailable("incompatible-target", target, []);
  if (target.platform === "web-extension") {
    if (target.browser === undefined) return choose("browser", ["chromium", "firefox"], target);
    if (!BROWSERS.includes(target.browser) || target.browser === "safari") return unavailable("unsupported-target", target, []);
    if (target.architecture === undefined) target.architecture = "any"; // This format is architecture-independent.
  }
  if (target.architecture === undefined) {
    const choices = [...new Set(Object.values(FORMATS).filter(format => format.platform === target.platform).flatMap(format => format.architectures))].sort();
    return choose("architecture", choices, target);
  }
  if (!ARCHITECTURES.includes(target.architecture)) return unavailable("unsupported-target", target, []);
  const formats = Object.entries(FORMATS).filter(([, format]) => format.platform === target.platform && format.architectures.includes(target.architecture) && format.browser === (target.browser ?? null));
  if (!formats.length) return unavailable("incompatible-target", target, []);
  if (target.installation === undefined) {
    if (formats.length > 1) return choose("installation", formats.map(([name]) => name).sort(), target);
    target.installation = formats[0][0];
  }
  if (!formats.some(([name]) => name === target.installation)) return unavailable("incompatible-target", target, []);
  const exact = manifest.artifacts.filter(artifact => selectionKey(artifact) === selectionKey(target));
  // "universal" is a publisher assertion that BOTH arm64 and x64 are included,
  // on Android (arm64-v8a + x86_64) and macOS. It is not inferred from filenames.
  // A local exact-arch candidate never hides the currently published universal.
  const universal = ["android", "macos"].includes(target.platform) && ["arm64", "x64"].includes(target.architecture)
    ? manifest.artifacts.filter(artifact => selectionKey(artifact) === selectionKey({ ...target, architecture: "universal" })) : [];
  const matches = [...exact, ...universal];
  const published = matches.find(artifact => artifact.status === "published");
  if (published) return freeze({ status: "download", url: published.url, artifact: published });
  const states = [...new Set(matches.map(artifact => artifact.status))].sort();
  return unavailable(states.length ? "not-published" : "no-artifact", target, states);
}

function parseArtifact(input) {
  exactFields(input, FIELDS, "Wallet release artifact");
  const artifact = {
    id: pattern(input.id, /^[a-z0-9][a-z0-9._-]{0,95}$/, "artifact ID"),
    status: input.status,
    sourceCommit: pattern(input.sourceCommit, /^[0-9a-f]{40}$/, "source commit"),
    sha256: pattern(input.sha256, /^[0-9a-f]{64}$/, "artifact SHA-256"),
    bytes: input.bytes,
    filename: pattern(input.filename, /^ynx-wallet-[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/, "official artifact filename"),
    mimeType: input.mimeType, platform: input.platform, architecture: input.architecture,
    browser: input.browser, installation: input.installation, url: input.url, storeStatus: input.storeStatus,
  };
  if (!["published", "local-only", "local-failed"].includes(artifact.status) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.storeStatus !== "not-a-store-release") fail("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact status, positive byte count or direct-file distribution is invalid");
  if (typeof artifact.installation !== "string" || !Object.hasOwn(FORMATS, artifact.installation)) fail("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact installation format is unsupported");
  const format = FORMATS[artifact.installation];
  if (artifact.platform !== format.platform || !format.architectures.includes(artifact.architecture) || artifact.browser !== format.browser || !format.mime.includes(artifact.mimeType) || !artifact.filename.endsWith(format.extension)) fail("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact platform, architecture, browser, filename, MIME and installation format disagree");
  filenameBinding(artifact, format);
  if (artifact.status !== "published") {
    if (artifact.url !== null) fail("UNPUBLISHED_WALLET_DOWNLOAD", "Local-only or failed artifacts cannot expose a download URL");
  } else immutableURL(artifact);
  return artifact;
}

function filenameBinding(artifact, format) {
  if (artifact.filename.includes("..")) fail("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact filename cannot contain dot traversal");
  const stem = artifact.filename.slice(0, -format.extension.length);
  if (!/^ynx-wallet-[a-z0-9][a-z0-9._-]*$/.test(stem)) fail("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact basename must be safe and canonical");
  // Architecture, browser family and source come from the trusted manifest,
  // never filename guessing. Existing Android names contain no arch/platform.
}

function immutableURL(artifact) {
  if (typeof artifact.url !== "string" || artifact.url.length > 1024) fail("INVALID_WALLET_DOWNLOAD_URL", "Published artifact requires an immutable official file URL");
  // Raw matching rejects encoded slashes/dots, ports, credentials, query/fragment,
  // mixed-case authority/hash and normalization tricks before URL parsing.
  const match = /^https:\/\/(www\.ynxweb4\.com|wallet\.ynxweb4\.com|downloads\.ynxweb4\.com)\/(downloads\/(wallet|wallet-web)|wallet)\/sha256-([0-9a-f]{64})\/([A-Za-z0-9._-]+)$/.exec(artifact.url);
  if (!match || match[4] !== artifact.sha256 || match[5] !== artifact.filename || (match[1] === "downloads.ynxweb4.com" ? match[2] !== "wallet" : !match[2].startsWith("downloads/")) || (match[3] === "wallet-web" && artifact.platform !== "web-extension")) fail("INVALID_WALLET_DOWNLOAD_URL", "URL must bind the official host, immutable SHA-256 directory and exact artifact filename");
  const parsed = new URL(artifact.url);
  if (parsed.href !== artifact.url || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) fail("INVALID_WALLET_DOWNLOAD_URL", "Artifact URL must already be canonical");
}

function parseSelector(input) {
  const allowed = ["platform", "architecture", "browser", "installation"];
  exactFields(input, Object.keys(input ?? {}).filter(key => allowed.includes(key)), "Wallet download selector");
  const target = {};
  for (const key of allowed) {
    if (input[key] === undefined || input[key] === null) continue;
    target[key] = pattern(input[key], /^[a-z][a-z0-9-]{0,31}$/, `selected ${key}`);
  }
  return target;
}
function selectionKey(value) { return [value.platform, value.architecture, value.browser ?? "", value.installation].join("|"); }
function choose(field, choices, target) { return freeze({ status: "selection-required", field, choices: [...choices], target: { ...target } }); }
function unavailable(reason, target, candidateStates) { return freeze({ status: "unavailable", reason, target: { ...target }, candidateStates }); }
function pattern(value, expression, label) { if (typeof value !== "string" || !expression.test(value)) fail("INVALID_WALLET_DOWNLOAD_ARTIFACT", `Wallet ${label} is invalid`); return value; }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }

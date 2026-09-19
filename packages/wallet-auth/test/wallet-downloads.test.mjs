import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJSON } from "../src/canonical.js";
import {
  WALLET_DOWNLOAD_MANIFEST_SCHEMA_VERSION, parseWalletDownloadManifest,
  selectWalletDownload, parseProductSessionRegistry, walletConnectionChoices,
} from "../src/index.js";

// Synthetic publisher statements only. These URLs are never fetched and are
// not a real release inventory or evidence of installation/feature readiness.
const SHA = "b".repeat(64), SOURCE = "a".repeat(40);
const tuples = [
  ["apk", "android", "arm64", null, ".apk", "application/vnd.android.package-archive"],
  ["ios-ad-hoc", "ios", "arm64", null, ".ipa", "application/x-itunes-ipa"],
  ["dmg", "macos", "universal", null, ".dmg", "application/x-apple-diskimage"],
  ["exe", "windows", "x64", null, ".exe", "application/vnd.microsoft.portable-executable"],
  ["deb", "linux", "x64", null, ".deb", "application/vnd.debian.binary-package"],
  ["rpm", "linux", "arm64", null, ".rpm", "application/x-rpm"],
  ["appimage", "linux", "x64", null, ".AppImage", "application/vnd.appimage"],
  ["extension-unpacked", "web-extension", "any", "chromium", ".zip", "application/zip"],
  ["extension-temporary", "web-extension", "any", "firefox", ".zip", "application/zip"],
];
function artifact(tuple = tuples[0], changes = {}) {
  const [installation, platform, architecture, browser, suffix, mimeType] = tuple;
  const filename = `ynx-wallet-synthetic-1.0.0${suffix}`;
  return { id: `${platform}-${installation}`, status: "published", sourceCommit: SOURCE, sha256: SHA, bytes: 8192,
    filename, mimeType, platform, architecture, browser, installation,
    url: `https://www.ynxweb4.com/downloads/${platform === "web-extension" ? "wallet-web" : "wallet"}/sha256-${SHA}/${filename}`,
    storeStatus: "not-a-store-release", ...changes };
}
function manifest(...artifacts) { return { schemaVersion: 1, product: "ynx-wallet", artifacts }; }
function selector(a) { return { platform: a.platform, architecture: a.architecture, browser: a.browser, installation: a.installation }; }
function rejected(a, code) {
  assert.throws(() => parseWalletDownloadManifest(manifest(a)), error => error.name === "WalletAuthError" && (!code || error.code === code));
}

for (const tuple of tuples) test(`direct download: explicit ${tuple[0]} tuple and exact immutable file`, () => {
  const a = artifact(tuple), input = manifest(a), before = JSON.stringify(input);
  const result = selectWalletDownload(input, selector(a));
  assert.equal(result.status, "download"); assert.equal(result.url, a.url);
  assert.deepEqual(result.artifact, a); assert.equal(result.artifact.storeStatus, "not-a-store-release");
  assert.equal(JSON.stringify(input), before); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.artifact));
});

test("explicit metadata permits existing Android filename without architecture inference", () => {
  const filename = "ynx-wallet-1.0.3-testnet-preview-3ab8c24c-local-test-signed.apk";
  const a = artifact(tuples[0], { filename, architecture: "universal", url: `https://wallet.ynxweb4.com/downloads/wallet/sha256-${SHA}/${filename}` });
  assert.equal(selectWalletDownload(manifest(a), selector(a)).status, "download");
  assert.equal(selectWalletDownload(manifest(a), { ...selector(a), architecture: "arm64" }).url, a.url);
});

test("only the three official authorities and their exact path forms are accepted", () => {
  const a = artifact();
  for (const root of ["https://www.ynxweb4.com/downloads/wallet", "https://wallet.ynxweb4.com/downloads/wallet", "https://downloads.ynxweb4.com/wallet"]) {
    const next = { ...a, url: `${root}/sha256-${SHA}/${a.filename}` };
    assert.equal(selectWalletDownload(manifest(next), selector(next)).url, next.url);
  }
  for (const root of ["https://www.ynxweb4.com/wallet", "https://wallet.ynxweb4.com/wallet", "https://downloads.ynxweb4.com/downloads/wallet", "https://downloads.ynxweb4.com/wallet-web", "https://www.ynxweb4.com/downloads/wallet-web"]) {
    rejected({ ...a, url: `${root}/sha256-${SHA}/${a.filename}` }, "INVALID_WALLET_DOWNLOAD_URL");
  }
});

test("URL raw-form attacks never become a download", () => {
  const a = artifact(), u = a.url;
  const urls = [
    `${u}?download=1`, `${u}#download`, `${u}?`, `${u}#`, ` ${u}`, `${u}\n`,
    u.replace("https:", "http:"), u.replace("https:", "HTTPS:"), u.replace("www.", "WWW."),
    u.replace("www.ynxweb4.com", "www.ynxweb4.com:443"), u.replace("www.ynxweb4.com", "user@www.ynxweb4.com"),
    u.replace("www.ynxweb4.com", "www.ynxweb4.com@evil.example"), u.replace("www.ynxweb4.com", "www.ynxweb4.com.evil.example"),
    u.replace("www.ynxweb4.com", "ynxweb4.com"), u.replace("www.ynxweb4.com", "www.ynxweb4.com."),
    u.replace("/downloads/", "//downloads/"), u.replace("/downloads/", "/./downloads/"),
    u.replace("/downloads/", "/%64ownloads/"), u.replace("/wallet/", "/wallet%2f"),
    u.replace("/wallet/", "/wallet/../wallet/"), u.replace("/wallet/", "/wallet/%2e%2e/wallet/"),
    u.replace("/downloads/", "\\downloads/"), u.replace(SHA, SHA.toUpperCase()),
    u.replace(SHA, "c".repeat(64)), u.replace(SHA, SHA.slice(1)), u.replace(a.filename, "ynx-wallet-another.apk"),
    u.replace(a.filename, a.filename.replace("-", "%2d")), u.replace(a.filename, `nested/${a.filename}`),
    "https://www.ynxweb4.com/dapp/download", "javascript:alert(1)", "data:application/octet-stream;base64,AA==",
  ];
  for (const url of urls) assert.throws(() => selectWalletDownload(manifest({ ...a, url }), selector(a)), undefined, url);
});

test("not-hosted and failed candidates retain separate states without exposing a URL", () => {
  const local = artifact(tuples[0], { id: "candidate", status: "local-only", url: null });
  const failed = { ...local, id: "failed", status: "local-failed" };
  const result = selectWalletDownload(manifest(local, failed), selector(local));
  assert.equal(result.status, "unavailable"); assert.equal(result.reason, "not-published");
  assert.deepEqual(result.candidateStates, ["local-failed", "local-only"]); assert(!Object.hasOwn(result, "url"));
  for (const status of ["local-only", "local-failed"]) rejected(artifact(tuples[0], { status }), "UNPUBLISHED_WALLET_DOWNLOAD");
  rejected(artifact(tuples[0], { url: null }), "INVALID_WALLET_DOWNLOAD_URL");
});

test("old published and future local candidates coexist without newest or array-order guessing", () => {
  const live = artifact(), future = { ...live, id: "future", sourceCommit: "f".repeat(40), status: "local-only", url: null };
  for (const items of [[live, future], [future, live]]) {
    assert.equal(selectWalletDownload(manifest(...items), selector(live)).artifact.id, live.id);
  }
  assert.throws(() => parseWalletDownloadManifest(manifest(live, { ...live, id: "other" })), { code: "AMBIGUOUS_WALLET_DOWNLOAD" });
  assert.throws(() => parseWalletDownloadManifest(manifest(future, { ...future })), { code: "INVALID_WALLET_DOWNLOAD_MANIFEST" });
});

test("missing selectors request explicit platform, architecture, browser, and Linux package format", () => {
  const m = manifest(...tuples.map(tuple => artifact(tuple)));
  assert.deepEqual(selectWalletDownload(m).choices, ["android", "ios", "linux", "macos", "web-extension", "windows"]);
  assert.equal(selectWalletDownload(m, { platform: "android" }).field, "architecture");
  assert.deepEqual(selectWalletDownload(m, { platform: "android" }).choices, ["arm64", "universal", "x64"]);
  assert.equal(selectWalletDownload(m, { platform: "web-extension" }).field, "browser");
  assert.equal(selectWalletDownload(m, { platform: "web-extension", browser: "chromium" }).artifact.installation, "extension-unpacked");
  assert.deepEqual(selectWalletDownload(m, { platform: "linux", architecture: "x64" }).choices, ["appimage", "deb", "rpm"]);
  assert.equal(selectWalletDownload(m, { platform: "windows", architecture: "x64" }).status, "download");
});

test("RPM is never silently exchanged with DEB or another architecture", () => {
  const a = artifact(tuples[5]), m = manifest(a);
  assert.equal(selectWalletDownload(m, selector(a)).artifact.mimeType, "application/x-rpm");
  assert.equal(selectWalletDownload(m, { ...selector(a), installation: "deb" }).reason, "no-artifact");
  assert.equal(selectWalletDownload(m, { ...selector(a), architecture: "x64" }).reason, "no-artifact");
});

test("declared universal Android remains available for arm64/x64 beside a newer local-only exact candidate", () => {
  const published = artifact(tuples[0], { id: "old-universal", architecture: "universal" });
  const local = artifact(tuples[0], { id: "new-arm64", sourceCommit: "c".repeat(40), status: "local-only", url: null });
  for (const items of [[published, local], [local, published]]) for (const architecture of ["arm64", "x64"]) {
    const result = selectWalletDownload(manifest(...items), { platform: "android", architecture });
    assert.equal(result.status, "download"); assert.equal(result.artifact.id, published.id);
  }
  const result = selectWalletDownload(manifest({ ...published, status: "local-only", url: null }), { platform: "android", architecture: "arm64" });
  assert.equal(result.status, "unavailable"); assert.deepEqual(result.candidateStates, ["local-only"]);
});

test("published exact architecture wins over declared universal independently of manifest order", () => {
  for (const tuple of [tuples[0], tuples[2]]) {
    const universal = artifact(tuple, { id: "universal", architecture: "universal" });
    const exact = artifact(tuple, { id: "arm64", architecture: "arm64", sourceCommit: "c".repeat(40) });
    for (const items of [[universal, exact], [exact, universal]]) {
      assert.equal(selectWalletDownload(manifest(...items), { platform: tuple[1], architecture: "arm64" }).artifact.id, "arm64");
      assert.equal(selectWalletDownload(manifest(...items), { platform: tuple[1], architecture: "x64" }).artifact.id, "universal");
    }
  }
});

test("unsupported targets and empty inventories have clear unavailable results, never a homepage", () => {
  const m = manifest();
  for (const target of [
    { platform: "sunos" }, { platform: "web-extension", browser: "safari" },
    { platform: "android", architecture: "x86" },
    { platform: "ios", architecture: "arm64", installation: "app-store" },
    { platform: "macos", architecture: "arm64", browser: "chromium" },
    { platform: "web-extension", architecture: "arm64", browser: "chromium" },
    { platform: "linux", architecture: "any", installation: "deb" },
    { platform: "android", architecture: "arm64" },
  ]) {
    const result = selectWalletDownload(m, target);
    assert.equal(result.status, "unavailable"); assert(!Object.hasOwn(result, "url"));
  }
  assert.throws(() => selectWalletDownload(m, { platform: "android", downloadUrl: "https://evil.example" }), { code: "UNKNOWN_OR_MISSING_FIELD" });
  for (const bad of [null, [], 1, "android"]) assert.throws(() => selectWalletDownload(m, bad));
});

test("strict artifact fields, hashes, byte bounds, MIME, suffix, architecture and store claims", () => {
  const base = artifact();
  const bad = [
    { sourceCommit: SOURCE.slice(1) }, { sourceCommit: SOURCE.toUpperCase() }, { sourceCommit: 123 },
    { sha256: SHA.slice(1) }, { sha256: SHA.toUpperCase() }, { sha256: `0x${SHA}` },
    { bytes: 0 }, { bytes: -1 }, { bytes: 1.5 }, { bytes: Number.MAX_SAFE_INTEGER + 1 }, { bytes: "8192" },
    { mimeType: "application/zip" }, { mimeType: "application/vnd.android.package-archive; charset=utf-8" },
    { platform: "ios" }, { architecture: "any" }, { browser: "chromium" }, { installation: "exe" }, { installation: ["apk"] },
    { status: "hosted" }, { storeStatus: "published" }, { storeStatus: "google-play" },
    { filename: "ynx-wallet-synthetic.exe" }, { filename: "ynx-wallet-../x.apk" }, { filename: "ynx-wallet-a..b.apk" },
    { filename: "ynx-wallet-a%2eb.apk" }, { filename: "ynx-wallet-a b.apk" }, { filename: "ynx-wallet-Synthetic.apk" },
    { filename: "ynx-wallet-a.apk.exe" }, { filename: "ynx-wallet-a" + "x".repeat(190) + ".apk" },
    { filename: "other-wallet.apk" }, { id: "A" }, { id: "a".repeat(97) },
  ];
  for (const changes of bad) rejected({ ...base, ...changes });
  rejected({ ...base, downloadVerified: true }, "UNKNOWN_OR_MISSING_FIELD");
  const missing = { ...base }; delete missing.sourceCommit; rejected(missing, "UNKNOWN_OR_MISSING_FIELD");
  for (const tuple of tuples.slice(7)) {
    rejected(artifact(tuple, { storeStatus: "chrome-web-store" }));
    rejected(artifact(tuple, { installation: "store" }));
  }
});

test("manifest parsing is bounded, canonical and immutable without inventing installation evidence", () => {
  const m = manifest(artifact()), parsed = parseWalletDownloadManifest(canonicalJSON(m));
  assert.equal(WALLET_DOWNLOAD_MANIFEST_SCHEMA_VERSION, 1); assert.deepEqual(parsed, m);
  assert(Object.isFrozen(parsed)); assert(Object.isFrozen(parsed.artifacts)); assert(Object.isFrozen(parsed.artifacts[0]));
  assert(!Object.hasOwn(parsed.artifacts[0], "actualInstallation"));
  assert.throws(() => parseWalletDownloadManifest(JSON.stringify(m, null, 2)), { code: "INVALID_WALLET_DOWNLOAD_MANIFEST" });
  assert.throws(() => parseWalletDownloadManifest("x".repeat(1_048_577)), { code: "INVALID_WALLET_DOWNLOAD_MANIFEST" });
  for (const input of [null, [], "{", { ...m, schemaVersion: 2 }, { ...m, product: "other" }, { ...m, latest: true }, { ...m, artifacts: Array(129).fill(artifact()) }]) assert.throws(() => parseWalletDownloadManifest(input));
});

test("additive public exports preserve existing registry parsing and legacy connection choices", async () => {
  const registry = JSON.parse(await readFile(new URL("../product-session-registry.json", import.meta.url), "utf8"));
  const before = canonicalJSON(parseProductSessionRegistry(registry));
  const choicesBefore = walletConnectionChoices(registry, "card", { ynxWalletInstalled: false, metaMaskAvailable: false });
  selectWalletDownload(manifest(artifact()), { platform: "android", architecture: "arm64" });
  assert.equal(canonicalJSON(parseProductSessionRegistry(registry)), before);
  assert.deepEqual(walletConnectionChoices(registry, "card", { ynxWalletInstalled: false, metaMaskAvailable: false }), choicesBefore);
  assert.equal(choicesBefore[0].url, "https://www.ynxweb4.com/dapp/download");
  assert.equal(choicesBefore[1].url, "https://metamask.io/download");
  assert.equal(choicesBefore[2].id, "guest");
});

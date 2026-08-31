import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {isAbsolute, join} from "node:path";

const OFFICIAL_URL = "https://web4.ynxweb4.com/video/";
const EXPECTED_SOURCE = "560c467d61e74f7939b8ce527f14316c736b88a7";
const EXPECTED = Object.freeze({
  "": {bytes: 3834, sha256: "48ce327ed86de9ccdac94072cc561bd369ff752166613ca436334d97a7c2f557"},
  "app.js": {bytes: 21654, sha256: "3f94db9d7e9f4607d08c84655de77eb7812c7769e16036542c0d63b906b1b1cd"},
  "wallet-connection.js": {bytes: 11515, sha256: "b02ff55fbfd903845cf20c36bd77eb0ab77341fcbf3d3712d25816426c4f7454"},
  "runtime-manifest.json": {bytes: 2621, sha256: "a354125ec95c74a5aa6d870061397854cb3d4f21b81d0c67e75688ec41f3d310"}
});
const FORBIDDEN_METHODS = new Set(["eth_requestAccounts", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]);

const targetUrl = process.env.YNX_VIDEO_PUBLIC_URL || OFFICIAL_URL;
const expectedSource = process.env.YNX_VIDEO_EXPECTED_SOURCE_COMMIT || EXPECTED_SOURCE;
const evidenceDir = process.env.YNX_VIDEO_BROWSER_EVIDENCE_DIR;
const profileDir = process.env.YNX_VIDEO_BROWSER_PROFILE_DIR;
const executablePath = process.env.YNX_VIDEO_CHROMIUM_PATH;
assert.equal(targetUrl, OFFICIAL_URL, "only the canonical Video public URL is allowed");
assert.equal(expectedSource, EXPECTED_SOURCE, "source binding mismatch");
assert.ok(evidenceDir && isAbsolute(evidenceDir), "absolute evidence directory required");
assert.ok(profileDir && isAbsolute(profileDir), "absolute persistent browser profile required");
assert.ok(executablePath && isAbsolute(executablePath), "absolute Chromium executable required");
await mkdir(evidenceDir, {recursive: false});

const raw = {};
for (const [relative, expected] of Object.entries(EXPECTED)) {
  const response = await fetch(new URL(relative, targetUrl), {redirect: "error", cache: "no-store"});
  assert.equal(response.status, 200, `${relative || "root"} must return 200`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(bytes.length, expected.bytes, `${relative || "root"} byte mismatch`);
  assert.equal(sha256, expected.sha256, `${relative || "root"} SHA mismatch`);
  raw[relative || "root"] = {status: response.status, bytes: bytes.length, sha256, headers: Object.fromEntries(response.headers)};
  if (relative === "runtime-manifest.json") {
    const manifest = JSON.parse(bytes.toString("utf8"));
    assert.equal(manifest.sourceCommit, EXPECTED_SOURCE, "runtime manifest source mismatch");
    assert.equal(manifest.entrypoint, "server.mjs", "runtime entrypoint mismatch");
  }
}

let chromium;
try {
  ({chromium} = await import("playwright"));
} catch {
  throw new Error("Playwright Chromium runtime is required by the authorized hosted/browser executor");
}

const initProviders = () => {
  window.__ynxVideoEvidenceMethods = [];
  const provider = (identity) => ({
    ...identity,
    request: async ({method}) => {
      window.__ynxVideoEvidenceMethods.push(method);
      throw Object.assign(new Error("Sensitive provider calls are forbidden in non-sensitive discovery evidence"), {code: 4100});
    },
    on() {},
    removeListener() {}
  });
  const ynx = provider({isYNXWallet: true, isMetaMask: false});
  const metaMask = provider({isYNXWallet: false, isMetaMask: true});
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {detail: {info: {uuid: "evidence-ynx", name: "YNX Wallet", rdns: "com.ynx.wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"}, provider: ynx}}));
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {detail: {info: {uuid: "evidence-metamask", name: "MetaMask", rdns: "io.metamask", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"}, provider: metaMask}}));
  });
};

async function launchAndInspect(label) {
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: true,
    args: ["--no-first-run", "--disable-default-apps"]
  });
  const consoleErrors = [];
  try {
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    while (context.pages().length > 1) await context.pages().at(-1).close();
    await page.addInitScript(initProviders);
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.goto(targetUrl, {waitUntil: "networkidle", timeout: 30000});
    await page.locator("#signin").waitFor({state: "visible"});
    assert.equal(context.pages().length, 1, `${label} must keep one top-level page`);
    assert.equal(page.url(), OFFICIAL_URL, `${label} URL drifted`);
    assert.equal(await page.title(), "YNX Video");
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.match(await page.locator("#session").innerText(), /Guest playback is available/);
    assert.equal(await page.locator("#revoke").isHidden(), true);
    assert.equal(await page.locator("#wallet-chooser").evaluate((node) => node.open), false);
    await page.locator("#signin").click();
    await page.locator("#wallet-chooser").waitFor({state: "visible"});
    const choices = await page.locator("#wallet-choices button").evaluateAll((nodes) => nodes.map((node) => ({text: node.textContent, walletBrand: node.dataset.walletBrand, walletRole: node.dataset.walletRole})));
    assert.equal(choices.length, 2, "chooser must show exactly two providers");
    assert.deepEqual(choices.map((choice) => choice.walletBrand).sort(), ["MetaMask", "YNX Wallet"]);
    assert.deepEqual(choices.map((choice) => choice.walletRole).sort(), ["metamask", "ynx"]);
    const methods = await page.evaluate(() => window.__ynxVideoEvidenceMethods);
    assert.deepEqual(methods, [], "discovery evidence must not call provider.request");
    assert.equal(methods.some((method) => FORBIDDEN_METHODS.has(method)), false);
    await page.locator("#wallet-chooser-close").click();
    assert.equal(await page.locator("#wallet-chooser").evaluate((node) => node.open), false);
    assert.equal(consoleErrors.length, 0, `${label} console errors: ${consoleErrors.join(" | ")}`);
    const screenshot = join(evidenceDir, `${label}.png`);
    await page.screenshot({path: screenshot, fullPage: true});
    return {label, url: page.url(), title: await page.title(), topLevelPages: context.pages().length, consoleErrors, choices, methods, screenshot};
  } finally {
    await context.close();
  }
}

const cold = await launchAndInspect("cold-launch");
const second = await launchAndInspect("second-launch");
const evidence = {
  schemaVersion: "ynx-video-public-browser-evidence/1",
  generatedAt: new Date().toISOString(),
  targetUrl,
  expectedSource,
  raw,
  persistentProfileReused: true,
  cold,
  second,
  accountRequested: false,
  signatureRequested: false,
  transactionRequested: false,
  productCompleteClaimed: false
};
await writeFile(join(evidenceDir, "video-public-browser-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, {flag: "wx"});
console.log(JSON.stringify({status: "PASS_NON_SENSITIVE_SOURCE_BOUND_BROWSER", targetUrl, expectedSource, evidenceDir}));

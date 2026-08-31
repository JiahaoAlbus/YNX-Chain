import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const evidenceRoot = path.join(root, "evidence", "ui", "current-accessibility");
const chromeExecutable = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const checks = [];
const screenshots = [];
const browserExceptions = [];
const startedAt = new Date().toISOString();
const sourceCommit = git(["rev-parse", "HEAD"]);
const sourceDirtyAtStart = Boolean(git(["status", "--porcelain"]));
let chromeVersion = "unknown";
let server;
let chrome;
let client;
let profileDirectory;

function git(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedOutput(child) {
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12000);
  });
  return () => output;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function poll(description, operation, { timeout = 15000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`${description} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

class CDPClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("CDP WebSocket failed to open.")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  on(method, listener) {
    const values = this.listeners.get(method) || [];
    values.push(listener);
    this.listeners.set(method, values);
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

function record(id, passed, evidence) {
  checks.push({ id, status: passed ? "passed" : "failed", evidence });
  return passed;
}

async function evaluate(expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Runtime evaluation failed.";
    throw new Error(description);
  }
  return response.result.value;
}

async function waitForApp() {
  await poll("YNX Developer bootstrap", async () => evaluate(`(() => ({
    ready: document.readyState === "complete",
    locales: document.querySelectorAll("#locale-select option").length,
    tabs: document.querySelectorAll('.panel-tab[role="tab"]').length
  }))()` ).then((value) => value.ready && value.locales === 12 && value.tabs === 8));
}

async function configureStoredState({ theme = "light", locale = "en", textSize = "normal" } = {}) {
  await evaluate(`(() => {
    localStorage.setItem("ynx.developer.theme", ${JSON.stringify(theme)});
    localStorage.setItem("ynx.developer.locale", ${JSON.stringify(locale)});
    localStorage.setItem("ynx.developer.text-size", ${JSON.stringify(textSize)});
    location.reload();
    return true;
  })()`);
  await waitForApp();
}

async function setViewport(width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  await evaluate("dispatchEvent(new Event('resize')); true");
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function key(key, { shift = false } = {}) {
  const codes = { Tab: 9, Enter: 13, ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35 };
  const modifiers = shift ? 8 : 0;
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], modifiers });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], modifiers });
  await new Promise((resolve) => setTimeout(resolve, 60));
}

async function capture(name, metadata) {
  const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  const filePath = path.join(evidenceRoot, name);
  await writeFile(filePath, bytes);
  screenshots.push({
    path: path.relative(repositoryRoot, filePath),
    sha256: sha256(bytes),
    bytes: bytes.length,
    ...metadata,
  });
}

async function desktopAudit() {
  await setViewport(1440, 900);
  await configureStoredState({ theme: "light", locale: "en", textSize: "normal" });

  const layout = await evaluate(`(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    theme: document.documentElement.dataset.theme,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir
  }))()`);
  record("desktop-light-layout", layout.width === 1440 && layout.scrollWidth <= layout.width && layout.theme === "light" && layout.lang === "en" && layout.dir === "ltr", layout);
  await capture("desktop-light-1440x900.png", { viewport: { width: 1440, height: 900 }, theme: "light", locale: "en" });

  await evaluate(`(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
    return document.activeElement.tagName;
  })()`);
  await key("Tab");
  const firstFocus = await evaluate(`(() => ({
    tag: document.activeElement?.tagName,
    id: document.activeElement?.id,
    className: document.activeElement?.className,
    text: document.activeElement?.textContent?.trim()
  }))()`);
  record("keyboard-first-focus-skip-link", String(firstFocus.className).split(/\s+/).includes("skip"), firstFocus);
  await key("Enter");
  const skipTarget = await evaluate(`(() => ({ id: document.activeElement?.id, label: document.activeElement?.getAttribute("aria-label") }))()`);
  record("skip-link-focuses-editor", skipTarget.id === "editor" && skipTarget.label === "Source editor", skipTarget);

  await evaluate(`(() => {
    const first = document.querySelector('.panel-tab[data-panel="problems"]');
    first.click();
    first.focus();
    return true;
  })()`);
  await key("ArrowRight");
  const rovingTabs = await evaluate(`(() => ({
    focused: document.activeElement?.dataset?.panel,
    selected: [...document.querySelectorAll(".panel-tab")].filter((item) => item.getAttribute("aria-selected") === "true").map((item) => item.dataset.panel),
    tabStops: [...document.querySelectorAll(".panel-tab")].filter((item) => item.tabIndex === 0).map((item) => item.dataset.panel),
    visiblePanels: [...document.querySelectorAll(".panel-body")].filter((item) => !item.hidden).map((item) => item.id)
  }))()`);
  record("panel-tabs-roving-keyboard", rovingTabs.focused === "output" && rovingTabs.selected.length === 1 && rovingTabs.selected[0] === "output" && rovingTabs.tabStops.length === 1 && rovingTabs.visiblePanels.length === 1 && rovingTabs.visiblePanels[0] === "panel-output", rovingTabs);

  await evaluate(`(() => {
    const tab = document.querySelector('.panel-tab[data-panel="api-studio"]');
    tab.click();
    tab.focus();
    return true;
  })()`);
  const axResult = await client.send("Accessibility.getFullAXTree");
  const ax = axResult.nodes.map((node) => ({
    role: node.role?.value || "",
    name: node.name?.value || "",
    live: node.properties?.find((property) => property.name === "live")?.value?.value || "",
  }));
  const roles = new Set(ax.map((node) => node.role.toLowerCase()));
  const names = new Set(ax.map((node) => node.name));
  const semantics = {
    roles: [...roles].filter((role) => ["navigation", "main", "tablist", "tab", "textbox", "status"].includes(role)),
    sourceEditorNamed: names.has("Source editor"),
    openAPINamed: names.has("OpenAPI JSON"),
    liveRegions: ax.filter((node) => node.live).slice(0, 10),
  };
  record("screen-reader-accessibility-tree", ["navigation", "main", "tablist", "tab", "textbox", "status"].every((role) => roles.has(role)) && semantics.sourceEditorNamed && semantics.openAPINamed, semantics);

  const focusStyle = await evaluate(`(() => {
    const tab = document.querySelector('.panel-tab[data-panel="api-studio"]');
    const style = getComputedStyle(tab);
    return { panel: tab.dataset.panel, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
  })()`);
  record("visible-focus-indicator", focusStyle.outlineStyle !== "none" && Number.parseFloat(focusStyle.outlineWidth) >= 3, focusStyle);
  await capture("keyboard-focus-api-studio-1440x900.png", { viewport: { width: 1440, height: 900 }, theme: "light", locale: "en", focus: "api-studio-tab" });

  await evaluate("document.querySelector('#theme-toggle').click(); true");
  const dark = await evaluate(`(() => ({
    theme: document.documentElement.dataset.theme,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.body).backgroundColor,
    foreground: getComputedStyle(document.body).color
  }))()`);
  record("desktop-dark-theme", dark.theme === "dark" && dark.colorScheme === "dark" && dark.background !== dark.foreground, dark);
  await capture("desktop-dark-1440x900.png", { viewport: { width: 1440, height: 900 }, theme: "dark", locale: "en" });

  await client.send("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reducedMotion = await evaluate(`(() => {
    const sidebar = getComputedStyle(document.querySelector(".sidebar"));
    const status = getComputedStyle(document.querySelector(".status-dot"));
    return {
      mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      sidebarTransitionDuration: sidebar.transitionDuration,
      statusAnimationName: status.animationName,
      statusAnimationDuration: status.animationDuration
    };
  })()`);
  record("reduced-motion-disables-animation", reducedMotion.mediaMatches && reducedMotion.sidebarTransitionDuration === "0s" && reducedMotion.statusAnimationName === "none" && reducedMotion.statusAnimationDuration === "0s", reducedMotion);
  await client.send("Emulation.setEmulatedMedia", { media: "screen", features: [] });
}

async function mobileAudit() {
  await setViewport(390, 844);
  await configureStoredState({ theme: "light", locale: "en", textSize: "normal" });
  const mobile = await evaluate(`(() => {
    const sidebar = document.querySelector(".sidebar");
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      body: { clientWidth: document.body.clientWidth, scrollWidth: document.body.scrollWidth },
      shell: { left: shell.left, right: shell.right, width: shell.width },
      sidebar: { inert: sidebar.inert, ariaHidden: sidebar.getAttribute("aria-hidden"), open: sidebar.classList.contains("mobile-open") },
      apiColumns: getComputedStyle(document.querySelector(".api-grid")).gridTemplateColumns
    };
  })()`);
  record("mobile-390-no-page-overflow", mobile.viewport.width === 390 && mobile.document.scrollWidth <= mobile.document.clientWidth && mobile.body.scrollWidth <= mobile.body.clientWidth && mobile.shell.left >= 0 && mobile.shell.right <= 390.5, mobile);
  record("mobile-closed-drawers-inert", mobile.sidebar.inert === true && mobile.sidebar.ariaHidden === "true" && mobile.sidebar.open === false, mobile.sidebar);
  record("mobile-api-studio-single-column", !mobile.apiColumns.includes(" "), { gridTemplateColumns: mobile.apiColumns });
  await capture("mobile-light-390x844.png", { viewport: { width: 390, height: 844 }, theme: "light", locale: "en" });

  await evaluate(`(() => {
    const select = document.querySelector("#locale-select");
    select.value = "ar";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector('.panel-tab[data-panel="api-studio"]').click();
    return true;
  })()`);
  const rtl = await evaluate(`(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    topbarDirection: getComputedStyle(document.querySelector(".topbar")).direction,
    apiDirection: getComputedStyle(document.querySelector(".api-studio")).direction,
    editorDirection: getComputedStyle(document.querySelector("#editor")).direction,
    apiSpecDirection: getComputedStyle(document.querySelector("#api-spec")).direction,
    translatedNewProject: document.querySelector("#create-project").textContent.trim(),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }))()`);
  record("arabic-rtl-with-code-ltr", rtl.lang === "ar" && rtl.dir === "rtl" && rtl.topbarDirection === "rtl" && rtl.apiDirection === "rtl" && rtl.editorDirection === "ltr" && rtl.apiSpecDirection === "ltr" && rtl.translatedNewProject === "مشروع جديد" && rtl.scrollWidth <= rtl.clientWidth, rtl);
  await capture("mobile-arabic-rtl-390x844.png", { viewport: { width: 390, height: 844 }, theme: "light", locale: "ar" });

  await evaluate(`(() => {
    const select = document.querySelector("#locale-select");
    select.value = "en";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#text-size-toggle").click();
    return true;
  })()`);
  const largeText = await evaluate(`(() => ({
    mode: document.documentElement.dataset.textSize,
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    controlHeight: getComputedStyle(document.querySelector("#create-project")).minHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }))()`);
  record("dynamic-large-text-390", largeText.mode === "large" && Number.parseFloat(largeText.rootFontSize) >= 16 && Number.parseFloat(largeText.controlHeight) >= 38 && largeText.scrollWidth <= largeText.clientWidth, largeText);
  await capture("mobile-large-text-390x844.png", { viewport: { width: 390, height: 844 }, theme: "light", locale: "en", textSize: "large" });

  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  const zoom = await client.send("Page.getLayoutMetrics");
  const zoomEvidence = {
    visualViewportScale: zoom.visualViewport.scale,
    visualViewportWidth: zoom.visualViewport.clientWidth,
    layoutViewportWidth: zoom.layoutViewport.clientWidth,
  };
  record("page-scale-200-percent", Math.abs(zoom.visualViewport.scale - 2) < 0.01, zoomEvidence);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  assert.equal(sourceDirtyAtStart, false, "Accessibility evidence must start from a clean source tree.");
  const appPort = await freePort();
  const cdpPort = await freePort();
  const appURL = `http://127.0.0.1:${appPort}`;
  profileDirectory = await mkdtemp(path.join(os.tmpdir(), "ynx-developer-accessibility-"));

  server = spawn(process.execPath, ["scripts/server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(appPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverOutput = boundedOutput(server);
  await poll("YNX Developer local server", async () => {
    if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}: ${serverOutput()}`);
    const response = await fetch(appURL);
    return response.ok;
  });

  chrome = spawn(chromeExecutable, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-features=Translate,MediaRouter",
    "--force-device-scale-factor=1",
    "--no-default-browser-check",
    "--no-first-run",
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const chromeOutput = boundedOutput(chrome);
  const target = await poll("Chrome DevTools target", async () => {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}: ${chromeOutput()}`);
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  }, { timeout: 20000 });

  client = new CDPClient(target.webSocketDebuggerUrl);
  await client.open();
  client.on("Runtime.exceptionThrown", (event) => browserExceptions.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || "Unknown browser exception"));
  await Promise.all([
    client.send("Page.enable"),
    client.send("Runtime.enable"),
    client.send("Accessibility.enable"),
  ]);
  chromeVersion = (await client.send("Browser.getVersion")).product;
  await client.send("Page.navigate", { url: appURL });
  await waitForApp();

  await desktopAudit();
  await mobileAudit();
  record("browser-runtime-exceptions", browserExceptions.length === 0, { exceptions: browserExceptions });
}

let fatalError;
try {
  await main();
} catch (error) {
  fatalError = error;
  record("audit-harness-completed", false, { message: error.message, stack: error.stack });
} finally {
  try { client?.close(); } catch {}
  try { chrome?.kill("SIGTERM"); } catch {}
  try { server?.kill("SIGTERM"); } catch {}
  if (profileDirectory) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 }); break; }
      catch (error) { if (attempt === 7) throw error; await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1))); }
    }
  }

  const failed = checks.filter((check) => check.status === "failed");
  const evidence = {
    schemaVersion: "1.0",
    productNumber: "11",
    productName: "YNX Developer / AI Build",
    sourceCommit,
    sourceDirtyAtStart,
    startedAt,
    completedAt: new Date().toISOString(),
    browser: chromeVersion,
    harness: "Chrome DevTools Protocol via Node.js built-in WebSocket",
    status: failed.length === 0 && !fatalError ? "passed" : "failed",
    checks,
    screenshots,
    truthBoundaries: {
      currentSourceBrowserEvidence: true,
      installedDesktopEvidence: false,
      independentAccessibilityAudit: false,
      publicDeployment: false,
      productionSigned: false,
    },
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(path.join(evidenceRoot, "accessibility-audit.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  if (fatalError) console.error(fatalError.stack || fatalError.message);
  if (failed.length) console.error(`Accessibility audit failed: ${failed.map((check) => check.id).join(", ")}`);
  else console.log(`Accessibility audit passed: ${checks.length} checks, ${screenshots.length} screenshots, source ${sourceCommit}.`);
  if (fatalError || failed.length) process.exitCode = 1;
}

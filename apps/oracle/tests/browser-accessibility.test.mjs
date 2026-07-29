import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import fs from "node:fs";
import {mkdtemp, readFile, rm, stat} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";
import {setTimeout as delay} from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = path.join(root, "dist", "client");
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

class CDPClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, {once: true});
      this.socket.addEventListener("error", reject, {once: true});
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Chrome DevTools connection closed"));
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: Chrome DevTools response timed out after 15000ms`));
      }, 15000);
      const settle = (callback) => (value) => {
        clearTimeout(timer);
        callback(value);
      };
      this.pending.set(id, {resolve: settle(resolve), reject: settle(reject), method});
      try {
        this.socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  dispatch(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
  }

  close() {
    this.socket?.close();
  }
}

function contentType(file) {
  const extension = path.extname(file);
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  })[extension] ?? "application/octet-stream";
}

async function readAsset(pathname) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(clientRoot, decoded);
  if (file !== clientRoot && !file.startsWith(`${clientRoot}${path.sep}`)) return null;
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    return {body: await readFile(file), type: contentType(file)};
  } catch {
    return null;
  }
}

async function startProductServer() {
  const workerUrl = pathToFileURL(path.join(root, "dist", "server", "index.js"));
  workerUrl.searchParams.set("browser-a11y", `${process.pid}-${Date.now()}`);
  const {default: worker} = await import(workerUrl.href);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const asset = await readAsset(url.pathname);
      if (asset) {
        response.writeHead(200, {"content-type": asset.type, "cache-control": "no-store"});
        response.end(asset.body);
        return;
      }
      const origin = `http://127.0.0.1:${server.address().port}`;
      const productResponse = await worker.fetch(
        new Request(`${origin}${url.pathname}${url.search}`, {headers: {accept: request.headers.accept ?? "text/html"}}),
        {
          ASSETS: {
            fetch: async (assetRequest) => {
              const candidate = await readAsset(new URL(assetRequest.url).pathname);
              return candidate
                ? new Response(candidate.body, {status: 200, headers: {"content-type": candidate.type}})
                : new Response("Not found", {status: 404});
            },
          },
        },
        {waitUntil() {}, passThroughOnException() {}},
      );
      const headers = Object.fromEntries(productResponse.headers.entries());
      response.writeHead(productResponse.status, headers);
      response.end(Buffer.from(await productResponse.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, {"content-type": "text/plain; charset=utf-8"});
      response.end(error instanceof Error ? error.stack : String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    }),
  };
}

async function startChrome() {
  const executable = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  assert(executable, "Google Chrome or Chromium is required for browser accessibility evidence");
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "ynx-oracle-chrome-"));
  const child = spawn(executable, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=Translate,MediaRouter",
    "--disable-sync",
    "--metrics-recording-only",
    "about:blank",
  ], {stdio: ["ignore", "ignore", "pipe"]});
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
      if (!stopped && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    await rm(userDataDir, {recursive: true, force: true});
  };
  const activePortFile = path.join(userDataDir, "DevToolsActivePort");
  let active;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try {
      const [port, websocketPath] = (await readFile(activePortFile, "utf8")).trim().split(/\r?\n/);
      if (port && websocketPath) {
        active = {port, websocketPath};
        break;
      }
    } catch {
      // Chrome has not exposed DevTools yet.
    }
    await delay(25);
  }
  if (!active) {
    const diagnostic = stderr.slice(-2000);
    await stop();
    throw new Error(`Chrome did not expose DevTools within 15000ms; stderr=${diagnostic}`);
  }
  return {
    websocketUrl: `ws://127.0.0.1:${active.port}${active.websocketPath}`,
    close: stop,
  };
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true}, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}

async function waitFor(client, sessionId, expression, description) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await evaluate(client, sessionId, expression)) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function press(client, sessionId, key, code, keyCode) {
  const params = {key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode};
  await client.send("Input.dispatchKeyEvent", {type: "keyDown", ...params}, sessionId);
  await client.send("Input.dispatchKeyEvent", {type: "keyUp", ...params}, sessionId);
}

test("real Chrome verifies Oracle keyboard, RTL, reduced-motion, theme, large-text, and 390px behavior", {timeout: 120000}, async () => {
  const product = await startProductServer();
  const preflight = await fetch(`${product.origin}/oracle`, {
    headers: {accept: "text/html"},
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(preflight.status, 200, "Oracle SSR preflight must succeed before browser evidence starts");
  await preflight.arrayBuffer();
  const chrome = await startChrome();
  const client = new CDPClient(chrome.websocketUrl);
  try {
    await client.connect();
    const {targetId} = await client.send("Target.createTarget", {url: "about:blank"});
    const {sessionId} = await client.send("Target.attachToTarget", {targetId, flatten: true});
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Page.enable", {}, sessionId);
    await client.send("Accessibility.enable", {}, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 390,
      screenHeight: 844,
    }, sessionId);
    await client.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [
        {name: "prefers-reduced-motion", value: "reduce"},
        {name: "prefers-color-scheme", value: "dark"},
      ],
    }, sessionId);
    client.dispatch("Page.navigate", {url: `${product.origin}/oracle`}, sessionId);
    await waitFor(
      client,
      sessionId,
      "document.readyState === 'complete' && document.querySelector('.controls select') && document.documentElement.dataset.theme === 'auto' && getComputedStyle(document.body).backgroundColor === 'rgb(16, 18, 16)'",
      "the hydrated Oracle console with dark auto-theme media applied",
    );

    const baseline = await evaluate(client, sessionId, `(() => {
      const selectors = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const focusables = [...document.querySelectorAll(selectors)].filter((element) => !element.hidden && getComputedStyle(element).visibility !== 'hidden');
      const endpoint = document.querySelector('.endpoint-copy');
      return {
        semanticCounts: {main: document.querySelectorAll('main').length, header: document.querySelectorAll('header').length, footer: document.querySelectorAll('footer').length, h1: document.querySelectorAll('h1').length},
        firstFocusableClass: focusables[0]?.className ?? '',
        controlLabels: [...document.querySelectorAll('select,input')].map((control) => ({labels: control.labels?.length ?? 0, labelText: [...(control.labels ?? [])].map((label) => label.textContent.trim()).join(' ')})),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        layoutViewportWidth: window.innerWidth,
        contentViewportWidth: document.documentElement.clientWidth,
        endpointLive: endpoint?.getAttribute('aria-live'),
        endpointRole: endpoint?.getAttribute('role'),
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        h1FontSize: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
        positiveTabIndex: [...document.querySelectorAll('[tabindex]')].filter((element) => Number(element.getAttribute('tabindex')) > 0).length,
      };
    })()`);
    assert.deepEqual(baseline.semanticCounts, {main: 1, header: 1, footer: 1, h1: 1});
    assert.match(baseline.firstFocusableClass, /skip/);
    assert(baseline.controlLabels.every((entry) => entry.labels === 1 && entry.labelText.length > 0), "every native form control needs one accessible label");
    assert(baseline.horizontalOverflow <= 0, `390px viewport overflowed by ${baseline.horizontalOverflow}px`);
    assert.equal(baseline.layoutViewportWidth, 390);
    assert(
      baseline.contentViewportWidth > 0 && baseline.contentViewportWidth <= baseline.layoutViewportWidth,
      `invalid content viewport width ${baseline.contentViewportWidth}px for ${baseline.layoutViewportWidth}px layout viewport`,
    );
    assert.equal(baseline.endpointRole, "status");
    assert.equal(baseline.endpointLive, "polite");
    assert.equal(baseline.reducedMotion, true);
    assert.equal(baseline.scrollBehavior, "auto");
    assert.equal(baseline.bodyBackground, "rgb(16, 18, 16)");
    assert.equal(baseline.positiveTabIndex, 0);

    const {nodes} = await client.send("Accessibility.getFullAXTree", {}, sessionId);
    const namedInteractive = nodes.filter((node) => !node.ignored && ["link", "button", "combobox", "textbox"].includes(node.role?.value));
    assert(namedInteractive.length >= 4, "expected interactive nodes in the Chrome accessibility tree");
    for (const node of namedInteractive) assert(String(node.name?.value ?? "").trim(), `${node.role.value} is missing an accessible name`);

    await evaluate(client, sessionId, "document.activeElement?.blur() || true");
    await press(client, sessionId, "Tab", "Tab", 9);
    const skipFocus = await evaluate(client, sessionId, `(() => {
      const active = document.activeElement;
      const style = getComputedStyle(active);
      return {className: active.className, transform: style.transform, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle};
    })()`);
    assert.match(skipFocus.className, /skip/);
    assert(["none", "matrix(1, 0, 0, 1, 0, 0)"].includes(skipFocus.transform), `skip link remained translated: ${skipFocus.transform}`);
    assert.notEqual(skipFocus.outlineStyle, "none");
    assert.notEqual(skipFocus.outlineWidth, "0px");
    const keyboardOrder = [];
    for (let index = 0; index < 3; index += 1) {
      await press(client, sessionId, "Tab", "Tab", 9);
      keyboardOrder.push(await evaluate(client, sessionId, `(() => {
        const active = document.activeElement;
        const style = getComputedStyle(active);
        return {tag: active.tagName, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth};
      })()`));
    }
    assert.deepEqual(keyboardOrder.map((entry) => entry.tag), ["A", "SELECT", "SELECT"]);
    for (const entry of keyboardOrder) {
      assert.notEqual(entry.outlineStyle, "none");
      assert.notEqual(entry.outlineWidth, "0px");
    }

    await evaluate(client, sessionId, "document.querySelector('.skip').focus(); true");
    await press(client, sessionId, "Enter", "Enter", 13);
    await waitFor(client, sessionId, "document.activeElement?.id === 'content'", "skip-link focus transfer");

    await evaluate(client, sessionId, `(() => {
      const select = document.querySelector('.controls select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'ar');
      select.dispatchEvent(new Event('change', {bubbles: true}));
      return true;
    })()`);
    await waitFor(client, sessionId, "document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl'", "Arabic RTL state");
    const rtl = await evaluate(client, sessionId, `(() => {
      const probe = document.createElement('div');
      probe.className = 'quality-grid';
      probe.innerHTML = '<span>probe</span>';
      document.body.append(probe);
      const style = getComputedStyle(probe.firstElementChild);
      const result = {
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        skip: document.querySelector('.skip').textContent.trim(),
        paddingInlineEnd: style.paddingInlineEnd,
        paddingLeft: style.paddingLeft,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
      probe.remove();
      return result;
    })()`);
    assert.equal(rtl.lang, "ar");
    assert.equal(rtl.dir, "rtl");
    assert.equal(rtl.skip, "انتقل إلى المحتوى");
    assert.equal(rtl.paddingInlineEnd, "8px");
    assert.equal(rtl.paddingLeft, "8px");
    assert(rtl.horizontalOverflow <= 0, `Arabic RTL overflowed by ${rtl.horizontalOverflow}px`);

    await evaluate(client, sessionId, "document.documentElement.dataset.textScale = '200'; true");
    await waitFor(client, sessionId, "getComputedStyle(document.body).fontSize === '32px'", "200% text-scale style recalculation");
    const largeText = await evaluate(client, sessionId, `(() => {
      const h1 = document.querySelector('h1');
      const textScaleRules = [...document.styleSheets].flatMap((sheet) => {
        try { return [...sheet.cssRules].map((rule) => rule.cssText).filter((text) => text.includes('data-text-scale')); } catch { return []; }
      });
      return {
        textScaleAttribute: document.documentElement.getAttribute('data-text-scale'),
        textScaleRules,
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        bodyFontSize: getComputedStyle(document.body).fontSize,
        h1FontSize: parseFloat(getComputedStyle(h1).fontSize),
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        controlsWidth: document.querySelector('.controls').getBoundingClientRect().width,
        viewportWidth: document.documentElement.clientWidth,
      };
    })()`);
    assert(largeText.h1FontSize >= baseline.h1FontSize * 1.5, `large text did not scale: h1 ${baseline.h1FontSize} -> ${largeText.h1FontSize}; root=${largeText.rootFontSize}; body=${largeText.bodyFontSize}; attr=${largeText.textScaleAttribute}; rules=${JSON.stringify(largeText.textScaleRules)}`);
    assert(largeText.horizontalOverflow <= 0, `200% root text overflowed by ${largeText.horizontalOverflow}px`);
    assert(largeText.controlsWidth <= largeText.viewportWidth);

    await evaluate(client, sessionId, `(() => {
      delete document.documentElement.dataset.textScale;
      const themeSelect = document.querySelectorAll('.controls select')[1];
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(themeSelect, 'light');
      themeSelect.dispatchEvent(new Event('change', {bubbles: true}));
      return true;
    })()`);
    await waitFor(client, sessionId, "document.documentElement.dataset.theme === 'light' && getComputedStyle(document.body).backgroundColor === 'rgb(242, 240, 233)'", "light theme state and computed colors");
    const lightTheme = await evaluate(client, sessionId, `({dataset: document.documentElement.dataset.theme, background: getComputedStyle(document.body).backgroundColor})`);
    assert.deepEqual(lightTheme, {dataset: "light", background: "rgb(242, 240, 233)"});

    await evaluate(client, sessionId, `(() => {
      const themeSelect = document.querySelectorAll('.controls select')[1];
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(themeSelect, 'dark');
      themeSelect.dispatchEvent(new Event('change', {bubbles: true}));
      return true;
    })()`);
    await waitFor(client, sessionId, "document.documentElement.dataset.theme === 'dark' && getComputedStyle(document.body).backgroundColor === 'rgb(16, 18, 16)'", "dark theme state and computed colors");
    const darkTheme = await evaluate(client, sessionId, `({dataset: document.documentElement.dataset.theme, background: getComputedStyle(document.body).backgroundColor})`);
    assert.deepEqual(darkTheme, {dataset: "dark", background: "rgb(16, 18, 16)"});
  } finally {
    client.close();
    await chrome.close();
    await product.close();
  }
});

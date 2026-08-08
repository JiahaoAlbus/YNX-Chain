const { spawn } = require("node:child_process");
const { once } = require("node:events");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "../../..");
const portOffset = process.pid % 10_000;
const port = 20_000 + portOffset;
const walletPort = 40_000 + portOffset;
const base = `http://127.0.0.1:${port}`;
const artifact = path.join(__dirname, "artifacts");
fs.mkdirSync(artifact, { recursive: true });
const dataDir = fs.mkdtempSync("/tmp/ynx-calendar-browser-");

const wallet = http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let proof;
      try {
        proof = JSON.parse(Buffer.concat(chunks).toString());
      } catch {}
      const valid =
        req.method === "POST" &&
        req.url === "/v1/wallet/sessions/complete" &&
        proof?.authorizationRequest &&
        proof?.walletApproval &&
        proof?.gatewayCompletion;
      if (!valid) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end('{"error":"invalid central proof"}');
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          schemaVersion: 1,
          stateDigest: "s".repeat(64),
          result: {
            verifierVersion: "wallet-auth-v1",
            sessionBinding: "a".repeat(64),
            chainId: "ynx_6423-1",
            requestingProduct: "calendar",
            productClientId: "ynx-calendar-v1",
            bundleId: "com.ynxweb4.calendar",
            callback: "ynxcalendar://wallet-auth/callback",
            productDeviceAlgorithm: "p256-sha256",
            productDeviceKey: "browser-proof-device",
            deviceBinding: "b".repeat(64),
            requestDigest: "c".repeat(64),
            approvalDigest: "d".repeat(64),
            account: "ynx1browserproof",
            scopes: ["calendar:account"],
            nonce: proof.authorizationRequest.nonce,
            purpose: "Calendar browser proof",
            issuedAt: new Date(Date.now() - 1000).toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
      );
    });
  })
  .listen(walletPort, "127.0.0.1");

const proc = spawn("go", ["run", "./apps/calendar"], {
  cwd: root,
  env: {
    ...process.env,
    YNX_CALENDAR_ADDR: `127.0.0.1:${port}`,
    YNX_CALENDAR_DATA_DIR: dataDir,
    YNX_WALLET_VERIFY_URL: `http://127.0.0.1:${walletPort}`,
  },
  stdio: "inherit",
  detached: true,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServer() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw Error(
        `Calendar server exited before health became ready (exit=${proc.exitCode}, signal=${proc.signalCode})`,
      );
    }
    try {
      const response = await fetch(`${base}/v1/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw Error("Calendar server did not become healthy within 45 seconds");
}
function waitForProcessExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}
async function stopProcessGroup(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {
      try {
        child.kill(name);
      } catch {}
    }
  };
  signal("SIGTERM");
  if (await waitForProcessExit(child, 5_000)) return;
  signal("SIGKILL");
  await waitForProcessExit(child, 2_000);
}
async function closeServer(server) {
  if (!server.listening) return;
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    sleep(2_000),
  ]);
}
async function api(url, method = "GET", body, cookie) {
  const response = await fetch(base + url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(JSON.stringify(value));
  return value;
}
function unnamedInteractive() {
  return [...document.querySelectorAll("button,a,input,select,textarea")]
    .filter(
      (element) =>
        !(
          element.getAttribute("aria-label") ||
          element.textContent ||
          element.getAttribute("placeholder") ||
          ""
        ).trim(),
    )
    .map((element) => element.outerHTML.slice(0, 120));
}

(async () => {
  let browser;
  try {
    if (!wallet.listening) await once(wallet, "listening");
    await waitForServer();
    const challenge = await api("/v1/auth/challenges", "POST", {});
    const authorizationRequest = {
      version: "wallet-auth-v1",
      nonce: `browser-${Date.now()}`,
      productClientId: "ynx-calendar-v1",
    };
    const proof = {
      account: "ynx1browserproof",
      handle: "@proof",
      product: "com.ynx.calendar",
      scopes: ["calendar:account"],
      challenge: challenge.id,
      device_key: "browser-proof-device",
      expires_at: Math.floor(Date.now() / 1000) + 60,
      assertion: "remote-wallet-proof",
      central: {
        registryEntry: { clientId: "ynx-calendar-v1" },
        authorizationRequest,
        walletApproval: { approved: true },
        gatewayCompletion: { completed: true },
      },
    };
    const authResponse = await fetch(base + "/v1/auth/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proof),
    });
    if (!authResponse.ok) throw Error(await authResponse.text());
    const session = await authResponse.json();
    const cookie = authResponse.headers.get("set-cookie")?.split(";")[0];
    if (!cookie || "token" in session)
      throw Error("Calendar session was not issued as an HttpOnly cookie");
    const now = new Date();
    const start = new Date(now);
    start.setHours(12, 0, 0, 0);
    const end = new Date(start);
    end.setHours(13, 0, 0, 0);
    const local = (date) =>
      new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
    const preview = await api(
      "/v1/events/preview",
      "POST",
      {
        title: "Permission review",
        description: "Explicit scheduling approval and conflict boundary.",
        local_start: local(start),
        local_end: local(end),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        recurrence: { frequency: "weekly", interval: 1, count: 3 },
        invitees: [],
        reminders: [{ minutes_before: 10, channel: "local" }],
        meeting_link: "https://meet.example/ynx-bounded",
        client_mutation_id: "browser-proof-event",
        base_version: 0,
      },
      cookie,
    );
    const event = await api(
      `/v1/changes/${preview.id}/approve`,
      "POST",
      { accept_conflicts: false },
      cookie,
    );
    browser = await chromium.launch({ headless: true });
    for (const config of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "desktop-dark", width: 1440, height: 900, colorScheme: "dark" },
      { name: "mobile", width: 390, height: 844 },
      { name: "tablet", width: 834, height: 1194 },
      { name: "arabic-rtl", width: 390, height: 844, locale: "ar-SA" },
      { name: "large-text", width: 390, height: 844, largeText: true },
    ]) {
      const context = await browser.newContext({
        viewport: { width: config.width, height: config.height },
        reducedMotion: "reduce",
        colorScheme: config.colorScheme || "light",
        locale: config.locale || "zh-CN",
      });
      const [name, value] = cookie.split("=");
      await context.addCookies([
        { name, value, url: base, httpOnly: true, sameSite: "Strict" },
      ]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base, { waitUntil: "networkidle" });
      if (config.largeText)
        await page.addStyleTag({
          content: ":root { font-size: 125% !important; }",
        });
      await page.locator(".event").first().waitFor();
      await page.locator(".event").first().scrollIntoViewIfNeeded();
      const unnamed = await page.evaluate(unnamedInteractive);
      if (unnamed.length) throw Error(`unnamed controls: ${unnamed.join(",")}`);
      if (errors.length) throw Error(`page errors: ${errors.join(",")}`);
      await page.screenshot({
        path: path.join(artifact, `calendar-${config.name}.png`),
        fullPage: true,
      });
      if (config.name === "desktop") {
        await page.locator('[data-view="month"]').click();
        await page.locator(".month-grid").waitFor();
        await page.screenshot({
          path: path.join(artifact, "calendar-desktop-month.png"),
          fullPage: true,
        });
        await page.locator('[data-view="day"]').click();
        await page.locator(".event").first().scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(artifact, "calendar-desktop-day.png"),
          fullPage: true,
        });
      }
      await context.close();
    }
    const captureState = async (name, setup, ready) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      const [cookieName, cookieValue] = cookie.split("=");
      await context.addCookies([
        {
          name: cookieName,
          value: cookieValue,
          url: base,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      if (setup) await setup(page);
      await page.goto(base, {
        waitUntil: name === "loading" ? "domcontentloaded" : "networkidle",
      });
      await ready(page);
      if (errors.length)
        throw Error(`${name} page errors: ${errors.join(",")}`);
      await page.screenshot({
        path: path.join(artifact, `calendar-${name}.png`),
        fullPage: true,
      });
      await context.close();
    };
    await captureState(
      "loading",
      async (page) => {
        await page.route(/\/v1\/events(?:\?|$)/, async (route) => {
          await sleep(2_000);
          await route.continue();
        });
      },
      async (page) => {
        await page.locator("#signin").waitFor({ state: "hidden" });
        await page.locator('#app[aria-busy="true"]').waitFor();
      },
    );
    await captureState(
      "failure",
      async (page) => {
        await page.route(/\/v1\/events(?:\?|$)/, (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: '{"detail":"受控故障：日程暂时不可用"}',
          }),
        );
      },
      async (page) => page.locator("#toast.show").waitFor(),
    );
    const cancel = await api(
      `/v1/events/${event.id}/cancel-preview`,
      "POST",
      {
        client_mutation_id: "browser-proof-cancel",
        base_version: event.version,
      },
      cookie,
    );
    await api(
      `/v1/changes/${cancel.id}/approve`,
      "POST",
      { accept_conflicts: false },
      cookie,
    );
    await captureState("empty", null, async (page) =>
      page.locator("#empty").waitFor({ state: "visible" }),
    );
    console.log(
      JSON.stringify({
        product: "calendar",
        desktop: "apps/calendar/tests/artifacts/calendar-desktop.png",
        mobile: "apps/calendar/tests/artifacts/calendar-mobile.png",
        accessibility: "interactive controls named",
        consoleErrors: 0,
      }),
    );
  } finally {
    if (browser) await browser.close();
    await closeServer(wallet);
    await stopProcessGroup(proc);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

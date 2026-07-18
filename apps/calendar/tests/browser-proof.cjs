const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "../../..");
const port = 18196;
const walletPort = 19196;
const base = `http://127.0.0.1:${port}`;
const artifact = path.join(__dirname, "artifacts");
fs.mkdirSync(artifact, { recursive: true });

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
        req.url === "/v1/wallet-auth/verify-session" &&
        proof?.registryEntry &&
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
          verifierVersion: "wallet-auth-v1",
          sessionBinding: "calendar-browser-binding",
          requestDigest: "calendar-browser-digest",
          productClientId: "ynx-calendar-v1",
          bundleId: "com.ynxweb4.calendar",
          account: "ynx1browserproof",
          scopes: ["calendar:account"],
          issuedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
    YNX_CALENDAR_DATA_DIR: fs.mkdtempSync("/tmp/ynx-calendar-browser-"),
    YNX_WALLET_VERIFY_URL: `http://127.0.0.1:${walletPort}`,
  },
  stdio: "inherit",
  detached: true,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/v1/health`)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw Error("Calendar server did not start");
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
    await wait();
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
    const start = new Date(now.getTime() + 3_600_000);
    const end = new Date(start.getTime() + 3_600_000);
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
    wallet.close();
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

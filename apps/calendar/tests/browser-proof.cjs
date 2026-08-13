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
    const sharedCalendar = await api(
      "/v1/calendars",
      "POST",
      { name: "Protocol team", color: "violet" },
      cookie,
    );
    const preview = await api(
      "/v1/events/preview",
      "POST",
      {
        title: "Permission review",
        description: "Explicit scheduling approval and conflict boundary.",
        location: "Testnet review room",
        all_day: false,
        calendar_id: sharedCalendar.id,
        color: "green",
        privacy: "participants",
        attachment_links: ["https://cloud.ynxweb4.com/files/browser-proof"],
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
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: "zh-CN",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base, { waitUntil: "networkidle" });
      await page.locator("#guest-try").waitFor();
      if ((await page.locator("#locale-picker").inputValue()) !== "en")
        throw Error("a fresh Calendar visit is not English-first");
      await page.locator("#guest-try").click();
      await page.locator("#signin").waitFor({ state: "hidden" });
      await page.locator("#new-event").click();
      await page.locator("#title").fill("Guest device-only draft");
      await page.locator("#location").fill("Room 6423");
      await page.locator("#all-day").check();
      await page.locator("#recurrence").selectOption("weekly");
      await page.locator("#interval").fill("2");
      await page.locator("#count").fill("3");
      const currentDayCode = await page.evaluate(() => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][new Date().getDay()]);
      await page.locator("#by-day").fill(currentDayCode);
      await page.locator("#calendar-id").selectOption("team");
      await page.locator("#event-color").selectOption("violet");
      await page.locator("#event-privacy").selectOption("participants");
      await page.locator("#buffer-before").fill("15");
      await page.locator("#buffer-after").fill("30");
      await page.locator("#attachment-links").fill("https://cloud.ynxweb4.com/files/guest-calendar-proof");
      await page.locator("#event-form button[type=submit]").click();
      await page.locator("#change-dialog").waitFor({ state: "visible" });
      await page.locator("#approve-change").click();
      await page.locator(".event").first().waitFor();
      const guestProof = await page.evaluate(() => ({
        events: JSON.parse(localStorage.getItem("ynx.calendar.guestEvents") || "[]"),
        signinHidden: document.querySelector("#signin")?.hidden,
        account: document.querySelector("#account")?.textContent,
        serverCookie: document.cookie,
      }));
      const storedGuest = guestProof.events[0];
      if (guestProof.events.length !== 1 || storedGuest.location !== "Room 6423" || !storedGuest.all_day || storedGuest.calendar_id !== "team" || storedGuest.color !== "violet" || storedGuest.privacy !== "participants" || storedGuest.buffer_before_minutes !== 15 || storedGuest.buffer_after_minutes !== 30 || storedGuest.recurrence.frequency !== "weekly" || storedGuest.recurrence.interval !== 2 || storedGuest.recurrence.count !== 3 || storedGuest.attachment_links.length !== 1 || !guestProof.signinHidden || guestProof.account !== "G" || guestProof.serverCookie)
        throw Error(`guest mode boundary failed: ${JSON.stringify(guestProof)}`);
      await page.locator("#account").click();
      await page.getByRole("heading", { name: "Local Calendar data" }).waitFor();
      await page.getByRole("button", { name: "Export JSON" }).waitFor();
      await page.getByRole("button", { name: "Export iCalendar (.ics)" }).waitFor();
      await page.getByRole("button", { name: "Close" }).click();
      await page.locator("#new-event").click();
      await page.locator("#title").fill("Guest alternative proof");
      await page.locator("#start").fill(local(new Date(storedGuest.start_utc)));
      await page.locator("#end").fill(local(new Date(storedGuest.end_utc)));
      await page.locator("#event-form button[type=submit]").click();
      await page.getByText("Conflict-free draft alternatives").waitFor();
      await page.locator("[data-suggestion]").first().click();
      await page.locator("#event-close").click();
      if (errors.length) throw Error(`guest mode page errors: ${errors.join(",")}`);
      await page.screenshot({
        path: path.join(artifact, "calendar-guest-trial.png"),
        fullPage: true,
      });
      await context.close();
    }
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
      if (config.name === "arabic-rtl")
        await page.addInitScript(() => {
          localStorage.setItem("ynx.calendar.locale", "ar");
          localStorage.setItem("ynx.calendar.locale.explicit", "1");
        });
      await page.goto(base, { waitUntil: "networkidle" });
      if (config.largeText)
        await page.addStyleTag({
          content: ":root { font-size: 125% !important; }",
        });
      await page.locator(".event").first().waitFor();
      await page.locator(".event").first().scrollIntoViewIfNeeded();
      if (config.name === "arabic-rtl") {
        const localeProof = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          dir: document.documentElement.dir,
          picker: document.querySelector("#locale-picker")?.value,
          create: document.querySelector("#new-event")?.textContent.trim(),
        }));
        if (
          localeProof.lang !== "ar" ||
          localeProof.dir !== "rtl" ||
          localeProof.picker !== "ar" ||
          !localeProof.create.includes("إنشاء حدث")
        )
          throw Error(`Arabic RTL localization failed: ${JSON.stringify(localeProof)}`);
      }
      if (config.width <= 390) {
        const compactWeek = await page.locator("#timeline").evaluate((timeline) => ({
          clientWidth: timeline.clientWidth,
          scrollWidth: timeline.scrollWidth,
          visibleDays: timeline.querySelectorAll(".day-head").length,
        }));
        if (compactWeek.visibleDays !== 7)
          throw Error(`mobile week rendered ${compactWeek.visibleDays} day headers`);
        if (compactWeek.scrollWidth > compactWeek.clientWidth + 1)
          throw Error(
            `mobile week requires horizontal scrolling (${compactWeek.scrollWidth} > ${compactWeek.clientWidth})`,
          );
      }
      const unnamed = await page.evaluate(unnamedInteractive);
      if (unnamed.length) throw Error(`unnamed controls: ${unnamed.join(",")}`);
      if (errors.length) throw Error(`page errors: ${errors.join(",")}`);
      await page.screenshot({
        path: path.join(artifact, `calendar-${config.name}.png`),
        fullPage: true,
      });
      if (config.name === "desktop") {
        await page.getByRole("button", { name: /Protocol team/ }).waitFor();
        await page.locator("#new-event").click();
        await page.locator("#title").fill("Conflict alternative proof");
        await page.locator("#start").fill(local(start));
        await page.locator("#end").fill(local(end));
        await page.locator("#event-form button[type=submit]").click();
        await page.waitForTimeout(500);
        if (!(await page.locator("#change-dialog").isVisible()))
          throw Error(`conflict preview did not open: ${await page.locator("#toast").innerText()}`);
        if (!(await page.locator("#change-preview").innerText()).includes("Conflict-free draft alternatives"))
          throw Error(`alternative drafts missing: ${await page.locator("#change-preview").innerText()}`);
        const originalConflictStart = local(start);
        await page.locator("[data-suggestion]").first().click();
        if ((await page.locator("#start").inputValue()) === originalConflictStart)
          throw Error("alternative draft did not update the editor");
        await page.locator("#event-dialog").getByRole("button", { name: "Close" }).click();
        await page.getByRole("button", { name: "Open Calendar notifications" }).click();
        await page.getByRole("heading", { name: "Notifications" }).waitFor();
        await page.getByText("Mail delivery is a separate integration.").waitFor();
        await page.getByRole("button", { name: "Close" }).click();
        await page.getByRole("button", { name: "Manage shared calendars" }).click();
        await page.getByRole("heading", { name: "Calendars and permissions" }).waitFor();
        await page.getByRole("button", { name: "Close" }).click();
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
        await page.locator('[data-view="agenda"]').click();
        await page.locator(".agenda-event").first().waitFor();
        await page.locator("#calendar-search").fill("Permission review");
        if ((await page.locator(".agenda-event").count()) !== 3)
          throw Error("agenda search did not retain the three recurring occurrences");
        await page.locator("#calendar-search").fill("no matching calendar event");
        await page.locator("#empty").waitFor({ state: "visible" });
        await page.locator("#calendar-search").fill("");
        await page.locator(".agenda-event").first().click();
        await page.getByRole("button", { name: "Manage recurrence" }).click();
        for (const action of ["Edit this occurrence", "Cancel this occurrence", "Edit this and following", "Edit entire series"])
          await page.getByRole("button", { name: action }).waitFor();
        await page.getByRole("button", { name: "Close" }).click();
        await page.screenshot({
          path: path.join(artifact, "calendar-desktop-agenda.png"),
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
        guestTrial: "device-only draft without Wallet or server session",
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

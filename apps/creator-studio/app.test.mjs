import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const load = name => readFile(new URL(name, import.meta.url), "utf8");

test("studio exposes recovery, team, rights, revenue and bounded AI workflows", async () => {
  const [html, js, i18n] = await Promise.all([
    load("index.html"),
    load("app.js"),
    load("i18n.js"),
  ]);

  for (const term of [
    "Create or recover your channel",
    "Invite team member",
    "Change active role",
    "Revoke member",
    "Rights basis",
    "Evidence SHA-256",
    "Uploaded source SHA-256",
    "Contributor splits JSON",
    "payout intent",
    "Reports, takedowns and appeals",
    "Revenue audit",
    "AI production workspace",
    "Delete AI data",
    "Content lifecycle",
    "independent review",
    "immutable version record",
  ]) {
    assert.match(html, new RegExp(term, "i"), `missing UI contract: ${term}`);
  }

  for (const id of [
    "team-invite-form",
    "team-role-form",
    "team-revoke-form",
    "team-list",
    "rights-form",
    "rights-list",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing UI element: ${id}`);
  }

  for (const path of [
    "/team/invites",
    "/team/${encodeURIComponent(form.account.value)}/role",
    "/videos/${encodeURIComponent(form.video_id.value)}/rights",
    "/metadata",
    "/retry-processing",
    "/thumbnail",
    "/captions",
    "/monetization",
    "/payout-intents",
    "/appeals",
    "/disputes",
    "/ai/jobs",
    "/stream",
    "/submit-review",
    "/review-publication",
    "/schedule",
    "/publish-due",
    "/unpublish",
  ]) {
    assert.ok(js.includes(path), `missing client route: ${path}`);
  }

  for (const binding of [
    "ynx-creator-studio-web-v1",
    "com.ynxweb4.creator-studio.web",
    "gateway_session",
    "output_language",
    "X-YNX-App-Session",
    "source_sha256",
    "evidence_sha256",
    "authorization version",
  ]) {
    assert.match(js, new RegExp(binding, "i"), `missing runtime binding: ${binding}`);
  }

  assert.match(js, /form\.source_sha256\.value=video\.sha256/);
  assert.match(js, /Their next request will fail closed/i);
  assert.match(js, /Commercial use still requires independent review/i);
  assert.doesNotMatch(js, /\/v1\/rights\/[^`"']+\/review/);

  for (const locale of ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"]) {
    const key = locale.includes("-") ? `"${locale}"` : locale;
    const catalogPattern = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*\\{[^}]*team\\s*:[^}]*rights\\s*:`, "s");
    assert.match(i18n, catalogPattern, `team/rights navigation is not translated for ${locale}`);
  }

  assert.match(i18n, /locale==="ar"\?"rtl":"ltr"/);
  assert.match(i18n, /PluralRules/);
  assert.match(i18n, /new URL\("\.\/i18n\/catalog\.json",import\.meta\.url\)/);
  assert.doesNotMatch(i18n, /fetch\(["']\/i18n\/catalog\.json["']\)/);
  assert.equal(
    new URL("./i18n/catalog.json", "https://web4.ynxweb4.com/video/studio/i18n.js").href,
    "https://web4.ynxweb4.com/video/studio/i18n/catalog.json",
  );
  assert.notEqual(
    new URL("./i18n/catalog.json", "https://web4.ynxweb4.com/video/studio/i18n.js").pathname,
    "/i18n/catalog.json",
  );
  assert.match(html, /never enables monetization automatically/i);
  assert.match(js, /AI request cancelled and audited/);

  assert.doesNotMatch(js, /Math\.random|authorize\?client=/i);
});

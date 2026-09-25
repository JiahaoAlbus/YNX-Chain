import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { HOSTED_DYNAMIC_KEYS, HOSTED_LOCALES, HOSTED_STATIC_KEYS, hostedCopy, hostedDynamicCopy, hostedDynamicCoverage, hostedTranslationCoverage, normalizeHostedLocale } from "../src/hosted-i18n.js";

test("all twelve hosted locales cover every static and dynamic product key", async () => {
  assert.equal(HOSTED_LOCALES.length, 12);
  const html = await readFile(new URL("../public/hosted-wallet.html", import.meta.url), "utf8");
  const htmlKeys = [...html.matchAll(/data-i18n(?:-placeholder|-aria)?="([A-Za-z][A-Za-z0-9]*)"/gu)].map(match => match[1]);
  for (const key of htmlKeys) assert.ok(HOSTED_STATIC_KEYS.includes(key), `undeclared HTML key ${key}`);
  for (const [locale] of HOSTED_LOCALES) {
    assert.equal(hostedTranslationCoverage()[locale].complete, true, `${locale} static`);
    assert.equal(hostedDynamicCoverage()[locale].complete, true, `${locale} dynamic`);
    for (const key of HOSTED_STATIC_KEYS) assert.ok(hostedCopy(locale, key).trim());
    for (const key of HOSTED_DYNAMIC_KEYS) assert.ok(hostedDynamicCopy(locale, key, { account: "YNX", origin: "finance", product: "Finance", scopes: "read", expires: "date" }).trim());
  }
  assert.equal(normalizeHostedLocale("zh-Hans"), "zh-CN");
  assert.equal(normalizeHostedLocale("zh-Hant"), "zh-TW");
  assert.equal(normalizeHostedLocale("ar-SA"), "ar");
  assert.equal(normalizeHostedLocale("unexpected"), "en");
});
test("dynamic values are rendered as text while protocol identifiers stay unchanged", () => {
  const text = hostedDynamicCopy("zh-CN", "connected", { origin: "https://finance.ynxweb4.com" });
  assert.match(text, /https:\/\/finance\.ynxweb4\.com/u);
  assert.match(hostedDynamicCopy("ar", "reviewFor", { account: "YNX123" }), /YNX123/u);
  assert.throws(() => hostedCopy("en", "unknown"), /HOSTED_I18N_KEY_UNKNOWN/u);
});

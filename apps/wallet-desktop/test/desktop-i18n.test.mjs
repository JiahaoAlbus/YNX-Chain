import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createDesktopI18n, detectLocale, LOCALES, LOCALE_PREFERENCE_KEY, MESSAGES } from "../src/desktop-i18n.mjs";

function fixture(systemLocale = "en-US", saved) {
  const values = new Map(saved === undefined ? [] : [[LOCALE_PREFERENCE_KEY, saved]]);
  const staticLabel = { dataset: { i18n: "Unlock Wallet" }, textContent: "Unlock Wallet" };
  const root = { lang: "en", dir: "ltr" };
  const doc = { documentElement: root, querySelectorAll: selector => selector === "[data-i18n]" ? [staticLabel] : [] };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  return { i18n: createDesktopI18n({ systemLocale, storage, document: doc }), root, staticLabel, values };
}

test("all desktop message rows contain nonempty text for every advertised locale", () => {
  assert.equal(LOCALES.length, 13); // Published 12 plus requested Hindi.
  assert.deepEqual(LOCALES.slice(0, 12).map(([code]) => code), ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"]);
  assert.equal(new Set(LOCALES.map(([code]) => code)).size, 13);
  for (const [source, translations] of Object.entries(MESSAGES)) {
    assert.equal(translations.en, source);
    for (const [locale] of LOCALES) assert.ok(typeof translations[locale] === "string" && translations[locale].trim(), `${locale}: ${source}`);
  }
});

test("every marked HTML label, hint and accessibility name resolves to all locales", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<br\b[^>]*data-i18n/);
  const marked = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)].map(match => match[1].replaceAll("&amp;", "&"));
  assert.ok(marked.length > 125);
  for (const key of marked) for (const [locale] of LOCALES) assert.ok(MESSAGES[key]?.[locale], `${locale}: ${key}`);
});

test("system locale recognizes Chinese scripts, Hindi and Arabic; unknown locale falls back to English", () => {
  assert.equal(detectLocale("zh-Hant-HK"), "zh-TW");
  assert.equal(detectLocale("zh_SG"), "zh-CN");
  assert.equal(detectLocale("ar-EG"), "ar");
  assert.equal(detectLocale("hi-IN"), "hi");
  assert.equal(detectLocale("id-ID"), "id");
  assert.equal(detectLocale("xx-YY"), "en");
});

test("explicit display preference persists, changes direction, and can return to the system locale", () => {
  const { i18n, root, staticLabel, values } = fixture("de-DE");
  i18n.apply();
  assert.equal(i18n.locale, "de");
  assert.equal(staticLabel.textContent, MESSAGES["Unlock Wallet"].de);
  i18n.setLocale("ar");
  assert.equal(values.get(LOCALE_PREFERENCE_KEY), "ar");
  assert.equal(root.dir, "rtl");
  assert.equal(root.lang, "ar");
  assert.equal(staticLabel.textContent, MESSAGES["Unlock Wallet"].ar);
  assert.equal(fixture("fr-FR", "ar").i18n.locale, "ar");
  i18n.setLocale("system");
  assert.equal(values.has(LOCALE_PREFERENCE_KEY), false);
  assert.equal(i18n.locale, "de");
  assert.equal(root.dir, "ltr");
  assert.throws(() => i18n.setLocale("unknown"));
});

test("number and date localization changes display only, with no wallet protocol state", () => {
  const { i18n } = fixture("en-US");
  i18n.setLocale("de");
  assert.match(i18n.formatNumber(1234.5), /1\.234,5/);
  assert.equal(i18n.formatDecimalString("123456789012345678901234567890.123456789123456789"), "123.456.789.012.345.678.901.234.567.890,123456789123456789");
  assert.equal(i18n.formatDecimalString("not-a-number"), "not-a-number");
  assert.match(i18n.formatDateTime("2026-09-25T12:30:00Z"), /2026/);
  assert.equal(i18n.t("YNXT"), "YNXT");
});

test("dynamic custody text is refreshed on locale changes without replacing form or wallet data", () => {
  const { i18n } = fixture("en-US");
  const node = { textContent: "", isConnected: true };
  const account = "ynx1qqqqqqqq";
  i18n.write(node, "Restore {account}. The current password and other protected accounts will be retained. Existing app permissions will be revoked. Pending transactions remain recorded.", { account });
  assert.match(node.textContent, /ynx1qqqqqqqq/);
  i18n.setLocale("ar");
  assert.match(node.textContent, /ynx1qqqqqqqq/);
  assert.doesNotMatch(node.textContent, /^Restore /);
});

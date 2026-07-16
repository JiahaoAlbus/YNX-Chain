import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogs,
  formatDate,
  formatNumber,
  localeNames,
  locales,
  plural,
  systemLocale,
  translate,
} from "./i18n";

test("all twelve audited locale catalogs contain the same nonblank keys", () => {
  assert.equal(locales.length, 12);
  const keys = Object.keys(catalogs.en).sort();
  for (const locale of locales) {
    assert.deepEqual(
      Object.keys(catalogs[locale]).sort(),
      keys,
      `${locale} key set`,
    );
    for (const key of keys)
      assert.ok(
        catalogs[locale][key as keyof typeof catalogs.en].trim(),
        `${locale}:${key}`,
      );
    assert.ok(localeNames[locale]);
  }
});
test("critical security, privacy, permission, recovery and AI labels are localized", () => {
  const critical = [
    "Sign in with YNX Wallet",
    "Social never creates, imports, or receives your recovery key.",
    "No Wallet sign-in request is pending",
    "Wallet approval signature is invalid",
    "Contacts permission was not granted",
    "Camera access is used only while you scan a Social profile QR.",
    "Privacy & discovery",
    "AI privacy preview",
    "Estimated cost",
    "Review before applying",
  ] as const;
  for (const locale of locales.filter((value) => value !== "en"))
    for (const key of critical)
      assert.notEqual(
        catalogs[locale][key],
        catalogs.en[key],
        `${locale}:${key}`,
      );
});
test("Intl helpers localize date, numbers and plural rules without blank fallback", () => {
  assert.equal(systemLocale("ar-SA"), "ar");
  assert.equal(systemLocale("zh-Hant-HK"), "zh-Hant");
  assert.notEqual(
    formatDate("2026-07-15T12:00:00.000Z", "zh-Hans"),
    formatDate("2026-07-15T12:00:00.000Z", "en"),
  );
  assert.notEqual(
    formatNumber(1234567.89, "de"),
    formatNumber(1234567.89, "en"),
  );
  assert.equal(plural(1, { one: "one", other: "other" }, "en"), "one");
  assert.equal(
    translate("Unknown bounded server detail", "ar"),
    "Unknown bounded server detail",
  );
});

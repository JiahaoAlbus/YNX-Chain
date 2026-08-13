import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "native/ios/YNXCalendar/Localizable.xcstrings")),
);
const web = JSON.parse(fs.readFileSync(path.join(root, "web/locales.json")));
const nativeLocales = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"];
const webLocales = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"];

test("every native Calendar key is translated and Arabic is present", () => {
  for (const [key, value] of Object.entries(catalog.strings)) {
    assert.deepEqual(Object.keys(value.localizations).sort(), [...nativeLocales].sort(), key);
    for (const locale of nativeLocales)
      assert.ok(value.localizations[locale].stringUnit.value.trim(), `${key}:${locale}`);
  }
  assert.match(catalog.strings.security.localizations.ar.stringUnit.value, /المحفظة/);
});

test("Web Calendar exposes the same 12 audited catalogs and runtime RTL switch", () => {
  assert.deepEqual(Object.keys(web.locales).sort(), [...webLocales].sort());
  const keys = Object.keys(web.locales.en).sort();
  for (const locale of webLocales) {
    assert.deepEqual(Object.keys(web.locales[locale]).sort(), keys, locale);
    for (const key of keys) assert.ok(web.locales[locale][key].trim(), `${locale}:${key}`);
  }
  for (const key of ["day", "week", "month", "timezone_help", "calendars", "my_events", "meeting_help", "hero_title", "scheduling_disclaimer"])
    for (const locale of webLocales.filter((value) => value !== "en")) assert.notEqual(web.locales[locale][key], web.locales.en[key], `${locale}:${key}`);
  const runtime = fs.readFileSync(path.join(root, "web/i18n.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  assert.match(runtime, /locale === "ar" \? "rtl" : "ltr"/);
  assert.match(runtime, /ynx\.calendar\.locale/);
  assert.match(runtime, /ynx\.calendar\.locale\.explicit/);
  assert.match(runtime, /storedLocale : "en"/);
  assert.doesNotMatch(runtime, /storedLocale \|\| navigator\.language/);
  for (const key of ["create", "empty", "timezone", "repeat", "reminder", "privacy", "review", "recover"])
    assert.match(html, new RegExp(`data-i18n="${key}"`));
});

test("identities, deep links, privacy and RTL are explicit", () => {
  const all =
    fs.readFileSync(path.join(root, "native/ios/YNXCalendar/YNXCalendarApp.swift"), "utf8") +
    fs.readFileSync(path.join(root, "native/android/app/src/main/java/com/ynxweb4/calendar/MainActivity.java"), "utf8");
  for (const token of ["com.ynxweb4.calendar", "ynxcalendar", "ynx-calendar-v1", "rightToLeft", "calendar:account", "pending_request", "consumed.", "response", "requestDigest", '["scopes"]', "gateway_required"])
    assert.ok(all.includes(token), token);
  assert.doesNotMatch(all, /ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}/);
});

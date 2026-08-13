import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const res = path.join(root, "native/android/app/src/main/res");
const ios = path.join(root, "native/ios/YNXCalendar/Localizable.xcstrings");
const web = path.join(root, "web/locales.json");
const webExtras = JSON.parse(fs.readFileSync(path.join(root, "web/locales-extra.json"), "utf8"));
const map = {
  values: "en",
  "values-zh-rCN": "zh-Hans",
  "values-zh-rTW": "zh-Hant",
  "values-ja": "ja",
  "values-ko": "ko",
  "values-es": "es",
  "values-fr": "fr",
  "values-de": "de",
  "values-pt": "pt",
  "values-ru": "ru",
  "values-ar": "ar",
  "values-id": "id",
};
const strings = {};
const decode = (value) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("\\'", "'");

for (const [directory, locale] of Object.entries(map)) {
  const xml = fs.readFileSync(path.join(res, directory, "strings.xml"), "utf8");
  for (const match of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) {
    strings[match[1]] ??= {};
    strings[match[1]][locale] = decode(match[2]);
  }
}

const out = {
  sourceLanguage: "en",
  strings: Object.fromEntries(
    Object.entries(strings).map(([key, values]) => [
      key,
      {
        localizations: Object.fromEntries(
          Object.entries(values).map(([locale, value]) => [
            locale,
            { stringUnit: { state: "translated", value } },
          ]),
        ),
      },
    ]),
  ),
  version: "1.0",
};
fs.writeFileSync(ios, `${JSON.stringify(out, null, 2)}\n`);

const webCodes = {
  en: "en",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  pt: "pt",
  ru: "ru",
  ar: "ar",
  id: "id",
};
const webOut = {
  sourceLanguage: "en",
  locales: Object.fromEntries(
    Object.entries(webCodes).map(([nativeCode, webCode]) => [
      webCode,
      Object.fromEntries(
        [...Object.entries(strings).map(([key, values]) => [key, values[nativeCode]]), ...Object.entries(webExtras[webCode])],
      ),
    ]),
  ),
};
fs.writeFileSync(web, `${JSON.stringify(webOut, null, 2)}\n`);

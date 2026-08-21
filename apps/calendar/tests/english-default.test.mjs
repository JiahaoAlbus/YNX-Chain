import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "web/locales.json"), "utf8"));

test("the pre-localization Calendar surface is English", () => {
  assert.equal(catalog.sourceLanguage, "en");
  assert.match(html, /<html lang="en" class="notranslate" translate="no">/);
  assert.match(html, /<meta name="google" content="notranslate" \/>/);
  const withoutLanguageNames = html.replace(/<select id="locale-picker"[\s\S]*?<\/select>/, "");
  assert.doesNotMatch(withoutLanguageNames, /[\u3400-\u9fff]/u);
});

test("the primary Calendar controls use the English catalog before localization loads", () => {
  for (const key of ["ai", "create", "empty", "repeat", "reminder", "review"]) {
    const expected = catalog.locales.en[key].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(html, new RegExp(`data-i18n="${key}"[^>]*>${expected}<`), `missing English fallback for ${key}`);
  }
});

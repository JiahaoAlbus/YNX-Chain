#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sourcePath = process.argv[2] || "internal/explorer/web.go";
const source = readFileSync(sourcePath, "utf8");
const locales = ["en", "zh-CN", "zh-TW", "ja", "ko"];
const fail = message => { throw new Error(`explorer i18n: ${message}`); };

function objectLiteral(name) {
  const marker = `const ${name} =`;
  const markerAt = source.indexOf(marker);
  if (markerAt < 0) fail(`missing ${name}`);
  const start = source.indexOf("{", markerAt + marker.length);
  if (start < 0) fail(`missing object for ${name}`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  fail(`unterminated ${name}`);
}

function dictionary(name) {
  const value = vm.runInNewContext(`(${objectLiteral(name)})`);
  for (const locale of locales) {
    if (!value[locale] || typeof value[locale] !== "object") fail(`${name} lacks locale ${locale}`);
  }
  return value;
}

const dictionaries = Object.fromEntries([
  "messages", "portalMessages", "homeUI", "liveUI", "downloadUI", "footerUI", "accessibilityUI", "ariaUI", "initialUI",
].map(name => [name, dictionary(name)]));

const checks = [
  { attribute: "data-i18n", dictionaries: ["messages", "portalMessages", "initialUI"] },
  { attribute: "data-home-i18n", dictionaries: ["homeUI"] },
  { attribute: "data-live-i18n", dictionaries: ["liveUI"] },
  { attribute: "data-download-i18n", dictionaries: ["downloadUI"] },
  { attribute: "data-footer-i18n", dictionaries: ["footerUI"] },
  { attribute: "data-a11y-i18n", dictionaries: ["accessibilityUI"] },
  { attribute: "data-i18n-aria", dictionaries: ["ariaUI"] },
  { attribute: "data-i18n-placeholder", dictionaries: ["messages", "portalMessages"] },
  { attribute: "data-initial-i18n", dictionaries: ["initialUI"] },
];

for (const check of checks) {
  const matcher = new RegExp(`${check.attribute}="([^"]+)"`, "g");
  const keys = new Set();
  for (const match of source.matchAll(matcher)) keys.add(match[1]);
  for (const key of keys) {
    for (const locale of locales) {
      const translated = check.dictionaries.some(name => {
        const value = dictionaries[name][locale][key];
        return typeof value === "string" && value.trim().length > 0;
      });
      if (!translated) fail(`${check.attribute}=${key} has no ${locale} translation`);
    }
  }
}

console.log(`explorer i18n verified: ${checks.length} attribute families across ${locales.length} locales`);

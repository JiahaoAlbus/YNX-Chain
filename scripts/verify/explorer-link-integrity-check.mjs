#!/usr/bin/env node
import { readFileSync } from "node:fs";

const sourcePath = process.argv[2] || "internal/explorer/web.go";
const source = readFileSync(sourcePath, "utf8");
const markup = source.slice(source.indexOf("<!doctype html>"), source.indexOf("<script>"));
const routes = new Set(["home", "blockchain", "tokens", "data", "governance", "ecosystem", "developers", "downloads", "documentation"]);
const safeAnchors = new Set(["#top", "#homeContent"]);
const fail = message => { throw new Error(`explorer links: ${message}`); };

for (const match of markup.matchAll(/href="([^"]*)"/g)) {
  const href = match[1];
  if (!href || /^\s*$/.test(href) || /^about:blank(?:$|[?#])/.test(href)) fail(`unsafe href ${JSON.stringify(href)}`);
  if (href.startsWith("#")) {
    const route = href.slice(1).split(/[?&]/, 1)[0];
    if (!safeAnchors.has(href) && !routes.has(route)) fail(`unknown in-portal anchor ${href}`);
    continue;
  }
  if (href.startsWith("/")) {
    if (!href.startsWith("/assets/")) fail(`unexpected same-origin href ${href}`);
    continue;
  }
  if (!/^https:\/\//.test(href)) fail(`non-HTTPS external href ${href}`);
  if (/(?:example\.com|localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(href)) fail(`placeholder or local external href ${href}`);
}

for (const match of markup.matchAll(/data-route="([^"]+)"/g)) {
  if (!routes.has(match[1])) fail(`unknown data-route ${match[1]}`);
}

for (const route of routes) {
  if (!markup.includes(`data-route="${route}"`)) fail(`required route ${route} has no internal link`);
}

if (/target="_blank"|window\.open\s*\(/.test(source)) fail("portal must not open a second or blank tab");
console.log(`explorer links verified: ${routes.size} in-portal routes, no unverified external target`);

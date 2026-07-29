import test from "node:test";
import assert from "node:assert/strict";
import { auditSeoTargets, scanCrawlerLog } from "./security-seo-monitor.mjs";

function response(url, status, body, headers = {}) {
  return new Response(body, { status, headers: { ...headers, "content-type": "text/plain" } });
}

function fetchFixture(fixtures) {
  return async (url) => {
    const fixture = fixtures[url];
    if (!fixture) throw new Error(`unmapped URL: ${url}`);
    const result = response(url, fixture.status ?? 200, fixture.body ?? "", fixture.headers);
    Object.defineProperty(result, "url", { value: url });
    return result;
  };
}

const productionHtml = `<!doctype html>
<html><head>
<link rel="canonical" href="https://site.test/">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>
</head><body>YNX</body></html>`;

const sitemap = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://site.test/</loc></url></urlset>`;

test("production SEO target passes direct indexability and metadata checks", async () => {
  const fetchImpl = fetchFixture({
    "https://site.test/": { body: productionHtml },
    "https://site.test/robots.txt": { body: "User-agent: *\nAllow: /\n" },
    "https://site.test/sitemap.xml": { body: sitemap },
  });
  const result = await auditSeoTargets({
    targets: [{
      id: "production",
      environment: "production",
      baseUrl: "https://site.test/",
      expectedCanonical: "https://site.test/",
      indexable: true,
      requireStructuredData: true,
    }],
    fetchImpl,
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

test("production noindex and public internal paths fail closed", async () => {
  const fetchImpl = fetchFixture({
    "https://site.test/": {
      body: productionHtml.replace("</head>", '<meta name="robots" content="noindex"></head>').replace("YNX", "/Users/local/worktree"),
    },
    "https://site.test/robots.txt": { body: "User-agent: *\nAllow: /\n" },
    "https://site.test/sitemap.xml": { body: sitemap },
  });
  const result = await auditSeoTargets({
    targets: [{
      id: "production",
      environment: "production",
      baseUrl: "https://site.test/",
      expectedCanonical: "https://site.test/",
      indexable: true,
    }],
    fetchImpl,
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.check === "indexability"));
  assert.ok(result.failures.some((failure) => failure.check === "public-path-leak"));
});

test("staging requires noindex", async () => {
  const fetchImpl = fetchFixture({
    "https://staging.test/": { body: productionHtml.replace("https://site.test/", "https://staging.test/") },
    "https://staging.test/robots.txt": { body: "User-agent: *\nDisallow: /\n" },
    "https://staging.test/sitemap.xml": { body: sitemap.replace("https://site.test/", "https://staging.test/") },
  });
  const result = await auditSeoTargets({
    targets: [{
      id: "staging",
      environment: "staging",
      baseUrl: "https://staging.test/",
      expectedCanonical: "https://staging.test/",
      indexable: false,
    }],
    fetchImpl,
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.check === "indexability"));
});

test("crawler log scanner records sensitive-path probes without echoing content", () => {
  const result = scanCrawlerLog({
    content: "GET / HTTP/1.1\nGET /internal/config HTTP/1.1\nGET /archive.sql HTTP/1.1\n",
  });
  assert.equal(result.pass, false);
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings.map((finding) => finding.line), [2, 3]);
});

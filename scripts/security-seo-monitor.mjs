#!/usr/bin/env node
/**
 * SEO and crawler SRE regression checks.
 *
 * Public checks are evidence-producing probes, not deployment claims. Every
 * target declares whether it must be indexable, and network failures are
 * recorded as failures rather than converted into synthetic success.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const internalLeakPatterns = [
  /\/Users\//i,
  /worktree/i,
  /codex\//i,
  /localhost/i,
  /127\.0\.0\.1/i,
  /\.ai-bridge/i,
  /internal host/i,
];

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("arguments must be --name value pairs");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function metaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent=["']([^"']*)["']/i);
    if (nameMatch?.[1]?.toLowerCase() === name.toLowerCase()) return contentMatch?.[1] ?? "";
  }
  return null;
}

function linkHref(html, rel) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if ((relMatch?.[1] ?? "").toLowerCase().split(/\s+/).includes(rel.toLowerCase())) return hrefMatch?.[1] ?? null;
  }
  return null;
}

function hreflangCount(html) {
  return (html.match(/<link\b[^>]*\bhreflang=["'][^"']+["'][^>]*>/gi) ?? []).length;
}

function jsonLdStatus(html) {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const errors = [];
  for (const script of scripts) {
    const body = script.replace(/^.*?>/s, "").replace(/<\/script>\s*$/i, "").trim();
    try {
      JSON.parse(body);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { count: scripts.length, valid: errors.length === 0, errors };
}

function hasNoindex(page) {
  const directives = [page.metaRobots, page.xRobotsTag]
    .filter((value) => typeof value === "string")
    .join(",")
    .toLowerCase();
  return directives.split(/[\s,]+/).includes("noindex");
}

async function fetchText(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "YNX-Security-SEO-Monitor/1.0" },
    });
    return {
      requestedUrl: url,
      finalUrl: response.url || url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function failure(target, severity, check, detail) {
  return { targetId: target.id, environment: target.environment, severity, check, detail };
}

export async function auditSeoTargets({
  targets,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  now = () => new Date(),
}) {
  const startedAt = now();
  const results = [];
  const failures = [];

  for (const target of targets) {
    const targetResult = { id: target.id, environment: target.environment, baseUrl: target.baseUrl };
    try {
      const page = await fetchText(fetchImpl, target.baseUrl, timeoutMs);
      const robots = await fetchText(fetchImpl, new URL("/robots.txt", target.baseUrl).toString(), timeoutMs);
      const sitemap = await fetchText(fetchImpl, new URL(target.sitemapPath ?? "/sitemap.xml", target.baseUrl).toString(), timeoutMs);
      const metaRobots = metaContent(page.body, "robots");
      const xRobotsTag = page.headers["x-robots-tag"] ?? null;
      const canonical = linkHref(page.body, "canonical");
      const favicon = linkHref(page.body, "icon") ?? linkHref(page.body, "shortcut icon");
      const structuredData = jsonLdStatus(page.body);
      const internalLeaks = internalLeakPatterns
        .filter((pattern) => pattern.test(page.body))
        .map((pattern) => pattern.source);

      Object.assign(targetResult, {
        page: { status: page.status, finalUrl: page.finalUrl, metaRobots, xRobotsTag },
        robots: { status: robots.status, hasUserAgent: /user-agent\s*:/i.test(robots.body) },
        sitemap: { status: sitemap.status, hasUrlset: /<(urlset|sitemapindex)\b/i.test(sitemap.body) },
        canonical,
        hreflangCount: hreflangCount(page.body),
        structuredData,
        favicon,
        internalLeaks,
      });

      if (page.status !== 200) failures.push(failure(target, "critical", "page-http", `expected 200, received ${page.status}`));
      if (robots.status !== 200) failures.push(failure(target, "high", "robots-http", `expected 200, received ${robots.status}`));
      if (sitemap.status !== 200 || !targetResult.sitemap.hasUrlset) failures.push(failure(target, "high", "sitemap", "sitemap is unavailable or malformed"));
      if (!canonical) failures.push(failure(target, "high", "canonical", "canonical link is missing"));
      if (canonical && target.expectedCanonical && canonical !== target.expectedCanonical) {
        failures.push(failure(target, "high", "canonical", `expected ${target.expectedCanonical}, received ${canonical}`));
      }
      if (!favicon) failures.push(failure(target, "medium", "favicon", "favicon link is missing"));
      if (!structuredData.valid) failures.push(failure(target, "high", "json-ld", "JSON-LD contains invalid JSON"));
      if (target.requireStructuredData === true && structuredData.count === 0) failures.push(failure(target, "medium", "json-ld", "required JSON-LD is missing"));
      if (target.requireHreflang === true && targetResult.hreflangCount === 0) failures.push(failure(target, "medium", "hreflang", "required hreflang links are missing"));
      if (internalLeaks.length > 0) failures.push(failure(target, "critical", "public-path-leak", internalLeaks.join(", ")));

      const noindex = hasNoindex({ metaRobots, xRobotsTag });
      if (target.indexable === true && noindex) failures.push(failure(target, "critical", "indexability", "indexable target contains noindex"));
      if (target.indexable === false && !noindex) failures.push(failure(target, "critical", "indexability", "non-indexable target does not contain noindex"));
    } catch (error) {
      targetResult.error = error.message;
      failures.push(failure(target, "critical", "availability", error.message));
    }
    results.push(targetResult);
  }

  const completedAt = now();
  return {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    source: "direct HTTP probe",
    pass: failures.length === 0,
    targetsChecked: targets.length,
    results,
    failures,
  };
}

export function scanCrawlerLog({ content }) {
  const pathPatterns = [
    /\/(?:\.env|\.git|private|internal|backup|dump)(?:\/|\?|\s|$)/i,
    /\.(?:pem|key|p12|pfx|sql|bak)(?:\?|\s|$)/i,
    /(?:%2e%2e|\.\.\/)/i,
  ];
  const findings = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line) continue;
    const matched = pathPatterns.filter((pattern) => pattern.test(line)).map((pattern) => pattern.source);
    if (matched.length > 0) findings.push({ line: index + 1, rules: matched });
  }
  return {
    schemaVersion: 1,
    linesScanned: content.split(/\r?\n/).filter(Boolean).length,
    findings,
    pass: findings.length === 0,
  };
}

function writeEvidence(path, result) {
  const output = resolve(root, path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));
    if (command === "regression") {
      const config = JSON.parse(readFileSync(resolve(root, args.config ?? "security-platform/seo-targets.json"), "utf8"));
      const result = await auditSeoTargets({ targets: config.targets ?? [] });
      if (args.evidence) writeEvidence(args.evidence, result);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.pass) process.exitCode = 1;
    } else if (command === "scan-log") {
      if (!args.input) throw new Error("scan-log requires --input PATH");
      const result = scanCrawlerLog({ content: readFileSync(resolve(args.input), "utf8") });
      if (args.evidence) writeEvidence(args.evidence, result);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.pass) process.exitCode = 1;
    } else {
      throw new Error("usage: security-seo-monitor.mjs regression --config PATH [--evidence PATH] | scan-log --input PATH [--evidence PATH]");
    }
  } catch (error) {
    process.stderr.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
  }
}

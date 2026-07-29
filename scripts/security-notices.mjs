#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function npmName(path, entry) {
  return entry.name || path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/)?.[1] || "";
}

export function generateNotices(lock, goModules) {
  const npm = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path || !entry.version) continue;
    const name = npmName(path, entry);
    if (!name) continue;
    npm.push({ name, version: entry.version, license: entry.license || "not-recorded", path });
  }
  npm.sort((a, b) => `${a.name}@${a.version}:${a.path}`.localeCompare(`${b.name}@${b.version}:${b.path}`));
  const go = goModules
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, version, replacement] = line.split("\t");
      return { name, version: version || "local", replacement: replacement || "" };
    })
    .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));

  const lines = [
    "# Third-Party Notices",
    "",
    "Generated from the committed npm lockfile and Go module graph. `not-recorded` is an unresolved review state, not a license conclusion. Source distributions remain authoritative for copyright and license text.",
    "",
    "## npm packages",
    "",
    "| Package | Version | License metadata | Lock path |",
    "| --- | --- | --- | --- |",
    ...npm.map((item) => `| ${item.name.replaceAll("|", "\\|")} | ${item.version} | ${item.license.replaceAll("|", "\\|")} | ${item.path.replaceAll("|", "\\|")} |`),
    "",
    "## Go modules",
    "",
    "Go module license identifiers are not asserted by `go.mod`; each distribution requires license-file review before production release.",
    "",
    "| Module | Version | Replacement | License review |",
    "| --- | --- | --- | --- |",
    ...go.map((item) => `| ${item.name.replaceAll("|", "\\|")} | ${item.version} | ${(item.replacement || "none").replaceAll("|", "\\|")} | not-recorded |`),
  ];
  return `${lines.join("\n")}\n`;
}

function currentGoModules() {
  return execFileSync("go", ["list", "-m", "-f", "{{.Path}}\\t{{.Version}}\\t{{if .Replace}}{{.Replace.Path}}@{{.Replace.Version}}{{end}}", "all"], {
    cwd: resolve(root, "chain"), encoding: "utf8",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const output = resolve(root, "docs/security-platform/THIRD_PARTY_NOTICES.md");
  const generated = generateNotices(JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")), currentGoModules());
  if (command === "write") {
    writeFileSync(output, generated);
    process.stdout.write(`WROTE ${output}\n`);
  } else if (command === "verify") {
    if (readFileSync(output, "utf8") !== generated) {
      process.stderr.write("FAIL docs/security-platform/THIRD_PARTY_NOTICES.md is missing or stale; run node scripts/security-notices.mjs write\n");
      process.exitCode = 1;
    } else {
      process.stdout.write("PASS third-party notices match dependency graphs\n");
    }
  } else {
    process.stderr.write("usage: node scripts/security-notices.mjs write|verify\n");
    process.exitCode = 2;
  }
}

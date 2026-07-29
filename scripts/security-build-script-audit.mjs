#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const lifecycle = new Set(["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"]);

function supportsPlatform(osRules, platform) {
  if (!Array.isArray(osRules) || osRules.length === 0) return true;
  const positives = osRules.filter((rule) => typeof rule === "string" && !rule.startsWith("!"));
  const negatives = new Set(
    osRules
      .filter((rule) => typeof rule === "string" && rule.startsWith("!"))
      .map((rule) => rule.slice(1)),
  );
  if (negatives.has(platform)) return false;
  return positives.length === 0 || positives.includes(platform);
}

export function auditBuildScripts({ rootDir = root, platform = process.platform } = {}) {
  const lock = JSON.parse(readFileSync(resolve(rootDir, "package-lock.json"), "utf8"));
  const allowlist = JSON.parse(
    readFileSync(resolve(rootDir, "security-platform/build-script-allowlist.json"), "utf8"),
  );
  const errors = [];

  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry?.hasInstallScript) continue;
    const allowed = allowlist.allowed?.[path];
    if (!allowed) errors.push(`${path || "<root>"}: install script is not allowlisted`);
  }

  for (const [path, scripts] of Object.entries(allowlist.allowed ?? {})) {
    const label = path || "<root>";
    const lockEntry = lock.packages?.[path];
    if (path && !lockEntry) {
      errors.push(`${label}: allowlisted package is missing from package-lock.json`);
      continue;
    }

    const packagePath = path ? resolve(rootDir, path, "package.json") : resolve(rootDir, "package.json");
    const packagePresent = existsSync(packagePath);
    const platformExcludedOptional =
      path &&
      !packagePresent &&
      lockEntry?.optional === true &&
      lockEntry?.hasInstallScript === true &&
      !supportsPlatform(lockEntry?.os, platform);

    if (!packagePresent && !platformExcludedOptional) {
      errors.push(`${label}: package metadata is unavailable for supported platform ${platform}`);
      continue;
    }

    const pkg = packagePresent ? JSON.parse(readFileSync(packagePath, "utf8")) : null;
    for (const [name, expected] of Object.entries(scripts)) {
      if (name === "implicitNodeGyp") {
        if (!pkg || expected !== true || pkg.gypfile !== true) {
          errors.push(`${label}: implicit node-gyp approval does not match package metadata`);
        }
        continue;
      }
      if (name === "lockFlagOnlyReviewed") {
        const installHooks = pkg
          ? ["preinstall", "install", "postinstall", "prepare"].filter((hook) => pkg.scripts?.[hook])
          : [];
        if (expected !== true || installHooks.length > 0 || lockEntry?.hasInstallScript !== true) {
          errors.push(`${label}: lock-only approval conflicts with lifecycle metadata`);
        }
        continue;
      }
      if (!lifecycle.has(name)) errors.push(`${label}: unsupported lifecycle key ${name}`);
      if (!pkg || pkg.scripts?.[name] !== expected) {
        errors.push(`${label}: ${name} differs from reviewed command`);
      }
    }
  }

  return errors;
}

function main() {
  const errors = auditBuildScripts();
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`FAIL ${error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("PASS package lifecycle script allowlist\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

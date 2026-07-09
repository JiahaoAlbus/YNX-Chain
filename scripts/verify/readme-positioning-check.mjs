#!/usr/bin/env node
import fs from "node:fs";

const readmePath = "README.md";
const readme = fs.readFileSync(readmePath, "utf8");
const top = readme.split(/\n(?=Run `make setup`)/u)[0] || readme;

const requiredPhrases = [
  "YNX Chain is a Web4 L1 blockchain ecosystem built around YNXT.",
  "full-stack blockchain ecosystem",
  "EVM-compatible RPC",
  "multi-validator infrastructure",
  "resource-based economics",
  "AI-native services",
  "Pay APIs",
  "Trust tracing",
  "developer tooling",
  "wallet integration",
  "explorer infrastructure",
  "global ecosystem readiness",
  "YNXT is the native coin and gas/resource asset of YNX Chain.",
  "YNX is the chain and brand name only.",
  "Current repository scope includes engineering implementation",
  "local devnet verification",
  "public testnet deployment tooling",
  "remote deployment safeguards",
  "readiness packages for wallets, exchanges, custody providers, stablecoin issuers, bridges, grants, and mainnet review",
  "does not claim that YNX Chain has already launched mainnet",
  "achieved exchange listing",
  "obtained stablecoin issuer support",
  "secured wallet default support",
  "formed third-party partnerships",
  "The goal is full-ecosystem readiness without fake claims.",
];

const missing = requiredPhrases.filter((phrase) => !top.includes(phrase));
if (missing.length > 0) {
  console.error("README positioning check failed: missing required top positioning phrases");
  for (const phrase of missing) {
    console.error(`- ${phrase}`);
  }
  process.exit(1);
}

const forbiddenClaimPatterns = [
  /\bmainnet (?:is )?(?:launched|live|active|running)\b/i,
  /\b(?:exchange listed|listed on exchange|listed on exchanges)\b/i,
  /\bstablecoin issuer (?:supported|support secured|approved)\b/i,
  /\bwallet default (?:supported|support secured|approved)\b/i,
  /\b(?:partnership|partnered) with\b/i,
];

const violations = forbiddenClaimPatterns
  .map((pattern) => [pattern, readme.match(pattern)])
  .filter(([, match]) => Boolean(match));

if (violations.length > 0) {
  console.error("README positioning check failed: found externally dependent claims");
  for (const [pattern, match] of violations) {
    console.error(`- ${pattern}: ${match[0]}`);
  }
  process.exit(1);
}

console.log("readme-positioning-check passed");

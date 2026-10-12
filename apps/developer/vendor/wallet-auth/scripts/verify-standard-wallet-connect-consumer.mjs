#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../src", import.meta.url)));
const files = await sourceFiles(root);
const text = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
const required = [
  "reduceStandardWalletConnectState",
  "ACCOUNT_APPROVED",
  "CHAIN_CONFIRMED",
  "PRIVATE_SESSION_DEGRADED",
  "ACCOUNTS_CHANGED",
  "CHAIN_CHANGED",
  "PROVIDER_DISCONNECT",
  "RESTORE",
  "OPEN_CHOOSER",
  "RPC_PROBE_DEGRADED",
  "accepted-cors-safe",
];
const missing = required.filter((value) => !text.includes(value));
const forbidden = [
  ["unqualified product not-found classification", /METAMASK_NOT_FOUND/],
  ["custom-scheme Web transport", /(?:window\.)?location(?:\.href)?\s*=\s*[`'"]ynxwallet:\/\//],
  ["direct browser RPC connection prerequisite", /fetch\s*\(\s*[`'"]https:\/\/rpc\.ynxweb4\.com\/evm/],
];
const findings = [...missing.map((value) => `missing shared transition ${value}`), ...forbidden.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)];
if (findings.length) {
  console.error(`Standard Wallet connect consumer gate failed for ${root}:\n${findings.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else console.log(`Standard Wallet connect consumer gate passed for ${root}`);

async function sourceFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(path));
    else if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(extname(entry.name))) output.push(path);
  }
  return output;
}

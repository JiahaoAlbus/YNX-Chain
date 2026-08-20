#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const helper = readFileSync(fileURLToPath(new URL("./ynx-wallet-stage-offline-artifact-linux.mjs", import.meta.url)), "utf8").replace(/^#![^\n]*\n/u, "");
const [stagingDirectory, artifactName, expectedSha256, expectedBytes, initializeDirectory] = process.argv.slice(2);
if (process.argv.length !== 7) throw new Error("exact Linux staging arguments are required");
for (const value of [stagingDirectory, artifactName, expectedSha256, expectedBytes, initializeDirectory]) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000\r\n]/u.test(value)) throw new Error("Linux staging arguments are invalid");
}
const quote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
const command = ["sudo", "-n", "/usr/bin/env", "-u", "YNX_STAGE_TEST_ALLOW_NON_ROOT", "/usr/bin/node", "--input-type=module", "-e", quote(helper), "--", ...[stagingDirectory, artifactName, expectedSha256, expectedBytes, initializeDirectory].map(quote)].join(" ");
process.stdout.write(`${command}\n`);

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = await Promise.all(["index.html", "styles.css", "app.js"].map((file) => readFile(`${root}/${file}`, "utf8")));
const joined = files.join("\n");
for (const required of ["#002FA7", "ynx_6423-1", "0.8.24", "Wallet", "source match", "AI Coding Agent", "diagnostics", "checkpoint", "RPC Tools", "locale-select", "ai-language", "app-gateway"]) {
  if (!joined.toLowerCase().includes(required.toLowerCase())) throw new Error(`Missing product evidence: ${required}`);
}
for (const forbidden of ["fully EVM compatible", "Ethereum compatible", "source verified by default", "production desktop app"]) {
  if (joined.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`Forbidden claim: ${forbidden}`);
}
console.log("YNX Developer static claim and workflow check passed.");

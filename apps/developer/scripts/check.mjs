import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertNoBareWalletAuthorizationInReleaseSources } from "./check-wallet-authorization-links.mjs";
import { assertCanonicalDeveloperChainIdentity } from "./check-chain-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);
const files = await Promise.all(["index.html", "styles.css", "app.js"].map((file) => readFile(`${root}/${file}`, "utf8")));
const joined = files.join("\n");
for (const required of ["#002FA7", "ynx_6423-1", "0.8.24", "Wallet", "source match", "YNX AI Build", "diagnostics", "checkpoint", "RPC Tools", "locale-select", "ai-language", "ynxDesktopWallet", "registered desktop Wallet callback", "Artifact Center", "Command Palette"]) {
  if (!joined.toLowerCase().includes(required.toLowerCase())) throw new Error(`Missing product evidence: ${required}`);
}
for (const forbidden of ["fully EVM compatible", "Ethereum compatible", "source verified by default", "production desktop app"]) {
  if (joined.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`Forbidden claim: ${forbidden}`);
}
await assertNoBareWalletAuthorizationInReleaseSources();
await assertCanonicalDeveloperChainIdentity();
await execFileAsync(process.execPath, [
  fileURLToPath(new URL("../vendor/wallet-auth/scripts/verify-standard-wallet-connect-consumer.mjs", import.meta.url)),
  fileURLToPath(new URL("../frontend/src", import.meta.url)),
]);
console.log("YNX Developer static claim and workflow check passed.");

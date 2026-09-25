/** Create one disposable account in the exact installed public 0.6.8 app. */
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64" || !process.env.YNX_OLD_INSTALLED_EXE || !process.env.RUNNER_TEMP || !process.env.GITHUB_WORKSPACE) throw new Error("OLD_INSTALLED_QA_ENVIRONMENT_UNAVAILABLE");
const script = fileURLToPath(new URL("./windows-password-installed-gate.mjs", import.meta.url));
const profile = path.win32.join(process.env.RUNNER_TEMP, "旧钱包 QA profile");
const evidence = path.win32.join(process.env.GITHUB_WORKSPACE, "apps", "wallet-desktop", "dist", "old-installed-smoke.json");
const report = path.win32.join(process.env.GITHUB_WORKSPACE, "apps", "wallet-desktop", "dist", "windows-old-profile.json");
const environment = { ...process.env, YNX_WALLET_PROFILE_PATH: profile, YNX_WALLET_EVIDENCE_PATH: evidence };
if (!(await stat(process.env.YNX_OLD_INSTALLED_EXE)).isFile()) throw new Error("OLD_INSTALLED_EXE_UNAVAILABLE");
const app = spawn(process.env.YNX_OLD_INSTALLED_EXE, ["--remote-debugging-port=9334"], { env: environment, stdio: "ignore", windowsHide: false });
const launchFailure = new Promise((_, reject) => app.once("error", () => reject(new Error("OLD_INSTALLED_APP_LAUNCH_FAILED"))));
let outcome;
try {
  const { stdout } = await Promise.race([promisify(execFile)(process.execPath, [script, "create"], { env: environment, timeout: 150_000, maxBuffer: 16_384 }), launchFailure]);
  const created = JSON.parse(stdout.trim());
  if (!created.passwordPersisted || !created.accountCreated || !created.wrongPasswordRejected || !created.sameAccountAfterUnlock || created.custody !== "password-encrypted-local") throw new Error("OLD_INSTALLED_ACCOUNT_CREATION_FAILED");
  let launch;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { launch = JSON.parse(await readFile(evidence, "utf8")); if (launch.appVersion === "0.6.8" && launch.visibleShellReady) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (launch?.appVersion !== "0.6.8" || !launch.visibleShellReady) throw new Error("OLD_INSTALLED_VERSION_NOT_VERIFIED");
  const bytes = await readFile(path.win32.join(profile, "wallet-vault-v3.json"));
  outcome = { sourceVersion: "0.6.8", account: created.account, ynxAccount: created.ynxAccount, vaultSHA256: createHash("sha256").update(bytes).digest("hex"), installedUIAccountCreated: true, appProcessTerminationIntentional: true, userProfileTouched: false };
} finally {
  // Intentionally simulate an unclean old-app exit after the vault was fully
  // committed. The upgraded app must recover the exact same public account.
  if (app.pid && app.exitCode === null && app.signalCode === null) {
    const exited = new Promise(resolve => app.once("exit", resolve));
    if (!app.killed) app.kill();
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("OLD_INSTALLED_APP_DID_NOT_EXIT")), 15_000))]);
  }
}
if (!outcome) throw new Error("OLD_INSTALLED_PROFILE_NOT_CREATED");
await writeFile(report, `${JSON.stringify(outcome, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ sourceVersion: outcome.sourceVersion, installedUIAccountCreated: true, account: outcome.account, ynxAccount: outcome.ynxAccount }));

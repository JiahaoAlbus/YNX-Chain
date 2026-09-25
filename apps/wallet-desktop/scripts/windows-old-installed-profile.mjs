/** Create one disposable account in an exact installed public predecessor. */
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const oldVersion = process.env.YNX_OLD_VERSION;
const expectedCreateFailure = process.env.YNX_OLD_EXPECTED_CREATE_FAILURE === "true";
if (process.platform !== "win32" || process.arch !== "x64" || !["0.6.8", "0.6.9"].includes(oldVersion) || (expectedCreateFailure && oldVersion !== "0.6.8") || !process.env.YNX_OLD_INSTALLED_EXE || !process.env.RUNNER_TEMP || !process.env.GITHUB_WORKSPACE) throw new Error("OLD_INSTALLED_QA_ENVIRONMENT_UNAVAILABLE");
const script = fileURLToPath(new URL("./windows-password-installed-gate.mjs", import.meta.url));
const profile = path.win32.join(process.env.RUNNER_TEMP, `旧钱包 ${oldVersion} QA profile`);
const evidence = path.win32.join(process.env.GITHUB_WORKSPACE, "apps", "wallet-desktop", "dist", "old-installed-smoke.json");
const report = path.win32.join(process.env.GITHUB_WORKSPACE, "apps", "wallet-desktop", "dist", "windows-old-profile.json");
const environment = { ...process.env, YNX_WALLET_PROFILE_PATH: profile, YNX_WALLET_EVIDENCE_PATH: evidence };
if (!(await stat(process.env.YNX_OLD_INSTALLED_EXE)).isFile()) throw new Error("OLD_INSTALLED_EXE_UNAVAILABLE");
const app = spawn(process.env.YNX_OLD_INSTALLED_EXE, ["--remote-debugging-port=9334"], { env: environment, stdio: "ignore", windowsHide: false });
const launchFailure = new Promise((_, reject) => app.once("error", () => reject(new Error("OLD_INSTALLED_APP_LAUNCH_FAILED"))));
let outcome;
try {
  let created = null;
  let oldCreateFailure = false;
  try {
    const { stdout } = await Promise.race([promisify(execFile)(process.execPath, [script, "create"], { env: environment, timeout: 150_000, maxBuffer: 16_384 }), launchFailure]);
    created = JSON.parse(stdout.trim());
    if (!created.passwordPersisted || !created.accountCreated || !created.wrongPasswordRejected || !created.wrongPasswordVaultUnchanged || !created.wrongAttemptProcessedByInstalledUI || !created.sameAccountAfterUnlock || created.custody !== "password-encrypted-local") throw new Error("OLD_INSTALLED_ACCOUNT_CREATION_FAILED");
  } catch (error) {
    const match = /Error: Account creation: (\{[^\r\n]*\})/.exec(String(error?.stderr ?? ""));
    let snapshot;
    try { snapshot = match && JSON.parse(match[1]); } catch {}
    if (!expectedCreateFailure || snapshot?.createResultCode !== "PASSWORD_VAULT_STORAGE_FAILED" || snapshot?.storageMessageVisible !== true || snapshot?.account?.initialized !== false || snapshot?.account?.passwordConfigured !== true || snapshot?.locked !== false || snapshot?.ui?.createAttempt?.clickObserved !== true || snapshot?.ui?.createAttempt?.busyObserved !== true) throw error;
    oldCreateFailure = true;
  }
  if (expectedCreateFailure !== oldCreateFailure) throw new Error("OLD_CREATE_FAILURE_STATE_NOT_REPRODUCED");
  let launch;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { launch = JSON.parse(await readFile(evidence, "utf8")); if (launch.appVersion === oldVersion && launch.visibleShellReady) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (launch?.appVersion !== oldVersion || !launch.visibleShellReady) throw new Error("OLD_INSTALLED_VERSION_NOT_VERIFIED");
  const bytes = await readFile(path.win32.join(profile, "wallet-vault-v3.json"));
  outcome = { sourceVersion: oldVersion, account: created?.account ?? null, ynxAccount: created?.ynxAccount ?? null, vaultSHA256: createHash("sha256").update(bytes).digest("hex"), installedUIAccountCreated: !oldCreateFailure, oldInstalledCreateFailureObserved: oldCreateFailure, oldPasswordConfigured: true, appProcessTerminationIntentional: true, userProfileTouched: false };
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
console.log(JSON.stringify({ sourceVersion: outcome.sourceVersion, installedUIAccountCreated: outcome.installedUIAccountCreated, oldInstalledCreateFailureObserved: outcome.oldInstalledCreateFailureObserved, account: outcome.account, ynxAccount: outcome.ynxAccount }));

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [executable, outputFile] = process.argv.slice(2);
if (!executable || !outputFile || !path.isAbsolute(executable)) throw new Error("Provide an absolute installed executable and evidence output");
const profile = mkdtempSync(path.join(tmpdir(), "ynx-wallet-sandbox-refusal-"));
const evidence = path.join(profile, "unexpected-wallet-launch.json");
const startedAt = new Date().toISOString();
const result = spawnSync(executable, ["--no-sandbox"], { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024,
  env: { ...process.env, YNX_WALLET_PROFILE_PATH: profile, YNX_WALLET_EVIDENCE_PATH: evidence } });
const refusalDiagnosticObserved = result.stderr?.includes("YNX_WALLET_SANDBOX_REQUIRED:") === true;
const report = { sourceCommit: process.env.GITHUB_SHA ?? null, executable, arguments: ["--no-sandbox"],
  startedAt, completedAt: new Date().toISOString(), profile, exitCode: result.status, signal: result.signal,
  error: result.error?.code ?? null, walletLaunchEvidenceCreated: existsSync(evidence),
  refusalDiagnosticObserved,
  rejectedBeforeWalletLaunch: result.status === 78 && !result.error && !existsSync(evidence) && refusalDiagnosticObserved,
  normalSandboxRuntimeVerified: false, publicRequestOrSigningPerformed: false };
writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n");
assert.equal(result.error, undefined); assert.equal(result.status, 78); assert.equal(existsSync(evidence), false);
assert.equal(refusalDiagnosticObserved, true, "The installed Wallet must emit its own sandbox refusal diagnostic");
console.log(JSON.stringify(report));

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApplicationActionLauncher as rootLauncher } from "@ynx-chain/wallet-auth";
import { createApplicationActionLauncher as explicitLauncher } from "@ynx-chain/wallet-auth/application-action-launcher";

test("explicit launcher subpath resolves to the same formal SDK implementation", () => {
  assert.equal(explicitLauncher, rootLauncher);
  assert.equal(typeof explicitLauncher, "function");
});

test("importing the explicit launcher does not read a browser or start navigation", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(globalThis, "window", { get() { throw new Error("Unexpected browser access during import"); } });
    const sdk = await import("@ynx-chain/wallet-auth/application-action-launcher");
    if (typeof sdk.createApplicationActionLauncher !== "function") throw new Error("Missing launcher export");
    process.stdout.write("headless-import-ok");
  `], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 10_000 });
  assert.equal(output, "headless-import-ok");
});

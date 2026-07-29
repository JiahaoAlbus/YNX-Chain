import assert from "node:assert/strict";
import { test } from "node:test";
import { copyPublicValueWithExpiry, type ClipboardSchedule } from "./clipboardPrivacy";

class MemoryClipboard {
  value = "";
  readonly writes: string[] = [];
  async getStringAsync() { return this.value; }
  async setStringAsync(value: string) { this.value = value; this.writes.push(value); }
}

function controlledSchedule() {
  let task: (() => void | Promise<void>) | null = null;
  let cancelled = false;
  const schedule: ClipboardSchedule = (next) => {
    task = next;
    return Object.freeze({ cancel: () => { cancelled = true; } });
  };
  return {
    schedule,
    run: async () => { if (!cancelled && task) await task(); },
  };
}

test("public address clipboard copy clears only the unchanged Wallet value", async () => {
  const clipboard = new MemoryClipboard();
  const timer = controlledSchedule();
  await copyPublicValueWithExpiry(clipboard, "ynx1publicaddress", { ttlMs: 1_000, schedule: timer.schedule });
  assert.equal(clipboard.value, "ynx1publicaddress");
  await timer.run();
  assert.equal(clipboard.value, "");
  assert.deepEqual(clipboard.writes, ["ynx1publicaddress", ""]);
});

test("clipboard expiry never erases a value copied later by the user", async () => {
  const clipboard = new MemoryClipboard();
  const timer = controlledSchedule();
  await copyPublicValueWithExpiry(clipboard, "ynx1publicaddress", { ttlMs: 1_000, schedule: timer.schedule });
  clipboard.value = "user-copied-later";
  await timer.run();
  assert.equal(clipboard.value, "user-copied-later");
  assert.deepEqual(clipboard.writes, ["ynx1publicaddress"]);
});

test("cancelled clipboard expiry performs no later mutation", async () => {
  const clipboard = new MemoryClipboard();
  const timer = controlledSchedule();
  const cancel = await copyPublicValueWithExpiry(clipboard, "ynx1publicaddress", { ttlMs: 1_000, schedule: timer.schedule });
  cancel();
  await timer.run();
  assert.equal(clipboard.value, "ynx1publicaddress");
});

test("clipboard policy rejects whitespace and unbounded retention", async () => {
  const clipboard = new MemoryClipboard();
  await assert.rejects(copyPublicValueWithExpiry(clipboard, " ynx1 "), /invalid/);
  await assert.rejects(copyPublicValueWithExpiry(clipboard, "ynx1", { ttlMs: 999 }), /between/);
  await assert.rejects(copyPublicValueWithExpiry(clipboard, "ynx1", { ttlMs: 120_001 }), /between/);
});

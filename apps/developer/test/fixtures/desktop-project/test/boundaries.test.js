import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import test from "node:test";

test("network is denied by the desktop command sandbox", async () => {
  await assert.rejects(fetch("https://example.com"));
});

test("writes outside the approved project are denied", async () => {
  await assert.rejects(writeFile(`${homedir()}/ynx-developer-sandbox-escape`, "blocked"));
});

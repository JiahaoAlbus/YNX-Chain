import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("project environment UI separates non-sensitive values from Secret references", async () => {
  const panel = await source("../frontend/src/runtime/RuntimePanel.tsx"),
    service = await source("../services/environment-service/src/service.mjs");
  assert.match(panel, /Non-sensitive value/);
  assert.match(panel, /Secret reference/);
  assert.match(panel, /never paste a Secret value here/);
  assert.match(service, /update-environment-once/);
  assert.match(service, /secret_resolver_unavailable/);
  assert.match(service, /RESERVED/);
});

test("runtime process UI uses real redacted terminal and task inventories", async () => {
  const panel = await source("../frontend/src/runtime/RuntimePanel.tsx"),
    runtime = await source("../services/workspace-agent/src/runtime.mjs"),
    terminal = await source("../services/terminal-service/src/service.mjs");
  assert.match(panel, /loadTaskActivities/);
  assert.match(panel, /loadTerminalSessions/);
  assert.match(panel, /stopTaskActivity/);
  assert.match(panel, /never commands or environment values/);
  assert.match(runtime, /\/runtime\/tasks\/active/);
  assert.match(runtime, /function publicActivity/);
  assert.match(runtime, /activity\.controller\.abort/);
  assert.match(runtime, /status: "queued"/);
  assert.match(runtime, /code: "task_cancelled"/);
  assert.doesNotMatch(runtime.match(/function publicActivity[\s\S]*?\n\}/)?.[0] || "", /command|environment[^R]/i);
  assert.match(terminal, /function publicSession/);
});

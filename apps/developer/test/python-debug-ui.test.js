import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Python, Rust and Go debug are routed through a project-bound LXD runtime", async () => {
  const panel = await read("frontend/src/debug/DebugPanel.tsx"),
    workbench = await read("frontend/src/app/Workbench.tsx"),
    debug = await read("services/debug-service/src/service.mjs"),
    runtime = await read("services/runtime-profile-service/src/service.mjs"),
    install = await read("scripts/install-reviewed-dependencies.sh"),
    image = await read("scripts/build-cloud-toolchain-image.sh"),
    live = await read("scripts/live-container-check.mjs"),
    delveBridge = await read("scripts/delve-dap-stdio-bridge.mjs");
  assert.match(panel, /\(c\|cpp\|cc\|cxx\|py\|rs\|go\)/);
  assert.match(panel, /Select an isolated LXD cloud runtime/);
  assert.match(workbench, /runtimeId=\{selectedRuntime/);
  assert.match(debug, /containerDebugBroker\.openContainerDebugProcess/);
  assert.match(debug, /justMyCode: true/);
  assert.match(debug, /subProcess: false/);
  assert.match(debug, /hideSystemGoroutines: true/);
  assert.match(runtime, /\/opt\/ynx-debugpy\/bin\/python/);
  assert.match(runtime, /\/usr\/bin\/lldb-dap-18/);
  assert.match(runtime, /\/usr\/local\/bin\/dlv/);
  assert.match(runtime, /delve-dap-stdio-bridge\.mjs/);
  assert.match(runtime, /debuginfo=2/);
  assert.match(runtime, /\.ynx-debug/);
  assert.match(install, /debugpy_version=1\.8\.21/);
  assert.match(
    install + image,
    /b1e37d333663c8851516a47364ef473da127f9caebe4417e6df6f5825a7e9a92/,
  );
  assert.match(image, /\/opt\/ynx-debugpy/);
  assert.match(image, /lldb-18=1:18\.1\.3-1ubuntu1/);
  assert.match(image, /delve\/cmd\/dlv@v1\.25\.2/);
  assert.match(delveBridge, /127\.0\.0\.1/);
  assert.match(delveBridge, /listen\(0, "127\.0\.0\.1"/);
  assert.match(delveBridge, /\.ynx-debug/);
  assert.match(delveBridge, /pidFile/);
  assert.match(live, /real breakpoint, stack and local variable passed in LXD/);
  assert.match(live, /value\.name==="value"&&value\.value==="7"/);
  assert.match(live, /rust debug: real breakpoint, stack and local variable passed in LXD/);
  assert.match(live, /value\.name==="value"&&value\.value==="9"/);
  assert.match(live, /go debug: real breakpoint, stack and local variable passed in LXD/);
  assert.match(live, /value\.name==="value"&&String\(value\.value\)\.includes\("11"\)/);
});

import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("Vercel publishes the complete PWA directory and keeps integrity resources fresh", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.buildCommand, "npm run build");
  assert.equal(config.outputDirectory, "dist/pwa");
  assert.deepEqual(config.headers, [{
    source: "/(sw|asset-integrity)\\.js",
    headers: [
      {key: "Cache-Control", value: "no-store, max-age=0, must-revalidate"},
      {key: "X-Content-Type-Options", value: "nosniff"},
    ],
  }]);
});

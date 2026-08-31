import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {chmodSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";

const inspector = resolve(import.meta.dirname, "scripts/video-retained-takeover-preflight.sh");

test("preflight captures one byte-preserving HTTP response for bytes, SHA and base64", () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-video-preflight-http-")), client = join(root, "curl-fixture"), count = join(root, "count");
  writeFileSync(client, `#!/bin/sh\nn=0; test ! -f '${count}' || n=$(cat '${count}'); n=$((n+1)); printf '%s' "$n" > '${count}'; if test "$n" = 1; then printf 'x\\n\\n'; else printf 'different-second-response'; fi\n`);
  chmodSync(client, 0o755);
  const output = execFileSync("bash", [inspector, "fixture-http", "http://fixture.invalid/"], {encoding: "utf8", env: {...process.env, YNX_VIDEO_EXECUTION_MODE: "fixture", YNX_VIDEO_PREFLIGHT_HTTP_CLIENT: client}});
  assert.equal(readFileSync(count, "utf8"), "1");
  assert.match(output, /^fixture\.bytes=3$/m);
  assert.match(output, /^fixture\.base64=eAoK$/m);
  assert.match(output, /^fixture\.sha256=d1329c6d1284e888680db5b03619fc08bdf1ee0b172c946ca6d1f18f5ea40d61$/m);
  assert.match(output, /VIDEO_RETAINED_TAKEOVER_PREFLIGHT_HTTP_FIXTURE_COMPLETE/);
});

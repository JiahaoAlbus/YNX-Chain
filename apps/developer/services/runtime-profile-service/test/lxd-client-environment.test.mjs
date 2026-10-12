import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lxcClientEnvironment } from "../src/service.mjs";

test("persistent LXD client processes retain the protected service configuration", () => {
  const previousPath = process.env.PATH,
    previousLxdConf = process.env.LXD_CONF;
  process.env.PATH = "/snap/lxd/current/bin:/usr/bin:/bin";
  process.env.LXD_CONF = "/var/lib/ynx-code-candidate/lxd-client";
  try {
    assert.deepEqual(lxcClientEnvironment(), {
      PATH: "/snap/lxd/current/bin:/usr/bin:/bin",
      LXD_CONF: "/var/lib/ynx-code-candidate/lxd-client",
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousLxdConf === undefined) delete process.env.LXD_CONF;
    else process.env.LXD_CONF = previousLxdConf;
  }
});

test("persistent LXD client processes reject malformed configuration paths", () => {
  const previousLxdConf = process.env.LXD_CONF;
  process.env.LXD_CONF = "relative/client";
  try {
    assert.equal(Object.hasOwn(lxcClientEnvironment(), "LXD_CONF"), false);
  } finally {
    if (previousLxdConf === undefined) delete process.env.LXD_CONF;
    else process.env.LXD_CONF = previousLxdConf;
  }
});

test("container compilers use a workspace-owned temporary directory", async () => {
  const source = await readFile(new URL("../src/service.mjs", import.meta.url), "utf8");
  assert.match(source, /`\$\{remote\}\/\.tmp`,\s*`\$\{remote\}\/\.ynx-build`/);
  assert.match(source, /\.\.\.variables,\s*"--env",\s*`TMPDIR=\$\{remote\}\/\.tmp`/);
});

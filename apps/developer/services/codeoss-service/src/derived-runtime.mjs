import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { fault } from "./central-identity.mjs";

export async function runtimeTreeDigest(root) {
  const hash = createHash("sha256");
  async function walk(relative = "") {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (path === "YNX-DERIVED-RUNTIME.json") continue;
      const stat = await lstat(join(root, path));
      if (stat.isDirectory()) { hash.update(`directory:${path}\n`); await walk(path); }
      else if (stat.isSymbolicLink()) hash.update(`link:${path}:${await readlink(join(root, path))}\n`);
      else if (stat.isFile()) hash.update(`file:${path}:${stat.mode & 0o777}:${createHash("sha256").update(await readFile(join(root, path))).digest("hex")}\n`);
      else throw fault("Runtime artifact contains an unsupported file type.", "core_upstream_mismatch", 503);
    }
  }
  await walk(); return hash.digest("hex");
}
export async function verifyDerivedRuntime(root, expectedManifestDigest, upstream) {
  const path = join(root, "YNX-DERIVED-RUNTIME.json"), stat = await lstat(path), bytes = await readFile(path);
  if (!stat.isFile() || stat.isSymbolicLink() || createHash("sha256").update(bytes).digest("hex") !== expectedManifestDigest)
    throw fault("Derived YNX runtime manifest is not the reviewed artifact.", "core_upstream_mismatch", 503);
  const manifest = JSON.parse(bytes);
  if (manifest.upstreamArchiveSha256 !== upstream.sha256 || manifest.upstreamCommit !== upstream.commit || manifest.treeSha256 !== await runtimeTreeDigest(root))
    throw fault("Derived YNX runtime contents changed.", "core_upstream_mismatch", 503);
  if (manifest.workbenchActivity) {
    const activity = manifest.workbenchActivity;
    if (Object.keys(activity).sort().join(',') !== 'entry,sourceSha256,version' || activity.version !== 1 ||
      activity.entry !== 'out/vs/code/browser/workbench/workbench.html' || !/^[a-f0-9]{64}$/.test(activity.sourceSha256 || ''))
      throw fault("Derived workbench activity provenance is invalid.", "core_upstream_mismatch", 503);
    const entry = await readFile(join(root, activity.entry), 'utf8');
    const match = entry.match(/<script data-ynx-workbench-activity="v1">([\s\S]*?)<\/script>/g);
    const helper = match?.length === 1 ? match[0].replace(/^<script data-ynx-workbench-activity="v1">/, '').replace(/<\/script>$/, '') : null;
    if (!helper || createHash('sha256').update(helper).digest('hex') !== activity.sourceSha256 || helper.split('__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__').length !== 2)
      throw fault("Derived trusted activity helper changed.", "core_upstream_mismatch", 503);
  }
}

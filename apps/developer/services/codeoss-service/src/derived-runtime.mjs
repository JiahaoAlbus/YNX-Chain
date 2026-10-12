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
  if (manifest.workbenchBrand) {
    const brand = manifest.workbenchBrand;
    if (Object.keys(brand).sort().join(',') !== 'entry,logoSha256,styleSha256,version' || brand.version !== 1
      || brand.entry !== 'out/vs/code/browser/workbench/workbench.html'
      || brand.logoSha256 !== 'df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d'
      || !/^[a-f0-9]{64}$/.test(brand.styleSha256 || ''))
      throw fault("Derived original YNX brand provenance is invalid.", "core_upstream_mismatch", 503);
    const entry = await readFile(join(root, brand.entry), 'utf8');
    const styles = [...entry.matchAll(/<style data-ynx-workbench-brand="v1">([\s\S]*?)<\/style>/g)];
    const style = styles.length === 1 ? styles[0][1] : null;
    const images = style ? [...style.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)] : [];
    if (!style || createHash('sha256').update(style).digest('hex') !== brand.styleSha256 || images.length !== 1
      || createHash('sha256').update(Buffer.from(images[0][1], 'base64')).digest('hex') !== brand.logoSha256)
      throw fault("Derived original YNX workbench brand changed.", "core_upstream_mismatch", 503);
  }
}

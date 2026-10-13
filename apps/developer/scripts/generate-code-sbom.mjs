import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, lstatSync, realpathSync, readlinkSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

import { fileURLToPath } from "node:url";

export function generateCodeSbom(output, runtimeNode, npmPackagePath, sourceCommit) {
if (!output || !runtimeNode || !npmPackagePath || !/^[0-9a-f]{40}$/.test(sourceCommit || "")) throw new Error("SBOM output, runtime, npm package and source commit are required.");
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const npmPackage = JSON.parse(readFileSync(npmPackagePath, "utf8"));
const nodeVersion = execFileSync(runtimeNode, ["--version"], { encoding: "utf8" }).trim().replace(/^v/, "");
const components = [];
for (const [location, record] of Object.entries(lock.packages || {})) {
  if (!location.startsWith("node_modules/") || !record?.version) continue;
  const name = location.slice("node_modules/".length);
  if (!name || name.includes("/node_modules/")) continue;
  const component = {
    type: "library",
    "bom-ref": `pkg:npm/${name.replace(/^@/, "%40")}@${record.version}`,
    name,
    version: record.version,
    purl: `pkg:npm/${name.replace(/^@/, "%40")}@${record.version}`,
    scope: record.dev ? "optional" : "required",
    properties: [{ name: "ynx:lockfilePath", value: location }],
  };
  if (record.license) component.licenses = [{ license: { name: record.license } }];
  if (record.integrity) component.hashes = [{ alg: "SHA-512", content: Buffer.from(record.integrity.replace(/^sha512-/, ""), "base64").toString("hex") }];
  components.push(component);
}
components.push(
  { type: "framework", "bom-ref": `pkg:generic/node.js@${nodeVersion}`, name: "Node.js", version: nodeVersion, scope: "required" },
  { type: "application", "bom-ref": `pkg:npm/npm@${npmPackage.version}`, name: "npm", version: npmPackage.version, purl: `pkg:npm/npm@${npmPackage.version}`, scope: "required" },
);
const compilerReceipt = join(dirname(output), 'code/apps/developer/compiler-runtime/distribution.json');
if (existsSync(compilerReceipt)) {
  const compiler = JSON.parse(readFileSync(compilerReceipt, 'utf8'));
  if (!compiler.copiedClosureVerified || !compiler.compiler?.available) throw Error('Compiler SBOM requires a verified copied closure.');
  for (const record of compiler.packages) {
    const purl = `pkg:npm/${record.name.replace(/^@/, '%40')}@${record.version}`;
    let component = components.find(row => row['bom-ref'] === purl);
    if (!component) {
      component = { type: 'library', 'bom-ref': purl, name: record.name, version: record.version, purl, scope: 'required', properties: [] };
      if (record.license) component.licenses = [{ license: { name: record.license } }];
      components.push(component);
    }
    component.properties.push({ name: 'ynx:compilerClosureSha256', value: compiler.manifestSha256 });
  }
}
addPackagedServiceComponents(components, join(dirname(output), 'code/apps/developer'));
components.sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
const serialSeed = createHash("sha256").update(`${sourceCommit}\n${nodeVersion}\n${npmPackage.version}\n${components.map(value => value["bom-ref"]).join("\n")}`).digest("hex");
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${serialSeed.slice(0,8)}-${serialSeed.slice(8,12)}-4${serialSeed.slice(13,16)}-a${serialSeed.slice(17,20)}-${serialSeed.slice(20,32)}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", "bom-ref": "pkg:npm/%40ynx/code-desktop@0.2.0", name: "YNX Code Desktop", version: "0.2.0" },
    properties: [
      { name: "ynx:sourceCommit", value: sourceCommit },
      { name: "ynx:dependencySource", value: "apps/developer/package-lock.json" },
      { name: "ynx:artifactClass", value: "unsigned-testnet-preview" },
    ],
  },
  components,
};
writeFileSync(output, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o644 });
console.log(`Generated CycloneDX SBOM with ${components.length} components for Node ${nodeVersion} and npm ${npmPackage.version}.`);

return sbom;
}

// Read the packaged closure, never import or evaluate its dependency code.
export function addPackagedServiceComponents(components, packagedRoot) {
  if (!existsSync(packagedRoot)) return;
  const root = realpathSync(packagedRoot);
  const inside = target => {
    const real = realpathSync(target);
    const path = relative(root, real);
    if (path === '..' || path.startsWith('..' + sep) || path.startsWith(sep)) throw Error('Service dependency escapes packaged root: ' + target);
    return real;
  };
  const services = join(root, 'services');
  // A retained command symlink can require a service closure even when that
  // closure was omitted entirely; missing services must not silently disappear.
  const bin = join(root, 'node_modules/.bin');
  if (existsSync(bin)) for (const name of readdirSync(bin).sort()) {
    const entry = join(bin, name);
    if (!lstatSync(entry).isSymbolicLink()) continue;
    const target = resolve(dirname(entry), readlinkSync(entry));
    const rel = relative(root, target);
    if (rel === 'services' || rel.startsWith('services' + sep)) inside(entry);
  }
  if (!existsSync(services)) return;
  inside(services);
  const add = folder => {
    inside(folder);
    const metadataPath = join(folder, 'package.json');
    inside(metadataPath);
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (typeof metadata.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(metadata.name) || typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(metadata.version)) throw Error('Invalid required service dependency metadata: ' + metadataPath);
    const purl = 'pkg:npm/' + metadata.name.replace(/^@/, '%40') + '@' + metadata.version;
    let component = components.find(row => row['bom-ref'] === purl);
    if (!component) {
      component = { type: 'library', 'bom-ref': purl, name: metadata.name, version: metadata.version, purl, scope: 'required', properties: [] };
      components.push(component);
    }
    component.scope = 'required';
    component.properties ||= [];
    const location = relative(root, folder).split(sep).join('/');
    if (!component.properties.some(item => item.name === 'ynx:packagedServicePath' && item.value === location)) component.properties.push({ name: 'ynx:packagedServicePath', value: location });
    const license = typeof metadata.license === 'string' ? metadata.license : metadata.license?.type;
    if (license) {
      component.licenses ||= [];
      if (!component.licenses.some(item => item.license?.name === license)) component.licenses.push({ license: { name: license } });
    }
  };
  const walkModules = (modules, ancestors = new Set()) => {
    if (!existsSync(modules)) return;
    const real = inside(modules);
    if (ancestors.has(real)) return;
    const next = new Set(ancestors).add(real);
    for (const name of readdirSync(modules).sort()) {
      if (name.startsWith('.')) continue;
      const entry = join(modules, name);
      const packages = name.startsWith('@') ? readdirSync(inside(entry)).sort().map(child => join(entry, child)) : [entry];
      for (const folder of packages) {
        if (!lstatSync(folder).isDirectory() && !lstatSync(folder).isSymbolicLink()) throw Error('Invalid service dependency entry: ' + folder);
        add(folder);
        walkModules(join(folder, 'node_modules'), next);
      }
    }
  };
  for (const service of readdirSync(services).sort()) {
    const folder = join(services, service);
    if (lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) {
      inside(folder);
      walkModules(join(folder, 'node_modules'));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generateCodeSbom(...process.argv.slice(2));

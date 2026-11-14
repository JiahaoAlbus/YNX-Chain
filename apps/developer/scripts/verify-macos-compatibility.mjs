import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const machoMagic = new Set(["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);
const requiredBinaries = ["Contents/MacOS/YNXDeveloper", "Contents/Resources/runtime/node"];

export function compareVersions(left, right) {
  const parse = value => {
    if (!/^\d+(?:\.\d+){0,2}$/.test(value)) throw new Error(`Invalid macOS version: ${value}`);
    return value.split(".").map(Number);
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return Math.sign((a[i] || 0) - (b[i] || 0));
  return 0;
}

export function parseLoadCommands(output) {
  const result = { minimumOS: null, sdk: null, platform: null, dependencies: [], rpaths: [] };
  for (const block of output.split(/(?:^|\n)Load command \d+\n/)) {
    const command = block.match(/^\s*cmd (LC_[A-Z_]+)/m)?.[1];
    if (command === "LC_BUILD_VERSION") {
      result.minimumOS = block.match(/\bminos ([\d.]+)/)?.[1] || null;
      result.sdk = block.match(/\bsdk ([\d.]+)/)?.[1] || null;
      result.platform = block.match(/\bplatform (\S+)/)?.[1] || null;
    } else if (command === "LC_VERSION_MIN_MACOSX") {
      result.minimumOS = block.match(/\bversion ([\d.]+)/)?.[1] || null;
      result.sdk = block.match(/\bsdk ([\d.]+)/)?.[1] || null;
      result.platform = "1";
    } else if (command === "LC_RPATH") {
      const name = block.match(/\bpath (.+) \(offset \d+\)/)?.[1];
      if (!name) throw new Error("Missing path in LC_RPATH");
      result.rpaths.push(name);
    } else if (["LC_LOAD_DYLIB", "LC_LOAD_WEAK_DYLIB", "LC_REEXPORT_DYLIB", "LC_LOAD_UPWARD_DYLIB", "LC_LAZY_LOAD_DYLIB"].includes(command)) {
      const name = block.match(/\bname (.+) \(offset \d+\)/)?.[1];
      if (!name) throw new Error(`Missing dependency name in ${command}`);
      result.dependencies.push({ command, path: name });
    }
    // LC_ID_DYLIB is the image's own install name, not a load dependency.
  }
  return result;
}

export function inspectBinary(filename) {
  const fd = fs.openSync(filename, "r"), header = Buffer.alloc(4);
  try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
  if (!machoMagic.has(header.toString("hex"))) return null;
  // Java class files can share the FAT magic; let the platform tool identify it.
  if (!execFileSync("/usr/bin/file", ["-b", filename], { encoding: "utf8" }).includes("Mach-O")) return null;
  const architectures = execFileSync("/usr/bin/lipo", ["-archs", filename], { encoding: "utf8" }).trim().split(/\s+/);
  return architectures.map(architecture => ({ architecture, ...parseLoadCommands(execFileSync("/usr/bin/otool", ["-arch", architecture, "-l", filename], { encoding: "utf8" })) }));
}

// Resolve only load commands actually recorded in this image. No host DYLD
// environment, external paths or guesses based on a library basename are used.
function bundledCandidates(binary, slice, dependency) {
  const clean = suffix => suffix && !suffix.includes('\\') && !suffix.includes('\0') && !suffix.split('/').some(part => !part || part === '.' || part === '..');
  if (dependency.path.startsWith('@loader_path/')) {
    const suffix=dependency.path.slice('@loader_path/'.length);
    return clean(suffix)?[path.posix.join(path.posix.dirname(binary.path),suffix)]:[];
  }
  if (!dependency.path.startsWith('@rpath/') || !clean(dependency.path.slice(7)) || !Array.isArray(slice.rpaths) || !slice.rpaths.length) return [];
  const candidates=[];
  for(const rpath of slice.rpaths){
    // swiftc emits this system-owned search directory even without Swift objects.
    if(rpath==='/usr/lib/swift')continue;
    if(typeof rpath!=='string'||rpath.includes('\\')||rpath.includes('\0'))return [];
    const anchor=rpath.startsWith('@executable_path/')?'Contents/MacOS':rpath.startsWith('@loader_path/')?path.posix.dirname(binary.path):null;
    if(!anchor)return [];
    const suffix=rpath.slice(rpath.indexOf('/')+1);
    if(!suffix||suffix.split('/').some(part=>!part||part==='.'))return [];
    const target=path.posix.join(anchor,suffix,dependency.path.slice(7));
    if(!target.startsWith('Contents/'))return [];
    candidates.push(target);
  }
  return [...new Set(candidates)];
}

export function inspectApp(appPath) {
  const root = fs.realpathSync(appPath), binaries = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = fs.realpathSync(filename);
        if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Package symlink escapes application: ${path.relative(root, filename)}`);
        // The target is already enumerated under this application root.
      } else if (entry.isDirectory()) walk(filename);
      else if (entry.isFile()) {
        const slices = inspectBinary(filename);
        if (slices) binaries.push({ path: path.relative(root, filename), slices });
      }
    }
  }
  walk(root);
  for (const binary of binaries) for (const slice of binary.slices) for (const dependency of slice.dependencies) {
    const targets=[];
    for(const candidate of bundledCandidates(binary,slice,dependency)){
      const filename=path.join(root,candidate);
      try {
        const resolved=fs.realpathSync(filename);
        if(resolved!==filename||!resolved.startsWith(root+path.sep)||!fs.lstatSync(resolved).isFile())continue;
        if(binaries.some(item=>item.path===candidate&&item.slices.some(target=>target.architecture===slice.architecture)))targets.push(candidate);
      }catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
    }
    if(targets.length===1)dependency.bundledPath=targets[0];
  }
  const declaredMinimumOS = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print LSMinimumSystemVersion", path.join(root, "Contents/Info.plist")], { encoding: "utf8" }).trim();
  return { declaredMinimumOS, binaries };
}

export function validateCompatibility(inventory, minimumOS, architecture) {
  compareVersions(minimumOS, minimumOS);
  const errors = [];
  if (compareVersions(inventory.declaredMinimumOS, minimumOS)) errors.push(`Info.plist declares ${inventory.declaredMinimumOS}, expected ${minimumOS}`);
  for (const required of requiredBinaries) {
    const binary = inventory.binaries.find(item => item.path === required);
    if (!binary?.slices.some(slice => slice.architecture === architecture)) errors.push(`Missing ${architecture} slice: ${required}`);
  }
  for (const binary of inventory.binaries) for (const slice of binary.slices) {
    const label = `${binary.path} (${slice.architecture})`;
    if (!["1", "macos"].includes(slice.platform) || !slice.minimumOS) {
      errors.push(`Missing macOS deployment target: ${label}`);
      continue;
    }
    if (compareVersions(slice.minimumOS, minimumOS) > 0) errors.push(`${label} requires ${slice.minimumOS}, above ${minimumOS}`);
    if (binary.path === requiredBinaries[0] && compareVersions(slice.minimumOS, minimumOS)) errors.push(`Native shell target ${slice.minimumOS} must equal declared ${minimumOS}`);
    for (const dependency of slice.dependencies) {
      if (/^\/(System\/Library|usr\/lib)\//.test(dependency.path)) continue;
      const targets=bundledCandidates(binary,slice,dependency).map(expected=>inventory.binaries.find(item=>item.path===expected&&item.slices.some(targetSlice=>targetSlice.architecture===slice.architecture))).filter(Boolean);
      const target=targets.length===1&&targets[0].path===dependency.bundledPath?targets[0]:null;
      if (!target?.slices.some(targetSlice => targetSlice.architecture === slice.architecture)) errors.push(`Non-system load dependency requires an explicit bundled resolution: ${label}: ${dependency.path}`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appPath, minimumOS, architecture, output] = process.argv.slice(2);
  if (!appPath || !minimumOS || !["arm64", "x86_64"].includes(architecture) || !output) throw new Error("Usage: verify-macos-compatibility.mjs APP MINIMUM_OS arm64|x86_64 OUTPUT_JSON");
  const inventory = inspectApp(appPath), errors = validateCompatibility(inventory, minimumOS, architecture);
  const report = { schemaVersion: 1, minimumOS, architecture, ...inventory, errors, passed: errors.length === 0 };
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log(`All ${inventory.binaries.length} packaged Mach-O images support deployment target macOS ${minimumOS}; native shell and Info.plist agree.`);
}

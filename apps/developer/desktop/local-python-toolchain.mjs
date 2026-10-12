import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const CLT = '/Library/Developer/CommandLineTools';
async function trustedAncestors(path) {
  for (let parent = dirname(path);; parent = dirname(parent)) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) || await realpath(parent) !== parent) return false;
    if (parent === '/') return true;
  }
}
// Resolve the Apple-owned CLT alias to its real interpreter. Never execute the
// /usr/bin/python3 xcode-select shim or discover a project-supplied executable.
export async function inspectTrustedLocalPython(root = CLT) {
  if (root !== CLT) return null;
  try {
    const entry = join(root, 'usr/bin/python3'), link = await lstat(entry);
    if (link.uid !== 0 || (!link.isSymbolicLink() && (link.mode & 0o022)) || !await trustedAncestors(entry)) return null;
    const executable = await realpath(entry);
    if (!executable.startsWith(root + '/')) return null;
    const binary = await lstat(executable);
    if (!binary.isFile() || binary.isSymbolicLink() || binary.uid !== 0 || (binary.mode & 0o022) || !(binary.mode & 0o111) || !await trustedAncestors(executable)) return null;
    const output = await exec(executable, ['-I', '-S', '-c', 'import json,sys; print(json.dumps({"executable":sys.executable,"version":list(sys.version_info[:3])}))'], {
      env: { PATH: '/usr/bin:/bin', DEVELOPER_DIR: root }, timeout: 5000, maxBuffer: 16384,
    });
    const probe = JSON.parse(output.stdout.trim());
    if (output.stderr.trim() || await realpath(probe.executable) !== executable || !Array.isArray(probe.version) || probe.version.length !== 3 ||
        probe.version.some(value => !Number.isSafeInteger(value) || value < 0) || probe.version[0] !== 3 || probe.version[1] < 8) return null;
    return { executable, version: probe.version.join('.') };
  } catch { return null; }
}

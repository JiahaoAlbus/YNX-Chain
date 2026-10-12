import { spawn } from "node:child_process";
import { chmod, lstat, realpath } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fault } from "./central-identity.mjs";

// Only a new dedicated Btrfs mount is admitted. This never converts the old
// LXD dir pool, deletes an interrupted import or silently relimits user data.
export function createBtrfsProjectStorage({ projectsRoot, maxBytes = 1073741824, run = runBtrfs } = {}) {
  const root = resolve(projectsRoot);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("A bounded project quota is required.");
  async function pathAdmission(path, exists) {
    const suffix = relative(root, path);
    if (!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(suffix)) throw fault("Project quota path is not the exact owner/project volume.", "core_state_unsafe", 503);
    for (const value of [root, dirname(path), ...(exists ? [path] : [])]) {
      const stat = await lstat(value);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022) || await realpath(value) !== value)
        throw fault("Native volume ancestry is not protected.", "core_state_unsafe", 503);
    }
  }
  async function verify(path) {
    await pathAdmission(path, true);
    const shown = await run(["subvolume", "show", path]);
    const id = /^\s*Subvolume ID:\s*(\d+)\s*$/m.exec(shown.stdout)?.[1];
    if (!id) throw fault("Native project is not its own Btrfs subvolume.", "core_disk_quota_unavailable", 503);
    const quota = await run(["qgroup", "show", "--raw", "--sync", "-r", "-e", "-f", path]);
    // Btrfs reports inconsistent accounting on stderr; limits then do not hold.
    if (/inconsistent|rescan|disabled/i.test(quota.stderr || "")) throw fault("Native filesystem quota accounting is not consistent.", "core_disk_quota_unavailable", 503);
    const row = quota.stdout.split("\n").map(x => x.trim().split(/\s+/)).find(x => x[0] === `0/${id}`);
    if (!row || row.length < 5 || row[3] !== String(maxBytes)) throw fault("Native filesystem quota was not enforced at the approved bound.", "core_disk_quota_unavailable", 503);
    // A valid qgroup row is not hostile-project containment: nested subvolumes
    // do not inherit this bound. Preserve recovery inspection, fail new launch.
    return { enforced: false, hardIsolation: false, directory: path, maxBytes, qgroup: `0/${id}`, driver: "btrfs", reason: "nested_subvolume_escape_not_closed" };
  }
  async function prepare(context) {
    const path = context.projectDirectory;
    await pathAdmission(path, false);
    // Existing path is a protected recovery, never a target to overwrite.
    try { await lstat(path); throw fault("A previous project volume requires import review.", "core_import_review_required", 409); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await run(["subvolume", "create", path]); await chmod(path, 0o700);
    await run(["qgroup", "limit", String(maxBytes), path]);
    await verify(path);
  }
  return { prepare, verify };
}
async function runBtrfs(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("btrfs", args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", b => { stdout = (stdout + b).slice(-1048576); }); child.stderr.on("data", b => { stderr = (stderr + b).slice(-4096); });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(fault("Project quota command timed out.", "core_disk_quota_unavailable", 503)); }, 30000);
    child.on("error", () => { clearTimeout(timer); reject(fault("Btrfs project quota backend is unavailable.", "core_disk_quota_unavailable", 503)); });
    child.on("close", code => { clearTimeout(timer); if (code) reject(fault("Btrfs project quota command failed.", "core_disk_quota_unavailable", 503)); else resolve({ stdout, stderr }); });
  });
}

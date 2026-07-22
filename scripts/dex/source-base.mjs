import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const exactCommit = /^[0-9a-f]{40}$/;

export async function resolveSourceBaseCommit(root, sourcePaths) {
  const release = JSON.parse(await readFile(path.join(root, "product-release.json"), "utf8"));
  const commit = String(release.commit ?? "").trim().toLowerCase();
  if (!exactCommit.test(commit)) {
    throw new Error("product-release.json commit must be an exact source Git SHA before packaging");
  }

  execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: root });
  try {
    execFileSync("git", ["diff", "--quiet", commit, "--", ...sourcePaths], { cwd: root });
  } catch {
    throw new Error(`release source changed after ${commit}; update and retest product-release.json before packaging`);
  }
  return commit;
}

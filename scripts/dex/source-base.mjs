import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const exactCommit = /^[0-9a-f]{40}$/;

export async function resolveSourceBaseCommit(root, sourcePaths, sourceCommit) {
  const release = sourceCommit === undefined ? JSON.parse(await readFile(path.join(root, "product-release.json"), "utf8")) : { commit: sourceCommit };
  const commit = String(release.commit ?? "");
  if (!exactCommit.test(commit)) {
    throw new Error("An exact lowercase source Git SHA is required before packaging");
  }

  execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: root });
  try {
    execFileSync("git", ["diff", "--quiet", commit, "--", ...sourcePaths], { cwd: root });
  } catch {
    throw new Error(`release source changed after ${commit}; select and retest the exact product source before packaging`);
  }
  return commit;
}

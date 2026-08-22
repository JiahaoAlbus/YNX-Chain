import {mkdtemp, readFile, writeFile, chmod} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {join, delimiter} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const executor = fileURLToPath(new URL("./social-vercel-alias-executor.mjs", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "social-vercel-executor-fixture-"));
const stub = join(temporary, "vercel");
const state = join(temporary, "deployment-id");
const log = join(temporary, "argv.log");
const rollback = "dpl_2sei8CpmoN1Gi5YKnc6FdvNRyXGy";
const candidate = "dpl_34kzw3uk4B1wwjk1wQUq8y29mTxX";

await writeFile(state, `${rollback}\n`);
await writeFile(stub, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$YNX_SOCIAL_STUB_LOG"
if [ "$1" = api ]; then
  current=$(tr -d '\\n' < "$YNX_SOCIAL_STUB_STATE")
  printf '{"alias":"social.ynxweb4.com","projectId":"prj_QGgUyxilarbPPLZyoES83m2aneQN","deploymentId":"%s"}\\n' "$current"
  exit 0
fi
if [ "$1" = alias ] && [ "$2" = set ]; then
  case "$3" in
    ynx-social-i38c5m9dw-jiahaoalbus-projects.vercel.app) printf '%s\\n' '${candidate}' > "$YNX_SOCIAL_STUB_STATE" ;;
    ynx-social-h8cqxnkud-jiahaoalbus-projects.vercel.app) printf '%s\\n' '${rollback}' > "$YNX_SOCIAL_STUB_STATE" ;;
    *) exit 41 ;;
  esac
  exit 0
fi
exit 42
`);
await chmod(stub, 0o755);

const baseLease = {
  schema: "ynx.social.alias-release-lease.v1",
  status: "ACTIVE_SINGLE_USE",
  product: "social",
  owner: "release-control-plane",
  executor: "apps/social/evidence/release-candidates/social-vercel-alias-executor.mjs",
  pathLock: "vercel:social.ynxweb4.com",
  alias: "social.ynxweb4.com",
  projectId: "prj_QGgUyxilarbPPLZyoES83m2aneQN",
  candidateDeploymentId: candidate,
  candidateSourceCommit: "e7756cb387233376c03043c54fb8b051c241e94e",
  candidateArtifactSha256: "9ffe3eff10175589eeaa7a377e9dc61f3c3a62a77b0a9bcfa415c4764f512b81",
  rollbackDeploymentId: rollback,
  expiresAt: "2099-01-01T00:00:00Z",
  maximumExecutions: 1,
};

const env = {
  ...process.env,
  PATH: `${temporary}${delimiter}${process.env.PATH}`,
  YNX_SOCIAL_EXECUTOR_FIXTURE: "1",
  YNX_SOCIAL_STUB_STATE: state,
  YNX_SOCIAL_STUB_LOG: log,
};

async function execute(action, expectedCurrentDeploymentId) {
  const leasePath = join(temporary, `${action}-lease.json`);
  await writeFile(leasePath, `${JSON.stringify({...baseLease, leaseId: `P0-WALLET-CONNECTIVITY-FIXTURE-${action}`, action, expectedCurrentDeploymentId}, null, 2)}\n`);
  const result = spawnSync(process.execPath, [executor, "--action", action, "--lease", leasePath, "--execute"], {encoding: "utf8", env});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const forward = await execute("forward", rollback);
const rollbackResult = await execute("rollback", candidate);
const calls = (await readFile(log, "utf8")).trim().split("\n");
const expectedCalls = [
  "api /v4/aliases/social.ynxweb4.com --scope jiahaoalbus-projects --raw",
  "alias set ynx-social-i38c5m9dw-jiahaoalbus-projects.vercel.app social.ynxweb4.com --scope jiahaoalbus-projects --non-interactive",
  "api /v4/aliases/social.ynxweb4.com --scope jiahaoalbus-projects --raw",
  "api /v4/aliases/social.ynxweb4.com --scope jiahaoalbus-projects --raw",
  "alias set ynx-social-h8cqxnkud-jiahaoalbus-projects.vercel.app social.ynxweb4.com --scope jiahaoalbus-projects --non-interactive",
  "api /v4/aliases/social.ynxweb4.com --scope jiahaoalbus-projects --raw",
];
if (JSON.stringify(calls) !== JSON.stringify(expectedCalls)) throw new Error(`Unexpected argv log: ${JSON.stringify(calls)}`);
if ((await readFile(state, "utf8")).trim() !== rollback) throw new Error("Fixture did not restore the rollback deployment.");
console.log(JSON.stringify({fixture: "passed", forward, rollback: rollbackResult, calls, productionMutation: false}, null, 2));

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const requestBody = await readFile(new URL("p0-260-wallet-static-sso-window-request.json", new URL(".", import.meta.url)));
const request = JSON.parse(requestBody);
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const fail = (message) => { throw new Error(message); };
const exact = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};

exact(request.taskId, "P0-260", "task");
exact(request.supersedes.status, "CONSUMED_RELEASED_FAILED_CLOSED_WALLET_TEMP_PREFLIGHT_ALIAS_REMOVED", "P0-259 release");
exact(request.candidate.deploymentId, "dpl_CBz4cfFxf9WsMDzeLqzaPJGiXLZd", "candidate deployment");
exact(request.wwwLifecycle.rollbackDeploymentId, "dpl_574RBu3xBzE4Bh1jygv2YJruAYfz", "rollback deployment");
exact(request.boundedSsoWindow.maxDisabledSeconds, 180, "SSO bound");
exact(request.candidateReads.length, 4, "candidate reads");
exact(request.officialReads.length, 4, "official reads");
if (!request.boundedSsoWindow.restoreRequiredOnEveryTerminalPathAfterSuccessfulDisable) fail("SSO restore not mandatory");
if (!request.temporaryAliasLifecycle.removeRequiredAfterAnySuccessfulSet) fail("temporary alias cleanup not mandatory");
if (!request.temporaryAliasLifecycle.removalProofRequiredBeforeWwwMutation) fail("temporary alias proof not before www");
if (!request.boundedSsoWindow.restoreMustCompleteBeforeWwwMutation) fail("SSO restore not before www");

const serializedCommands = JSON.stringify({
  sso: request.boundedSsoWindow,
  temporary: request.temporaryAliasLifecycle,
  reads: request.candidateReads.map(({ argv }) => argv),
  officialReads: request.officialReads.map(({ argv }) => argv),
  www: request.wwwLifecycle
}).toLowerCase();
for (const forbidden of ["--token", "protection-bypass-secret", "blob put", "blob delete", "src/lib/ecosystemcatalog.js", "eth_requestaccounts", "personal_sign", "eth_signtypeddata", "eth_sendtransaction"]) {
  if (serializedCommands.includes(forbidden)) fail(`forbidden command token: ${forbidden}`);
}

const simulate = ({ candidateStatus = 200, setSucceeded = true, candidateTarget = request.candidate.deploymentId, cleanupSucceeded = true, restoreSucceeded = true, elapsedSeconds = 30, officialPassed = true } = {}) => {
  const events = [];
  let ssoDisabled = false;
  let temporaryAliasPresent = false;
  let temporaryAbsentProved = true;
  let ssoRestored = false;
  let wwwSet = false;
  let rollback = false;
  events.push("fresh-precheck");
  events.push("sso-disable"); ssoDisabled = true; ssoRestored = false;
  events.push("sso-disabled-readback");
  events.push("temp-set");
  if (setSucceeded) { temporaryAliasPresent = true; temporaryAbsentProved = false; }
  if (setSucceeded && candidateTarget !== request.candidate.deploymentId) {
    events.push("foreign-temp-target");
  } else if (setSucceeded) {
    events.push("temp-target-readback");
    events.push("candidate-reads");
  }
  const candidatePassed = setSucceeded && candidateTarget === request.candidate.deploymentId && candidateStatus === 200 && elapsedSeconds <= request.boundedSsoWindow.maxDisabledSeconds;
  if (temporaryAliasPresent && candidateTarget === request.candidate.deploymentId) {
    events.push("temp-remove");
    if (cleanupSucceeded) { temporaryAliasPresent = false; temporaryAbsentProved = true; events.push("temp-404-proof"); }
  }
  events.push("sso-restore");
  if (restoreSucceeded) { ssoDisabled = false; ssoRestored = true; events.push("sso-restored-readback"); }
  if (candidatePassed && temporaryAbsentProved && ssoRestored) {
    events.push("www-set"); wwwSet = true;
    events.push("official-reads");
    if (!officialPassed) { events.push("www-rollback"); rollback = true; }
  }
  return { events, ssoDisabled, temporaryAliasPresent, temporaryAbsentProved, ssoRestored, wwwSet, rollback };
};

const happy = simulate();
exact(happy.events, ["fresh-precheck","sso-disable","sso-disabled-readback","temp-set","temp-target-readback","candidate-reads","temp-remove","temp-404-proof","sso-restore","sso-restored-readback","www-set","official-reads"], "happy order");
if (happy.ssoDisabled || happy.temporaryAliasPresent || !happy.wwwSet) fail("happy terminal state");

const negativeCases = [
  ["SSO redirect", { candidateStatus: 302 }],
  ["temporary set failure", { setSucceeded: false }],
  ["foreign temporary target", { candidateTarget: "dpl_foreign" }],
  ["temporary cleanup failure", { cleanupSucceeded: false }],
  ["SSO restore failure", { restoreSucceeded: false }],
  ["SSO window exceeded", { elapsedSeconds: 181 }]
];
for (const [label, options] of negativeCases) {
  const result = simulate(options);
  if (result.wwwSet) fail(`${label} allowed www mutation`);
}

const rollback = simulate({ officialPassed: false });
if (!rollback.wwwSet || !rollback.rollback || rollback.temporaryAliasPresent || rollback.ssoDisabled) fail("www rollback fixture");

console.log(JSON.stringify({
  schemaVersion: 1,
  taskId: request.taskId,
  requestSha256: sha256(requestBody),
  positiveSequenceFixture: true,
  negativeSequenceFixtures: `${negativeCases.length}/${negativeCases.length} fail closed before www`,
  temporaryAliasRemovedAnd404BeforeWww: true,
  ssoRestoredBeforeWww: true,
  ssoWindowMaxSeconds: request.boundedSsoWindow.maxDisabledSeconds,
  wwwRollbackFixture: true,
  candidateDeployment: request.candidate.deploymentId,
  rollbackDeployment: request.wwwLifecycle.rollbackDeploymentId,
  sourceMutation: false,
  blobMutation: false,
  projectMutationExecuted: false,
  aliasMutationExecuted: false,
  accountOrSigningAction: false
}, null, 2));

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const evidencePath=resolve(projectRoot,"evidence/p0-pay-6423-wallet-ui-single-use-lease-request-20260831.json");
const evidence=JSON.parse(readFileSync(evidencePath,"utf8"));
const fail=message=>{throw new Error(`Pay release candidate invalid: ${message}`)};

if(evidence.status!=="PENDING_CENTRAL_BINDING_NO_MUTATION")fail("lease status must remain pending and non-mutating");
if(evidence.scope?.product!=="pay")fail("scope must remain Pay-only");
if(!/^codex\/pay-/.test(evidence.candidate?.branch??""))fail("candidate branch must be an isolated codex/pay branch");
if(!/^[0-9a-f]{40}$/.test(evidence.candidate?.commit??""))fail("candidate commit is not immutable");
if(!/^[0-9a-f]{40}$/.test(evidence.candidate?.tree??""))fail("candidate tree is not immutable");
if(!/^[0-9a-f]{40}$/.test(evidence.currentState?.remoteCommit??""))fail("current remote baseline is not immutable");
if(evidence.rollback?.sourceRollbackCommit!==evidence.currentState.remoteCommit)fail("rollback source must equal the frozen remote baseline");
if(evidence.currentState.publicTarget!==null||evidence.currentState.installedTarget!==null)fail("unleased candidate must not invent a public or installed target");
if(evidence.rollback?.publicRollbackTarget!==null)fail("unleased candidate must not invent a public rollback target");
if(evidence.requestedLease?.executor!=="CENTRAL_RELEASE_EXECUTOR_MUST_BE_NAMED")fail("executor may only be bound by Central");
if(evidence.requestedLease?.expiry!=="CENTRAL_MUST_SET_A_FRESH_EXPLICIT_EXPIRY")fail("lease expiry may only be set by Central");

const gitTree=execFileSync("git",["show","-s","--format=%T",evidence.candidate.commit],{cwd:projectRoot,encoding:"utf8"}).trim();
if(gitTree!==evidence.candidate.tree)fail("candidate commit/tree binding mismatch");
const candidateFile=path=>execFileSync("git",["show",`${evidence.candidate.commit}:apps/pay/${path}`],{cwd:projectRoot,encoding:"utf8"});
const appSource=candidateFile("App.tsx");
for(const marker of ["walletUICopy[locale]","walletTextRef.current.disconnected","WalletIdentity","MetaMask fox logo","YNX Wallet logo","walletText.noProviderTitle","walletText.switchAccount","walletText.disconnect"]){if(!appSource.includes(marker))fail(`candidate Wallet UI marker missing: ${marker}`)}
const walletSource=candidateFile("src/wallet.ts");
for(const marker of ["0x1917","PRIVATE_SERVICE_DEGRADED","WalletConnectionCoordinator"]){if(!walletSource.includes(marker))fail(`candidate provider lifecycle marker missing: ${marker}`)}

const artifactPath=resolve(projectRoot,evidence.artifact.path.replace(/^apps\/pay\//,""));
const artifact=readFileSync(artifactPath);
const artifactSHA256=createHash("sha256").update(artifact).digest("hex");
if(artifactSHA256!==evidence.artifact.sha256)fail("artifact SHA-256 mismatch");
if(statSync(artifactPath).size!==evidence.artifact.bytes)fail("artifact byte length mismatch");
if(evidence.artifact.installable||evidence.artifact.public)fail("local candidate cannot claim installed or public state");

for(const action of ["approve","reject","chainAddSwitchReadback","refreshEventsDisconnectRevoke","personalSign","eip712","testnetSend","walletConnectRelay"]){if(evidence.lifecycleTruth?.[action]!==false)fail(`${action} must remain false without direct runtime evidence`)}
if(!evidence.requestedLease?.prohibitedActions?.includes("eth_requestAccounts"))fail("account-request boundary missing");
if(!evidence.requestedLease?.prohibitedActions?.includes("eth_sendTransaction"))fail("transaction boundary missing");

console.log(`Pay release candidate verified: ${evidence.candidate.commit} ${artifactSHA256}`);

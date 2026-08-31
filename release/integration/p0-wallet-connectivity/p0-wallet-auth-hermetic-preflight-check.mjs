import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const evidence = JSON.parse(readFileSync(new URL('evidence/wallet-auth-registry-v3-hermetic-preflight-a960d100-20260821.json', root)));
const acceptance = JSON.parse(readFileSync(new URL('acceptance/wallet-auth-registry-v3-hermetic-preflight-a960d100-20260821.json', root)));
const queue = JSON.parse(readFileSync(new URL('integration-queue.json', root)));
const campaign = JSON.parse(readFileSync(new URL('active-campaign.json', root)));
const leases = JSON.parse(readFileSync(new URL('execution-leases.json', root)));

if (evidence.independentReview.fullWalletAuthTests.passed !== 347 || evidence.independentReview.fullWalletAuthTests.failed !== 0) throw new Error('Hermetic full suite must be 347/347');
if (!evidence.independentReview.package.repeatSha256Matched) throw new Error('Repeat package digest must match');
if (evidence.productionPreflightBundle.containsSecretsOrStateContents) throw new Error('Preflight bundle cannot contain secrets or state contents');
if (!evidence.productionPreflightBundle.currentStateObservationMustBeRefreshedUnderNewLease) throw new Error('Fresh state digest gate missing');
if (!acceptance.status.includes('DEPLOYABLE_ARTIFACT_REQUIRED')) throw new Error('Acceptance must preserve deployable artifact blocker');
if (acceptance.executionLeaseIssued || acceptance.productionMutationAuthorized) throw new Error('Source/preflight acceptance cannot grant production authority');
if (leases.heavy.owner !== null) throw new Error('Heavy lease must remain unassigned');
if (campaign.wave.executionLease !== 'NONE_P0_039_REMAINS_INVALID') throw new Error('Invalid P0-039 lease must remain invalid');
const ids = queue.tasks.map((item) => item.taskId);
if (new Set(ids).size !== ids.length) throw new Error('Integration queue task IDs must be unique');
const task = queue.tasks.find((item) => item.taskId === 'P0-046');
if (!task || task.sourceCommit !== acceptance.sourceCommit || task.executionLeaseIssued) throw new Error('P0-046 queue binding invalid');

console.log('P0 Wallet/Auth hermetic source and production-preflight acceptance check passed.');

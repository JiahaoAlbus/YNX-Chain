#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {basename,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createTarGz,sha256} from './finance-v3-acceptance-recovery-lib.mjs';

const repoRoot=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:dirname(fileURLToPath(import.meta.url)),encoding:'utf8'}).trim();
const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error(`missing ${name}`);return args[i+1]};
const source=arg('--source'),output=arg('--output');
if(!/^[0-9a-f]{40}$/.test(source))throw new Error('source must be lowercase 40-hex');
execFileSync('git',['cat-file','-e',`${source}^{commit}`],{cwd:repoRoot});
if(execFileSync('git',['status','--porcelain'],{cwd:repoRoot,encoding:'utf8'}).trim())throw new Error('FINANCE_RECOVERY_WORKTREE_NOT_CLEAN');
const tree=execFileSync('git',['rev-parse',`${source}^{tree}`],{cwd:repoRoot,encoding:'utf8'}).trim();
const createdAt=new Date(execFileSync('git',['show','-s','--format=%cI',source],{cwd:repoRoot,encoding:'utf8'}).trim()).toISOString();
const prefix=`finance-v3-acceptance-recovery-${source.slice(0,12)}`;
const tracked=execFileSync('git',['ls-tree','-r','--name-only',source],{cwd:repoRoot,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const exact=new Set([
  'go.mod','go.sum','apps/finance/package.json','apps/finance/WEEKLY_V3_HANDOFF.md','apps/finance/PROVIDER_ACTIVATION.md','apps/finance/PROVIDER_INTEGRATION.md','apps/finance/STATUS_MATRIX.md',
  'apps/wallet/artifact-publication-1.0.18.json','apps/wallet/proof/wallet-android-1.0.18-publication-20260921.json','apps/wallet/proof/wallet-android-1.0.18-source-candidate-20260921.json',
]);
const prefixes=['internal/finance/','apps/finance/cmd/','apps/finance/integration/wallet-auth/','apps/finance/tests/'];
const evidence=new Set([
  'apps/finance/evidence/finance-revocation-strictness-20260921.json','apps/finance/evidence/finance-weekly-v3-credential-independent-final-20260920.json',
  'apps/finance/evidence/finance-weekly-v3-local-activation-readonly-20260921.json','apps/finance/evidence/finance-weekly-v3-activation-lifecycle-truth-20260920.json',
  'apps/finance/evidence/finance-order-status-recovery-20260920.json','apps/finance/evidence/finance-reconciliation-identity-fence-20260920.json',
  'apps/finance/evidence/finance-provider-error-classification-fence-20260920.json','apps/finance/evidence/finance-wallet-key-rotation-fence-20260920.json',
  'apps/finance/evidence/finance-execution-idempotency-fence-20260920.json','apps/finance/evidence/finance-trading-account-required-fences-20260919.json',
]);
const scripts=new Set(['apps/finance/scripts/finance-v3-acceptance-recovery-lib.mjs','apps/finance/scripts/build-finance-v3-acceptance-recovery.mjs','apps/finance/scripts/verify-finance-v3-acceptance-recovery.mjs']);
const selected=tracked.filter(path=>exact.has(path)||evidence.has(path)||scripts.has(path)||prefixes.some(prefix=>path.startsWith(prefix))).sort();
if(!selected.includes('apps/wallet/artifact-publication-1.0.18.json'))throw new Error('FINANCE_RECOVERY_WALLET_1_0_18_EVIDENCE_MISSING');
const files=selected.map(path=>{const body=execFileSync('git',['show',`${source}:${path}`],{cwd:repoRoot,maxBuffer:64*1024*1024});return {path:`${prefix}/repository/${path}`,body,mode:path.includes('/scripts/')||path.endsWith('.sh')?0o755:0o644}});
const inventory=files.map(file=>({path:file.path.slice(`${prefix}/repository/`.length),bytes:file.body.length,sha256:sha256(file.body),mode:file.mode===0o755?'0755':'0644'}));
const wallet=JSON.parse(execFileSync('git',['show',`${source}:apps/wallet/artifact-publication-1.0.18.json`],{cwd:repoRoot,encoding:'utf8'}));
if(wallet.version!=='1.0.18-testnet-preview'||wallet.productionSigned!==false||wallet.storeReleased!==false)throw new Error('FINANCE_RECOVERY_WALLET_TRUTH_MISMATCH');
const manifest={
  schemaVersion:'ynx.finance.v3.acceptance-recovery.v1',source:{commit:source,tree},createdAt,
  scope:{product:'YNX Finance',credentialIndependent:true,credentialsBundled:false,deploymentPerformed:false},
  walletReleaseEvidence:{version:wallet.version,sourceCommit:wallet.sourceCommit,releaseTag:wallet.releaseTag,releaseImmutable:wallet.releaseImmutable,downloadTimeSha256Verified:wallet.downloadTimeSha256Verified,productionSigned:wallet.productionSigned,storeReleased:wallet.storeReleased,walletConnectRelayE2E:wallet.walletConnectRelayE2E,artifacts:wallet.artifacts.filter(item=>item.name.startsWith('android-release-')).map(({name,filename,bytes,sha256,signingClass,productionSigned,url})=>({name,filename,bytes,sha256,signingClass,productionSigned,url}))},
  acceptance:{financeRevocationStrictness:'SOURCE_AND_TEST_EVIDENCE_INCLUDED',alpacaBrokerSandboxAdapter:'IMPLEMENTED_CREDENTIAL_INDEPENDENTLY',accountOrderPositionReconciliation:'IMPLEMENTED_CREDENTIAL_INDEPENDENTLY',aiOrderDraft:'DRAFT_ONLY_NO_EXECUTION_AUTHORITY',activationDiagnostics:'LOCAL_READ_ONLY_AND_CONFIGURATION_ONLY',currentContractTests:'INCLUDED'},
  externalTruth:{officialAlpacaIntegration:'NOT_VERIFIED',credentials:'NOT_VERIFIED',officialSandboxAccount:'NOT_VERIFIED',providerNetworkRead:'NOT_VERIFIED',providerOrderWrite:'NOT_VERIFIED',realOrder:'NOT_VERIFIED',liveTrading:false,mainnet:false,publicDeployment:false,productionSigning:false,walletConnectRelayE2E:'NOT_VERIFIED',physicalDeviceApproval:'NOT_VERIFIED'},
  recovery:{checkout:`git checkout ${source}`,verify:`node apps/finance/scripts/verify-finance-v3-acceptance-recovery.mjs --archive ${basename(output)} --source ${source}`,tests:['go test -race ./internal/finance/... ./apps/finance/cmd/...','go vet ./internal/finance/... ./apps/finance/cmd/...','go build ./apps/finance/cmd/...','npm --prefix apps/finance test','npm --prefix apps/finance run security','npm --prefix apps/finance run smoke'],secretsIncluded:false},
  files:inventory,
};
const manifestBody=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`);
const entries=[...files,{path:`${prefix}/manifest.json`,body:manifestBody,mode:0o644}];
const archive=createTarGz(entries,{mtime:createdAt});
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,archive);
const sidecar={schemaVersion:'ynx.finance.v3.acceptance-recovery-sidecar.v1',source:{commit:source,tree},bundleRoot:prefix,archive:{path:basename(output),bytes:archive.length,sha256:sha256(archive)},manifest:{bytes:manifestBody.length,sha256:sha256(manifestBody)},entryCount:entries.length};
writeFileSync(`${output}.manifest.json`,`${JSON.stringify(sidecar,null,2)}\n`);
process.stdout.write(`${JSON.stringify(sidecar)}\n`);

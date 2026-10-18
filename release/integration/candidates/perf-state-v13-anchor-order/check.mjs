import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {validateCandidate as validateParent} from '../perf-state-v13-seal-compact-default/check.mjs';

export const SOURCE_COMMIT='b3c0b8b2e9349ec73b4aa8d0e613ed7e517582d3';
export const INTERNAL_TREE='cfbd76d52a6e22ebfae809699a37b6c039cb20f5';
export const PARENT_SOURCE='2b5c51d3baca54a88510bb9d461807f957063249';
export const EXPECTED_CONTRACT={"schema":"ynx-perf-anchor-order-qualification/v1","version":"1.13.0-source-candidate.7","profile":"perf-state-v13-anchor-order","sourceCommit":"b3c0b8b2e9349ec73b4aa8d0e613ed7e517582d3","internalTree":"cfbd76d52a6e22ebfae809699a37b6c039cb20f5","measuredRuntimeCommit":"3008845b6b4135b8f968fe4365722588be00f1b0","parentFixedSource":"2b5c51d3baca54a88510bb9d461807f957063249","parentCandidate":"perf-state-v13-seal-compact-default","stateVersion":13,"applicationVersion":19,"appHashDomain":"YNX_ABCI_STATE_V13","runtimeChanges":"two boolean short-circuit operand orderings only; full semantic validation and full AppHash retained","evidenceSHA256":"075d99372ca80eb3ea0d68479d8188aa745fa1919f7b41823c83d9bd585ee47d","evidenceRun":39129340679,"evidenceWholeRunConclusion":"failure","evidenceFailedGate":"Verify fixed unpublished compact-default V13 integration contract","fullGoSourcePassed":true,"validationCostMeasured":true,"normalMatchingCIVerified":false,"deployed":false,"nodeCutover":false,"businessTPS":null,"networkFinalityMeasured":false,"originalSupplyCandidateUnchanged":{"sourceCommit":"599fa7eebf5aa4f1472fe80a1d308e6915600a02","internalTree":"db59fb367d5c7382756ba8f6ebc2d50e5d9639fc"}};
const own=path.dirname(fileURLToPath(import.meta.url));
export const repository=path.resolve(own,'../../../..');
const parentBundle='release/integration/candidates/perf-state-v13-seal-compact-default';
const evidencePath='docs/performance/evidence/anchor-order-validation-ci-39129340679-actual.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
const requireValue=(value,message)=>{if(!value)throw Error(message)};
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:16*1024*1024});
const immutable=(repo,commit,name)=>git(repo,'show',commit+':'+name);
const pin=raw=>({bytes:raw.length,sha256:hash(raw)});
const readJSON=p=>JSON.parse(fs.readFileSync(p,'utf8'));

export function loadCandidate(){
 return {contract:readJSON(path.join(own,'qualification.json')),map:readJSON(path.join(own,'source-map.json')),evidence:readJSON(path.join(own,'validation-cost-actual.json'))};
}
export function validateCandidate({repository:repo=repository,documents=loadCandidate()}={}){
 const {contract,map,evidence}=documents;
 requireValue(isDeepStrictEqual(contract,EXPECTED_CONTRACT),'anchor qualification source or claim drift');
 // Preserve the supplier's eleven leaves and original immutable-source
 // assertions. Its current-source identity guard is not claimed to pass here.
 const parentNames=['README.md','SHA256SUMS','chain-core-contract.json','check.mjs','check.test.mjs','cross-product-test-vectors.json','inherited-profile.mjs','product-release.json','source-map.json'].map(n=>parentBundle+'/'+n);
 parentNames.push('scripts/verify/perf-v13-seal-compact-default-integration-check.mjs','scripts/verify/perf-v13-seal-compact-default-integration-check.test.mjs');
 for(const name of parentNames)requireValue(fs.readFileSync(path.join(repo,name)).equals(immutable(repo,SOURCE_COMMIT,name)),'parent candidate or guard changed: '+name);
 const parentMap=JSON.parse(immutable(repo,SOURCE_COMMIT,parentBundle+'/source-map.json'));
 const paths=[...new Set([...Object.keys(parentMap.files),...Object.keys(parentMap.kernelDerivation.kernelFiles),...Object.keys(parentMap.sealWitnessDerivation.files),'internal/consensus/state_anchor_cost_test.go',evidencePath])].sort();
 const expectedMap={schema:'ynx-anchor-order-source-map/v1',sourceCommit:SOURCE_COMMIT,internalTree:INTERNAL_TREE,parentFixedSource:PARENT_SOURCE,files:Object.fromEntries(paths.map(p=>[p,pin(immutable(repo,SOURCE_COMMIT,p))]))};
 requireValue(isDeepStrictEqual(map,expectedMap),'anchor complete source inventory/hash drift');
 for(const p of paths)requireValue(fs.readFileSync(path.join(repo,p)).equals(immutable(repo,SOURCE_COMMIT,p)),'current anchor source differs: '+p);
 requireValue(git(repo,'rev-parse','HEAD:internal').toString().trim()===INTERNAL_TREE,'current complete internal tree differs');
 git(repo,'diff','--quiet',SOURCE_COMMIT,'--','internal');
 requireValue(!git(repo,'ls-files','--others','--exclude-standard','--','internal').toString().trim(),'untracked internal input refused');
 const original=immutable(repo,PARENT_SOURCE,'internal/consensus/state.go').toString();
 const expectedState=original.replace('if accountsEqual(state.Accounts, migration.Accounts) && !state.hasApplicationRecords() {','if !state.hasApplicationRecords() && accountsEqual(state.Accounts, migration.Accounts) {').replace('if !accountsEqual(s.Accounts, migration.Accounts) || s.hasApplicationRecords() {','if s.hasApplicationRecords() || !accountsEqual(s.Accounts, migration.Accounts) {');
 requireValue(expectedState!==original&&immutable(repo,SOURCE_COMMIT,'internal/consensus/state.go').toString()===expectedState,'runtime delta is not exactly the two anchor orderings');
 const proof=immutable(repo,SOURCE_COMMIT,evidencePath);
 requireValue(hash(proof)===EXPECTED_CONTRACT.evidenceSHA256&&isDeepStrictEqual(evidence,JSON.parse(proof)),'measured validation evidence changed');
 requireValue(evidence.sourceCommit===EXPECTED_CONTRACT.measuredRuntimeCommit&&evidence.internalTree===INTERNAL_TREE&&evidence.runId===EXPECTED_CONTRACT.evidenceRun,'measurement identity differs');
 requireValue(evidence.runConclusion==='failure'&&isDeepStrictEqual(evidence.failedSteps,[EXPECTED_CONTRACT.evidenceFailedGate])&&evidence.fullGoAndNewCounterexamples==='success'&&evidence.matchedMeasurement==='success','measurement gate boundaries differ');
 const parentResult=validateParent({repository:repo});
 return {profile:EXPECTED_CONTRACT.profile,sourceCommit:SOURCE_COMMIT,internalTree:INTERNAL_TREE,currentSourceFilesMatched:paths.length,parentOriginalSourceValidated:parentResult.sourceCommit,version:EXPECTED_CONTRACT.version,validationCostMeasured:true,normalMatchingCIVerified:false,deployed:false,businessTPS:null,networkFinalityMeasured:false};
}

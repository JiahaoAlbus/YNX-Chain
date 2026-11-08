#!/usr/bin/env node
// Reuse the original PUBLIC same-owner fixture and real source helper. Only
// Git/GitHub observations are controls; no helper stub returns success.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const repo=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(repo,'scripts/verify/public-bft-same-owner-check.mjs'),'utf8');
const fixture=source.slice(0,source.indexOf('const before=fs.readFileSync(reviewPath);'));
assert.ok(fixture.includes("write('approval.json',rawApproval)"));
const ci=source.slice(source.indexOf('const officialRef='),source.indexOf('const bound=bindSameOwnerRelease'))+source.match(/^const ci=.*;$/m)[0]+'\n';
const transport=source.slice(source.indexOf("const bin=path.join(root,'control-bin');"),source.indexOf('const sourceCLI='));
const final=source.slice(source.indexOf("const g=Buffer.from('{\"synthetic\":\"control only\"}');"),source.indexOf('const finalProjection='));
assert.ok(ci.includes('const ci='));assert.ok(transport.includes('CONTROL_GH_TRACE'));assert.ok(final.includes("write('final-approval.json',fullApproval)"));
const test=String.raw`
const gate=fs.readFileSync(path.join(repo,'scripts/verify/consensus-candidate-deploy-gate.sh'),'utf8');
const begin=gate.indexOf('if [[ "$(git branch --show-current)" != main ]]');
assert.ok(begin>=0);
const guard=gate.slice(begin,gate.indexOf('\n[[ -z "$(git status',begin));
const originalGit=fs.readFileSync(gitControl,'utf8');
fs.writeFileSync(gitControl,originalGit.replace('case "$*" in','case "$*" in\n \'branch --show-current\') printf \'%s\\n\' "'+officialRef.slice('refs/heads/'.length)+'";;'),{mode:0o700});
const env={...controlEnv,PUBLIC_BFT_CUTOVER_MODE:'continue-native',PUBLIC_BFT_CUTOVER_APPROVAL_FILE:path.join(root,'final-approval.json'),PUBLIC_BFT_CUSTODY_REVIEW_FILE:reviewPath};
const run=(body,extra={})=>spawnSync('bash',['-c','set -euo pipefail\n'+body],{cwd:repo,encoding:'utf8',timeout:10000,env:{...env,...extra}});
// Actual old standalone gate refuses a qualified original normal ref.
const old=run('[[ "$(git branch --show-current)" == "main" ]] || { echo old-main-only >&2; exit 1; }');
assert.equal(old.status,1);assert.match(old.stderr,/old-main-only/);
const good=run(guard);assert.equal(good.status,0,good.stderr);
assert.equal(JSON.parse(good.stdout).sourceEligible,true);assert.equal(JSON.parse(good.stdout).operationAuthorized,false);
for(const bad of [{CONTROL_DIRTY:' M source'},{CONTROL_REF:'refs/heads/codex/unapproved'},{CONTROL_GH_FAIL:'1'},{PUBLIC_BFT_CUTOVER_MODE:'prepare-native'},{PUBLIC_BFT_CUTOVER_APPROVAL_FILE:rawPath}]) {
 const result=run(guard,bad);assert.notEqual(result.status,0,JSON.stringify(bad));assert.equal(result.stdout,'');
}
const broken={...ci,conclusion:'failure'};write('ci-control.json',broken);
assert.notEqual(run(guard).status,0);
assert.deepEqual(fs.readFileSync(path.join(root,'final-approval.json')),Buffer.from(JSON.stringify(fullApproval)+'\n'));
console.log(JSON.stringify({version:'YNX-LINUX-PUBLIC-RELEASE-GATE-CONTROLS/v1',oldMainGuardRed:true,fixedOriginalHelperPass:true,negativeControls:6,syntheticOnly:true,actualAuthorization:false}));
} finally { /* PUBLIC inputs retained in the test's fresh directory. */ }
`;
const file=path.join(repo,'scripts/verify/.public-linux-gate-control-'+process.pid+'.mjs');
fs.writeFileSync(file,fixture+ci+transport+final+test,{flag:'wx',mode:0o600});
const result=spawnSync(process.execPath,[file],{cwd:repo,encoding:'utf8',timeout:30000});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
// Only the newly-created test program is removed; public fixture/evidence stays.
fs.unlinkSync(file);assert.equal(result.status,0,result.stderr);

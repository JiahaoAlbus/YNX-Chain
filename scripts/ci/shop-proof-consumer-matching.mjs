import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const role=path.join(root,'packages/wallet-auth/native/shop-proof-consumer-role');
const manifest=JSON.parse(fs.readFileSync(path.join(role,'INPUTS.json'),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(manifest.files.length!==154||manifest.executedInputs!==156||manifest.testOnly!==true)throw Error('ROLE_MANIFEST_INVALID');
for(const x of manifest.files){
 if(!/^[A-Za-z0-9_.\/-]+$/.test(x.path)||x.path.split('/').includes('..'))throw Error('ROLE_PATH_INVALID');
 const p=path.join(role,x.path),st=fs.lstatSync(p);if(!st.isFile()||st.isSymbolicLink())throw Error('ROLE_REGULAR_FILE_REQUIRED');
 const b=fs.readFileSync(p);if(b.length!==x.bytes||sha(b)!==x.sha256)throw Error('ROLE_PIN_DRIFT: '+x.path);
}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'packages/wallet-auth/package.json'),'utf8'));
if(pkg.files.some(x=>x==='native'||x.startsWith('native/shop-proof-consumer-role')))throw Error('PUBLIC_FIXTURE_MUST_NOT_ENTER_NPM_FILES');
const plan={schema:'YNX_SHOP_PROOF_MATCHING_CI_PLAN_V1',staticInputs:154,executedInputs:156,selector:'^TestShopProofConsumerMatching$',race:true,top:1,subcases:7,wholeBudgetMs:90000,reapReserveMs:6000,productionArchive:false,RootAdmission:false,SourceAdmission:false,normalCgoPositive:false};
if(process.argv.length===3&&process.argv[2]==='--plan'){console.log(JSON.stringify(plan,null,2));process.exit(0);}
if(process.argv.length!==2)throw Error('ZERO_ARGUMENT_CI_ENTRY_REQUIRED');
const out=process.env.SHOP_MATCHING_CI_OUTPUT;
if(!out||!path.isAbsolute(out)||fs.realpathSync(out)!==out)throw Error('OWNED_OUTPUT_REQUIRED');
fs.writeFileSync(path.join(out,'PLAN.json'),JSON.stringify(plan,null,2),{flag:'wx'});
const go=process.env.LINK_SHOP_PROOF_MATCHING_GO;if(!go||fs.realpathSync(go)!==go)throw Error('FIXED_SETUP_GO_REQUIRED');
const version=spawnSync(go,['version'],{encoding:'utf8',timeout:10000});
if(version.status!==0||!/^go version go1\.26\.10 /.test(version.stdout))throw Error('GO_1_26_10_REQUIRED');
fs.writeFileSync(path.join(out,'GO_VERSION.txt'),version.stdout);
// Populate only the pinned normal x/sys module before the offline 90s runner.
const mod=fs.readFileSync(path.join(role,'source/productreadsource/go.mod'),'utf8').replace(/^replace github.com\/JiahaoAlbus\/YNX-Chain => .*$/m,'replace github.com/JiahaoAlbus/YNX-Chain => '+JSON.stringify(path.join(role,'link-source')));
const modfile=path.join(out,'cache.mod');fs.writeFileSync(modfile,mod,{flag:'wx'});fs.copyFileSync(path.join(role,'source/productreadsource/go.sum'),path.join(out,'cache.sum'));
const env={...process.env,GOTOOLCHAIN:'local',GOWORK:'off',LINK_SHOP_PROOF_MATCHING_LINK_ROOT:path.join(role,'link-source')};
const dep=spawnSync(go,['mod','download','-modfile='+modfile,'golang.org/x/sys@v0.48.0'],{cwd:path.join(role,'source/productreadsource'),env,encoding:'utf8',timeout:120000,maxBuffer:1<<20});
fs.writeFileSync(path.join(out,'DEPENDENCY.stdout'),dep.stdout??'');fs.writeFileSync(path.join(out,'DEPENDENCY.stderr'),dep.stderr??'');
if(dep.status!==0)throw Error('PINNED_DEPENDENCY_DOWNLOAD_FAILED');
// The frozen runner remains byte-identical and controls compile/test/reaping.
const run=spawnSync(process.execPath,[path.join(role,'run-matching-r3.mjs')],{env,stdio:'inherit'});
if(run.error)throw run.error;process.exitCode=run.status??1;

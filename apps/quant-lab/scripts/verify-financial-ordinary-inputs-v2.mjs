import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const root=fileURLToPath(new URL('../../../',import.meta.url));
export const manifestPath=path.join(root,'apps/quant-lab/integration/financial-ordinary-publication-inputs-v2-20261003.json');
const expectedPaths=[
  'apps/finance/web/app.js','apps/finance/tests/broker-snapshot-view-ownership.test.mjs',
  'apps/exchange/web/app.js','apps/exchange/web/market-data.js','apps/exchange/tests/market-data.test.mjs',
  'apps/exchange/tests/owned-controls-browser.test.mjs','apps/exchange/tests/locale-browser.test.mjs',
  'apps/quant-lab/web/app.js','apps/quant-lab/tests/business-flow.test.mjs','apps/quant-lab/tests/browser.test.mjs',
  'apps/quant-lab/tests/research-recovery-browser.test.mjs'
];
const truthKeys=['deployed','publicSourceBound','publicMultiUserVerified','walletApprovalVerified','productSessionVerified','installedVerified','productComplete'];
const gate=(condition,label)=>{if(!condition)throw Error(label);};
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:4*1024*1024});
const text=args=>git(args).toString('utf8').trim();
export function verify(manifest,{requireWorkingBytes=true}={}){
  gate(manifest.schemaVersion==='ynx-financial-ordinary-inputs-v2','schema');
  gate(manifest.classification==='ORDINARY_HUNKS_NOT_RELEASE_AUTHORITY'&&manifest.integrationMode==='ORDINARY_HUNKS_ONLY'&&manifest.releaseAuthority==='wallet_release_owner','authority');
  gate(manifest.retainBaseStorageFences===true&&manifest.baseManifest==='apps/quant-lab/integration/ordinary-publication-successor-20261003.json','base fences');
  for(const [commit,tree] of [[manifest.sourceCommit,manifest.sourceTree],[manifest.baseSourceCommit,manifest.baseSourceTree]]){
    gate(/^[a-f0-9]{40}$/.test(commit)&&/^[a-f0-9]{40}$/.test(tree),'commit/tree format');
    gate(text(['rev-parse',commit+'^{tree}'])===tree,'source tree');
  }
  git(['merge-base','--is-ancestor',manifest.baseSourceCommit,manifest.sourceCommit]);
  gate(manifest.truth&&Object.keys(manifest.truth).length===truthKeys.length&&truthKeys.every(key=>manifest.truth[key]===false),'unproven truth');
  gate(Array.isArray(manifest.objects)&&manifest.objects.length===expectedPaths.length,'object set');
  const seen=new Set();
  for(const object of manifest.objects){
    gate(expectedPaths.includes(object.path)&&!seen.has(object.path),'path/duplicate');
    seen.add(object.path);
    gate(/^[a-f0-9]{40}$/.test(object.blob)&&/^[a-f0-9]{64}$/.test(object.sha256)&&Number.isSafeInteger(object.bytes)&&object.bytes>0,'object metadata');
    gate(text(['rev-parse',manifest.sourceCommit+':'+object.path])===object.blob,'source blob');
    const bytes=git(['cat-file','blob',object.blob]);
    gate(bytes.length===object.bytes&&createHash('sha256').update(bytes).digest('hex')===object.sha256,'source bytes/digest');
    const local=path.join(root,object.path);
    if(requireWorkingBytes)gate(lstatSync(local).isFile()&&!lstatSync(local).isSymbolicLink()&&readFileSync(local).equals(bytes),'working bytes');
  }
  return {classification:requireWorkingBytes?'LOCAL_EXACT_SOURCE_NOT_RELEASE_PROOF':'ARCHIVED_EXACT_SOURCE_NOT_CURRENT_RUNTIME',sourceCommit:manifest.sourceCommit,sourceTree:manifest.sourceTree,verifiedObjects:seen.size,passed:true,publicVerified:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verify(JSON.parse(readFileSync(manifestPath,'utf8')))));

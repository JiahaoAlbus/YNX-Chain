// TEST ONLY: mechanical successor of Auth's prepare-public-runtime.mjs.
// No install, crypto execution, Source construction, permission or production row.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const BUNDLES=Object.freeze(['@ynx/batch-v01-candidate','@ynx-chain/open-protocol','@noble/hashes','@noble/curves','@noble/ciphers','@noble/post-quantum']);
const digest=b=>createHash('sha256').update(b).digest('hex');
function realDirectory(p){if(!path.isAbsolute(p)||path.normalize(p)!==p||fs.realpathSync(p)!==p||!fs.statSync(p).isDirectory())throw Error('canonical absolute existing directory required: '+p);return p;}
export function stagePublicRuntime({sdkRoot,fixturesRoot,safeParent,runner,evidence},originals){
 for(const p of [sdkRoot,fixturesRoot,safeParent,evidence])realDirectory(p);
 if([sdkRoot,fixturesRoot].some(p=>safeParent===p||safeParent.startsWith(p+path.sep)))throw Error('staging parent overlaps supplier');
 if(!path.isAbsolute(runner)||path.normalize(runner)!==runner||fs.realpathSync(runner)!==runner||!fs.statSync(runner).isFile())throw Error('canonical original runner required');
 const readPinned=(p,ref)=>{const b=fs.readFileSync(p);if(b.length!==ref.bytes||digest(b)!==ref.sha256)throw Error('original pin mismatch: '+p);return b;};
 // Verify required SDK originals, the two exact soleSDK PUBLIC fixtures and the
 // unchanged Auth runner BEFORE creating a staging directory.
 for(const ref of originals.sdkRequired)readPinned(path.join(sdkRoot,ref.relativePath),ref);
 for(const ref of originals.sdkFixtures)readPinned(path.join(fixturesRoot,ref.relativePath),ref);
 const runnerRaw=readPinned(runner,originals.authRunner);
 for(const name of BUNDLES)if(!fs.statSync(path.join(sdkRoot,'node_modules',name)).isDirectory())throw Error('missing canonical package bundle '+name);
 const root=fs.mkdtempSync(path.join(safeParent,'PUBLIC-receiver-runtime-'));fs.chmodSync(root,0o700);
 const copies=[];
 function copyFile(from,to){const b=fs.readFileSync(from);fs.mkdirSync(path.dirname(to),{recursive:true,mode:0o755});fs.writeFileSync(to,b,{flag:'wx',mode:0o644});copies.push({source:fs.realpathSync(from),path:to,bytes:b.length,sha256:digest(b)});}
 function copyTree(from,to,extensions){const real=fs.realpathSync(from);for(const n of fs.readdirSync(real).sort()){const a=path.join(real,n),b=path.join(to,n),s=fs.lstatSync(a);if(s.isSymbolicLink())throw Error('nested source symlink not permitted: '+a);if(s.isDirectory())copyTree(a,b,extensions);else if(s.isFile()&&extensions.test(n))copyFile(a,b);}}
 // Exactly the supplier's JS/JSON native+src and top-level JSON families.
 for(const name of ['native','src'])copyTree(path.join(sdkRoot,name),path.join(root,name),/\.(?:js|mjs|json)$/);
 for(const name of fs.readdirSync(sdkRoot).filter(n=>n.endsWith('.json')).sort())copyFile(path.join(sdkRoot,name),path.join(root,name));
 // The normal official package carries these six bundled providers. Do not
 // copy arbitrary node_modules or the original 4633-file workstation tree.
 for(const name of BUNDLES)copyTree(path.join(sdkRoot,'node_modules',name),path.join(root,'node_modules',name),/\.(?:js|mjs|json|wasm)$/);
 for(const ref of originals.sdkFixtures)copyFile(path.join(fixturesRoot,ref.relativePath),path.join(root,'test/fixtures',ref.relativePath));
 const runnerDest=path.join(root,'native/original-task-read-receiver-qualification-runner.mjs');
 if(fs.existsSync(runnerDest))throw Error('SDK unexpectedly owns Auth runner');
 fs.writeFileSync(runnerDest,runnerRaw,{flag:'wx',mode:0o644});copies.push({source:runner,path:runnerDest,bytes:runnerRaw.length,sha256:digest(runnerRaw)});
 const refs=copies.filter(x=>x.bytes>0).map(x=>({Path:x.path,Bytes:x.bytes,SHA256:x.sha256}));
 if(refs.length>4096)throw Error('receiver runtime inventory exceeds production bound');
 fs.writeFileSync(path.join(root,'PUBLIC-runtime-inventory.json'),JSON.stringify(refs),{flag:'wx'});
 const result={schema:'LINK_PUBLIC_RECEIVER_RUNTIME_STAGING/v1',root,copies,sourceCommit:originals.sdkCommit,bundles:BUNDLES,normalPackageAdmission:false,RootAdmission:false,SourceAdmission:false,cryptoExecuted:false};
 fs.writeFileSync(path.join(evidence,'PUBLIC-RUNTIME-STAGING.json'),JSON.stringify(result,null,2),{flag:'wx'});
 return result;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 if(process.argv.length!==7)throw Error('usage: node prepare-public-runtime.mjs SDK_ROOT SDK_FIXTURES_ROOT SAFE_PARENT ORIGINAL_AUTH_RUNNER EVIDENCE');
 const originals=JSON.parse(fs.readFileSync(new URL('./ORIGINALS.json',import.meta.url)));
 console.log(stagePublicRuntime({sdkRoot:process.argv[2],fixturesRoot:process.argv[3],safeParent:process.argv[4],runner:process.argv[5],evidence:process.argv[6]},originals).root);
}

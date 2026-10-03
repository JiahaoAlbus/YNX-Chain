// Adopt only a byte-verified frozen browser bundle in owned Media paths.
// Legacy files remain exact, and existing browser storage is never accessed.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const [packageDirectory,candidateDirectory]=process.argv.slice(2);
if(!packageDirectory||!candidateDirectory)throw Error('Explicit frozen package and built candidate required');
const root=fileURLToPath(new URL('../../../',import.meta.url)),base=resolve(packageDirectory),candidate=resolve(candidateDirectory);
const digest=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const expected='91212923c02e9ca213b628a1793e4d6b4cb435dd3f3eda6e817c0e598d6869b7';
const manifestBytes=readFileSync(join(base,'freeze-manifest.json'));if(digest(manifestBytes).sha256!==expected)throw Error('Wrong frozen package');
const manifest=JSON.parse(manifestBytes),metadata=JSON.parse(readFileSync(join(candidate,'candidate-source.json'))),bundle=readFileSync(join(candidate,'product-session-sdk.js'));
if(metadata.sdkSourceCommit!=='5c5e8a234206e306b6044deb6e938c1763ac7005'||metadata.frozenPackageManifestSHA256!==expected||metadata.output.sha256!==digest(bundle).sha256||metadata.output.bytes!==bundle.length)throw Error('Candidate freeze mismatch');
for(const input of metadata.verifiedGraphInputs){const bytes=readFileSync(join(base,input.path)),pin=manifest.files[input.path];if(!pin||pin.sha256!==input.sha256||digest(bytes).sha256!==input.sha256||bytes.length!==input.bytes)throw Error('Candidate graph mismatch')}
const rawRegistry=readFileSync(join(base,'source/packages/wallet-auth/product-session-registry.json'));
if(digest(rawRegistry).sha256!==manifest.files['source/packages/wallet-auth/product-session-registry.json'].sha256)throw Error('Registry freeze mismatch');
const registry=JSON.parse(rawRegistry),plans=[];
for(const [directory,productId] of [['apps/video','video'],['apps/creator-studio','creator-studio']]){
 const target=join(root,directory),legacy=join(target,'legacy-sdk529'),old=JSON.parse(readFileSync(join(target,'product-session-sdk-source.json')));
 if(old.sdkSourceCommit!=='529471f3822d2bac43ea47a1ab8004fa2ae79885')throw Error('Adoption requires unchanged inherited SDK529 baseline');
 for(const pin of old.files){const bytes=readFileSync(join(target,pin.path));if(digest(bytes).sha256!==pin.sha256||bytes.length!==pin.bytes)throw Error('Inherited baseline differs')}
 const keep=['product-session-sdk.js','product-session-registry.json','product-session-sdk-source.json'].map(name=>({name,bytes:readFileSync(join(target,name))}));
 for(const item of keep)if(existsSync(join(legacy,item.name))&&!readFileSync(join(legacy,item.name)).equals(item.bytes))throw Error('Existing legacy preservation differs');
 const subset={...registry,products:registry.products.filter(p=>p.productId===productId)};if(subset.products.length!==1)throw Error('Product missing');
 plans.push({target,legacy,productId,keep,subsetBytes:Buffer.from(JSON.stringify(subset,null,2)+'\n')});
}
// Every input and preservation destination is checked before any owned write.
for(const {target,legacy,productId,keep,subsetBytes} of plans){
 mkdirSync(legacy,{recursive:true});for(const item of keep)if(!existsSync(join(legacy,item.name)))writeFileSync(join(legacy,item.name),item.bytes,{flag:'wx'});
 writeFileSync(join(target,'product-session-sdk.js'),bundle);writeFileSync(join(target,'product-session-registry.json'),subsetBytes);
 const next={...metadata,registrySubset:productId,registrySourceSHA256:digest(rawRegistry).sha256,files:[{path:'product-session-sdk.js',...digest(bundle)},{path:'product-session-registry.json',...digest(subsetBytes)}],installedWalletApprovalVerified:false,legacyRecovery:{directory:'legacy-sdk529',sdkSourceCommit:'529471f3822d2bac43ea47a1ab8004fa2ae79885',files:keep.map(item=>({path:'legacy-sdk529/'+item.name,...digest(item.bytes)})),storageTouched:false},productionInstalled:false};
 writeFileSync(join(target,'product-session-sdk-source.json'),JSON.stringify(next,null,2)+'\n');
 console.log(JSON.stringify({productId,sdkSourceCommit:next.sdkSourceCommit,graphInputs:next.verifiedGraphInputs.length,legacyFilesPreserved:3,storageTouched:false,productionInstalled:false}));
}

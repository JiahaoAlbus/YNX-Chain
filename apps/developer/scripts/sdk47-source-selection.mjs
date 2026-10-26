import {readFile,writeFile,lstat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const equal=(a,b)=>a&&b&&a.path===b.path&&a.bytes===b.bytes&&a.sha256===b.sha256;
const absolute=p=>typeof p==='string'&&resolve(p)===p;
const safe=p=>typeof p==='string'&&/^[A-Za-z0-9_@. /-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
async function fixed(pin){const st=await lstat(pin.path),raw=await readFile(pin.path);if(!st.isFile()||st.isSymbolicLink()||raw.length!==pin.bytes||sha(raw)!==pin.sha256)throw Error('Original SDK47 role bytes differ: '+pin.path);return raw;}
// Explicit source-only successor of the existing canonical intake. No old
// component, executed receipt, Source or permission is inherited or created.
export async function prepareCanonicalSDK47Source({handoff,previousInputs,nativeBaseRoot,ideRoot,outputRoot}){
 const supplier={path:handoff,bytes:20783,sha256:'949e76d35b516df54ad55cb83d5baed7e451eacdf49bc596f01a525c26ce3b9f'};
 const h=JSON.parse(await fixed(supplier)),oldRaw=await readFile(previousInputs);
 if(sha(oldRaw)!=='6c8b33efc832f4deccc2974657f300cb8e26e84167a5d84d0dc11413cfbf6971')throw Error('Exact previous IDE source selection required.');
 const old=JSON.parse(oldRaw);
 if(h.versionSDK!=='1.3.0-pq.3.32-auth.47'||h.sourceCommit!=='5763b31b0e8d595bf2ed2cae2d4adf7fc5cdcadf'||h.repositoryRootTree!=='eb613d3dfe3e154d8f09e28ba123016ce7f7da8a'||h.sourceRoles.NativeInputs!==102||h.sourceRoles.HelperInputs!==5)throw Error('SDK47 source identity differs.');
 for(const p of [nativeBaseRoot,ideRoot,outputRoot,h.prefix])if(!absolute(p))throw Error('Absolute declared source roots required.');
 for(const p of [nativeBaseRoot,ideRoot,h.prefix]){const st=await lstat(p);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Regular declared source root required.');}
 const [inventory,selection,policy,compat]=await Promise.all([h.normalPrefix.inventory,h.runtime.product.selection,h.runtime.product.finitePolicy,h.sourceRoles.canonicalInventory].map(async pin=>JSON.parse(await fixed(pin))));
 if(inventory.versionSDK!==h.versionSDK||inventory.sourceCommit!==h.sourceCommit||inventory.files.length!==9590||selection.files.length!==9575||policy.excluded.length!==15||compat.version!==h.versionSDK||compat.NativeInputs.length!==102||compat.HelperInputs.length!==5)throw Error('SDK47 inventory differs.');
 const all=new Map(inventory.files.map(r=>[r.path,r])),selected=new Map(selection.files.map(r=>[r.path,r])),excluded=new Map(policy.excluded.map(r=>[r.path,r]));
 if(all.size!==9590||selected.size!==9575||excluded.size!==15)throw Error('Duplicate SDK47 source paths.');
 for(const row of inventory.files)if(excluded.has(row.path)?selected.has(row.path)||!equal(row,excluded.get(row.path)):!equal(row,selected.get(row.path)))throw Error('Exact finite SDK47 selection differs.');
 const dependencies=inventory.files.filter(r=>r.path.startsWith('node_modules/')).map(r=>({...r,path:r.path.slice(13)})),beforeDeps=new Map(old.dependencies.map(r=>[r.path,r]));
 if(dependencies.length!==9177||dependencies.some(r=>!equal(r,beforeDeps.get(r.path))))throw Error('SDK47 inherited dependencies differ; no implicit install.');
 const outside=new Map(h.sourceRoles.outsidePackageCAS.map(r=>[r.sourceSlot,r.replacement]));
 const supplied=[...compat.NativeInputs,...compat.HelperInputs,...compat.pureDeploymentInputs,compat.normalBuildTool],suppliedPaths=new Set(supplied.map(r=>r.path));
 if(suppliedPaths.size!==112)throw Error('SDK47 declared source roles overlap.');
 const retained=old.nativeSources.filter(r=>!suppliedPaths.has(r.path));
 if(retained.length!==15||retained.filter(r=>r.sourceOwner==='ide').length!==2)throw Error('Retained Main/IDE source boundary differs.');
 const buffers=new Map();
 async function source(from,relative,pin){
  if(!safe(relative)||!absolute(from))throw Error('Exact safe source role required.');
  let p=dirname(from);while(p!==dirname(p)){const st=await lstat(p);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Source parent symlink refused.');p=dirname(p);}
  const st=await lstat(from),raw=await fixed({...pin,path:from});
  if(buffers.has(relative)&&sha(buffers.get(relative).raw)!==pin.sha256)throw Error('Conflicting source role.');
  buffers.set(relative,{raw,mode:st.mode&0o777});
 }
 for(const row of inventory.files.filter(r=>!r.path.startsWith('node_modules/')))await source(join(h.prefix,row.path),'packages/wallet-auth/'+row.path,row);
 for(const [pin,name]of [[h.runtime.Auth,'original-ide-auth-runtime-manifest.json'],[h.runtime.union,'original-ide-contract-relay-runtime-manifest.json']])await source(pin.path,'packages/wallet-auth/native/'+name,pin);
 for(const row of supplied){
  let from;if(outside.has(row.path)){const pin=outside.get(row.path);if(pin.bytes!==row.bytes||pin.sha256!==row.sha256)throw Error('Outside-package CAS differs.');from=pin.path;}
  else if(row.path.startsWith('packages/wallet-auth/'))from=join(h.prefix,row.path.slice('packages/wallet-auth/'.length));
  else from=join(nativeBaseRoot,row.path);
  await source(from,row.path,row);
 }
 for(const row of retained)await source(join(row.sourceOwner==='ide'?ideRoot:nativeBaseRoot,row.path),row.path,row);
 const nativeSources=[...supplied.map(r=>({...r,sourceOwner:'sdk'})),...retained],nativeBuildInputs=[...compat.NativeInputs,...old.nativeBuildInputs.filter(r=>!suppliedPaths.has(r.path))];
 if(nativeSources.length!==127||nativeBuildInputs.length!==115)throw Error('SDK47 complete build source boundary differs.');
 const plannerRaw=await fixed(h.sourceRoles.planner);
 try{await lstat(outputRoot);throw Error('Refusing to overwrite source selection.');}catch(e){if(e.code!=='ENOENT')throw e;}
 // Check all original bytes before allocating an immutable new output.
 await mkdir(outputRoot,{mode:0o700});
 for(const [relative,value]of buffers){const target=join(outputRoot,relative);await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,value.raw,{flag:'wx',mode:value.mode});}
 await mkdir(join(outputRoot,'roles'),{mode:0o700});await writeFile(join(outputRoot,'roles/sdk332-r140-native-plan.mjs'),plannerRaw,{flag:'wx',mode:0o644});
 const request={schema:'YNX_IDE_CANONICAL_SDK47_SOURCE_REQUEST/v1',sdkVersion:h.versionSDK,sdkCommit:h.sourceCommit,sdkTree:h.repositoryRootTree,sourceRoot:outputRoot,supplier,nativeSources,nativeBuildInputs,dependencies,productSelection:selection.files,finiteExclusion:policy.excluded,fullRuntime:h.runtime,requiredBuild:{...old.requiredBuild,NativeSupplierFiles:102,helperSupplierFiles:5,compilerTool:compat.normalBuildTool,actualNodeRecordInputs:115,actualHelperRecordInputs:107,helperInputs:[...compat.NativeInputs,...compat.HelperInputs],normalPlans:null,normalPlanSourceRoot:null},nativeComponent:null,helperComponent:null,NativeQualified:false,SourceQualified:false,executed:false,packaged:false,oldComponentInherited:false};
 await writeFile(join(outputRoot,'SDK47_SOURCE_SELECTION_REQUEST.json'),JSON.stringify(request,null,2)+'\n',{flag:'wx',mode:0o644});
 return request;
}

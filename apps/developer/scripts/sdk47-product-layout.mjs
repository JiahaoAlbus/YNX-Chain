const version='1.3.0-pq.3.32-auth.47';
export function sdk47ProductLayout(inputs){
 const p=inputs.productProjection;
 if(inputs.sdkVersion!==version||p?.files?.length!==400||p.selectionFiles!==9575||p.authFiles!==564||p.unionFiles!==9425||p.NativeAdmission!==false||p.SourceAdmission!==false)throw Error('SDK47 product layout differs.');
 const full=new Map(inputs.files.map(r=>[r.path,r])),generated=new Map(p.generated.map(r=>[r.destination,r])),seen=new Set();
 for(const row of p.files){const original=generated.get(row.path)||full.get(row.path);if(seen.has(row.path)||!original||row.bytes!==original.bytes||row.sha256!==original.sha256)throw Error('SDK47 product differs from source custody.');seen.add(row.path);}
 for(const row of inputs.buildOnlySDKFiles)if(seen.has(row.path))throw Error('SDK47 excluded source entered product.');
 if(inputs.dependencies.length!==9177)throw Error('SDK47 dependency selection differs.');
 return {...inputs,files:p.files,runtimeClosure:{...inputs.runtimeClosure,Auth:p.Auth,contractRelay:p.contractRelay}};
}
export function validateSDK47ProjectionRecord(record,receipt,policy,metadata){
 if(record.sdkVersion!==version||record.sdkCommit!=='5763b31b0e8d595bf2ed2cae2d4adf7fc5cdcadf'||record.sdkTree!=='eb613d3dfe3e154d8f09e28ba123016ce7f7da8a'||metadata.name!=='@ynx-chain/wallet-auth'||metadata.version!==version)throw Error('SDK47 projection identity differs.');
 const layout=sdk47ProductLayout(record),aliases=new Set(record.productProjection.generated.map(r=>r.destination));
 const dependencies=record.dependencies.map(r=>({...r,path:'node_modules/'+r.path}));
 // Complete runtime byte membership is separately checked by the normal package
 // source verifier; here all full/product source and dependency rows must agree.
 const h=record.sdk47SupplierContract;
 if(h.versionSDK!==version||h.sourceCommit!==record.sdkCommit||h.repositoryRootTree!==record.sdkTree||h.sourceRoles.NativeInputs!==102||h.sourceRoles.HelperInputs!==5)throw Error('SDK47 supplier role identity differs.');
 const all=[...record.files.filter(r=>!aliases.has(r.path)),...dependencies];
 const selected=[...layout.files.filter(r=>!aliases.has(r.path)),...dependencies];
 // Actual canonical runtime bytes are verified by the normal package gate.
  const byPath=new Map(all.map(r=>[r.path,r])),product=new Map(selected.map(r=>[r.path,r]));
 // Runtime membership is not synthesized here. Validate only a separately
 // factored finite projection, leaving source/runtime proof to its own gate.
 if(all.length!==9590||selected.length!==9575||policy.count!==15||policy.excluded.length!==15||receipt.commit!==record.sdkCommit||receipt.versionSDK!==version||receipt.ASTSources!==204||receipt.literalEdges!==683||receipt.kind!=='YNX_SDK47_PRODUCT_RUNTIME_METADATA_PROJECTION/v1'||receipt.fullPrefixFiles!==9590||receipt.excludedFiles!==15||receipt.generatedRawCanonicalNoLF!==true||receipt.NativeInputs!==102||receipt.HelperInputs!==5||['NativeModuleBuilt','SourceQualified','installed','published'].some(k=>receipt[k]!==false))throw Error('SDK47 finite projection identity differs.');
 const excluded=new Map(policy.excluded.map(r=>[r.path,r]));
 for(const [path,r]of excluded){const held=byPath.get(path);if(!held||held.bytes!==r.bytes||held.sha256!==r.sha256)throw Error('SDK47 excluded row differs.');}
 if(byPath.size!==9590||product.size!==9575||excluded.size!==15)throw Error('SDK47 duplicate projection row.');
 for(const [path,row]of byPath){const expected=excluded.get(path)||product.get(path);if(!expected||expected.bytes!==row.bytes||expected.sha256!==row.sha256||(excluded.has(path)&&product.has(path)))throw Error('SDK47 finite projection differs.');}
 return {NativeAdmission:false,SourceAdmission:false};
}


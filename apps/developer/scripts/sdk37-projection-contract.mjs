// Explicit SDK37 product DATA contract, never Native or Source admission.
export function validateSDK37ProjectionContract({handoff,inventory,selection,receipt,policy,parentInventory}){
 const version='1.3.0-pq.3.32-auth.37';if(handoff.versionSDK!==version||handoff.sourceCommit!=='7bb0e17d2bd1aa6d4bde96f45c14774fcc4ccff9'||receipt.versionSDK!==version||policy.versionSDK!==version||receipt.sourceCommit!==handoff.sourceCommit||receipt.projectionMetadataRevision!==2)throw Error('SDK37 projection identity differs.');
 if(inventory.files.length!==9581||selection.files.length!==9566||receipt.excluded?.length!==15||policy.excluded?.length!==15||policy.count!==15||receipt.oldSDK36IdentityOrAdmissionInherited!==false||policy.oldSDK36IdentityOrAdmissionInherited!==false)throw Error('SDK37 explicit finite policy differs.');
 const before=new Map(parentInventory.files.map(p=>[p.path,p])),all=new Map(inventory.files.map(p=>[p.path,p])),excluded=new Map(policy.excluded.map(p=>[p.path,p])),selected=new Map(selection.files.map(p=>[p.path,p]));if(all.size!==9581||before.size!==9581||excluded.size!==15||selected.size!==9566)throw Error('SDK37 duplicate paths.');
 const equal=(a,b)=>a&&b&&a.path===b.path&&a.bytes===b.bytes&&a.sha256===b.sha256;
 for(const p of receipt.excluded)if(!equal(p,excluded.get(p.path))||!equal(p,all.get(p.path)))throw Error('SDK37 finite leaf differs.');
 for(const p of inventory.files){const product=selected.get(p.path);if(excluded.has(p.path)){if(product)throw Error('SDK37 excluded leaf entered product.');}else if(!equal(p,product))throw Error('SDK37 selected product differs.');}
 const declared=new Map(handoff.normalPrefix.delta.map(p=>[p.path,p]));let changes=0;
 for(const p of inventory.files){const old=before.get(p.path);if(!old)throw Error('SDK37 unexpected path.');if(!equal(p,old)){const d=declared.get(p.path);if(!d||!equal(d.before,old)||!equal(d.after,p))throw Error('SDK37 undeclared source delta.');changes++;}}
 if(changes!==4||declared.size!==4)throw Error('SDK37 delta count differs.');
 const joint=all.get('native/original-auth-identity-joint-owner.mm');if(joint?.bytes!==13399||joint.sha256!=='de91b9b18cfab291c7bca0a3bdb88e16f911505be356ce3afc1da5a1d8d34ae5')throw Error('SDK37 namespace fix not selected.');
 const lock=selected.get('node_modules/.package-lock.json');if(lock?.bytes!==54706||lock.sha256!=='4bcda46e64a177344da39833571be1c875398fa3b4fc8e6dd12104bfc4e77048')throw Error('SDK37 installed lock differs.');
 return {files:selection.files,excluded:policy.excluded,NativeAdmission:false,SourceAdmission:false,matchingComponentRequired:true};
}

export function canonicalSDK37ProjectionData(record,receipt,policy){
 const aliases=new Set(record.productProjection.generated.map(p=>p.destination));
 const full=[...record.files.filter(p=>!aliases.has(p.path)),...record.dependencies.map(p=>({...p,path:'node_modules/'+p.path}))];
 const before=new Map(full.map(p=>[p.path,p]));for(const delta of record.sdk37SupplierContract.normalPrefix.delta)before.set(delta.path,delta.before);
 return {handoff:record.sdk37SupplierContract,inventory:{files:full},selection:{files:[...record.productProjection.files.filter(p=>!aliases.has(p.path)),...record.dependencies.map(p=>({...p,path:'node_modules/'+p.path}))]},receipt,policy,parentInventory:{files:[...before.values()]}};
}

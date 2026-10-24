// Product projection is data selection, never Native/Source qualification.
export function sdk36ProductLayout(inputs){
 const product=inputs.productProjection;
 if(inputs.sdkVersion!=='1.3.0-pq.3.32-auth.36'||product?.files?.length!==391||product.selectionFiles!==9566||product.authFiles!==556||product.unionFiles!==9417||product.NativeAdmission!==false||product.SourceAdmission!==false)throw Error('SDK36 product layout differs.');
 const seen=new Set();for(const row of product.files){if(seen.has(row.path)||row.path.startsWith('/')||row.path.split('/').some(p=>!p||p==='.'||p==='..')||!Number.isSafeInteger(row.bytes)||! /^[a-f0-9]{64}$/.test(row.sha256))throw Error('SDK36 product row differs.');seen.add(row.path);}
 const generated=new Map(product.generated.map(p=>[p.destination,p]));
 const full=new Map(inputs.files.map(p=>[p.path,p]));
 for(const row of product.files){const original=generated.get(row.path)||full.get(row.path);if(!original||original.bytes!==row.bytes||original.sha256!==row.sha256)throw Error('SDK36 product leaf differs from custody.');}
 for(const excluded of inputs.buildOnlySDKFiles)if(seen.has(excluded.path))throw Error('SDK36 build-only leaf entered product.');
 const dependencies=inputs.dependencies;if(dependencies.length!==9177||!dependencies.some(p=>p.path==='.package-lock.json'&&p.bytes===54706&&p.sha256==='4bcda46e64a177344da39833571be1c875398fa3b4fc8e6dd12104bfc4e77048'))throw Error('SDK36 installed lock differs.');
 for(const part of [product.Auth,product.contractRelay]){const held=product.files.find(p=>p.path===part.manifest.destination);if(!held||held.sha256!==part.manifest.sha256||held.bytes!==part.manifest.bytes)throw Error('SDK36 product manifest pin differs.');}
 return {...inputs,files:product.files,dependencies,runtimeClosure:{...inputs.runtimeClosure,Auth:product.Auth,contractRelay:product.contractRelay}};
}

import {open,lstat,realpath,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,relative} from 'node:path';

const supplier='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-root14-product45-normal-builder-successor-20261101/resource8-successor';
const accepted={path:supplier+'/HANDOFF.json',bytes:15157,sha256:'95522022da0155171c160b5e137d7301ef579794e5caf533761f41d65b15e5d9'};
const commit='60abd3f3af107e963e836d821af47b32f90177b2';

// Artifact verification only. No compiler, native module or protected SDK is
// loaded, and a matching source inventory does not grant runtime admission.
export async function verifyPhysicalPin(row){
 if(!row||!isAbsolute(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<0||!/^[a-f0-9]{64}$/.test(row.sha256))throw Error('Invalid supplier artifact pin');
 const before=await lstat(row.path,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||await realpath(row.path)!==row.path||before.size!==BigInt(row.bytes))throw Error('Supplier artifact is not the pinned regular file');
 const handle=await open(row.path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const opened=await handle.stat({bigint:true});
  if(opened.dev!==before.dev||opened.ino!==before.ino)throw Error('Supplier artifact changed before reading');
  const hash=createHash('sha256'),buffer=Buffer.alloc(128*1024);let size=0;
  for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>row.bytes)throw Error('Supplier artifact grew while reading');hash.update(buffer.subarray(0,bytesRead));}
  const after=await handle.stat({bigint:true}),current=await lstat(row.path,{bigint:true});
  if(size!==row.bytes||hash.digest('hex')!==row.sha256||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>opened[key]!==after[key]||after[key]!==current[key]))throw Error('Supplier artifact bytes or identity changed');
 }finally{await handle.close();}
 return {path:row.path,bytes:row.bytes,sha256:row.sha256};
}

export function assertSourceRows(rows,root){
 if(!Array.isArray(rows)||!rows.length)throw Error('Supplier source inventory missing');
 const seen=new Set();
 for(const row of rows){
  const rel=relative(root,row.path);
  if(!rel||rel.startsWith('../')||isAbsolute(rel)||rel!==row.relativePath||seen.has(rel))throw Error('Supplier source escaped or duplicated');
  seen.add(rel);
 }
}

export async function verifyNextProductSupplierInput(){
 await verifyPhysicalPin(accepted);const h=JSON.parse(await readFile(accepted.path));
 if(h.kind!=='SDK49_ROOT14_RESOURCE8_PRODUCT45_NORMAL_BUILDER_HANDOFF/v1'||h.sourceCommit!==commit||h.AppBuilt!==false||h.RootAdmission!==false||h.SourceAdmission!==false||h.normalObjects!==63||h.normalCommands!==65||h.postCommands!==4)throw Error('Exact next-product source contract required');
 for(const key of ['SOURCEFILES','sourceBundle','SDKCodeCAS','AuthResourceDelta','FUNCTION_RESULT','supplierReadback','normalManifest','normalPlan','sourceArgvReadback'])await verifyPhysicalPin(h[key]);
 await verifyPhysicalPin(h.P03CurrentPickerAndCocoa.receipt);
 const inventory=JSON.parse(await readFile(h.SOURCEFILES.path));
 if(inventory.sourceCommit!==commit||inventory.sourceRoot!==h.sourceRoot||inventory.sourceFileCount!==3087||inventory.files?.length!==3087)throw Error('Next-product source inventory differs');
 assertSourceRows(inventory.files,h.sourceRoot);
 for(let start=0;start<inventory.files.length;start+=4)await Promise.all(inventory.files.slice(start,start+4).map(verifyPhysicalPin));
 const consumer=JSON.parse(await readFile(h.P03CurrentPickerAndCocoa.receipt.path));
 if(consumer.P03SourceCommit!=='78fd22007abb49da54dd35c6699d4afaa99ede01')throw Error('Native picker consumer version differs');
 for(const row of consumer.sourceInputs)await verifyPhysicalPin(row);
 await verifyPhysicalPin(h.headerCounts.exactTarget);
 return {schema:'YNX_P03_NEXT_PRODUCT_INPUT_READBACK/v1',supplier:accepted,sourceCommit:commit,verifiedSourceFiles:3087,consumerSource:consumer.P03SourceCommit,consumerFiles:consumer.sourceInputs.length,normalObjects:63,normalCommands:65,compilerExecuted:false,NativeLoaded:false,AppBuilt:false,RootAdmission:false,SourceAdmission:false,completeSDKProjectionSupplied:false,next:'Matching complete SDK runtime prefix/projection and post-nested contract required before next full App packaging'};
}

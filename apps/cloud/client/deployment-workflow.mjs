import {constants} from 'node:fs';
import {open,rename,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CloudDeploymentClient} from './deployment-client.mjs';

const LIMIT=32768;
async function syncDirectory(path){const f=await open(dirname(resolve(path)),'r');try{await f.sync();}finally{await f.close();}}
async function create(path,value){const f=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}finally{await f.close();}await syncDirectory(path);}
async function replace(path,value){const temp=path+'.'+randomUUID()+'.tmp';try{await create(temp,value);await rename(temp,path);await syncDirectory(path);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
async function read(path){
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await f.stat();if(!s.isFile()||s.size>LIMIT||s.nlink!==1||(s.mode&0o077)!==0||(process.getuid&&s.uid!==process.getuid()))throw Error('Private original deployment receipt required');
  const buffer=Buffer.alloc(LIMIT+1);let size=0;while(size<buffer.length){const {bytesRead}=await f.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
  if(size>LIMIT)throw Error('Deployment receipt exceeds bound');return JSON.parse(buffer.subarray(0,size).toString('utf8'));
 }finally{await f.close();}
}
function receiptFor(client,value){
 if(!(client instanceof CloudDeploymentClient)||value?.schema!=='cloud-original-deployment-receipt/1'||value.endpoint!==client.endpoint||!['PREPARED','UNKNOWN','OBSERVED'].includes(value.state)||!value.selection||typeof value.selection.requestId!=='string')throw Error('Receipt is not the original Cloud endpoint/operation');
 return value;
}

// Receipt is DATA for recovery, never an approval. It contains no signer,
// token, Source or raw approval/manifest/artifact bytes. New submission owns an
// exclusive file; every existing receipt, including PREPARED, is query-only.
export async function submitDeploymentReceipt(client,prepared,file,{signal}={}){
 if(!(client instanceof CloudDeploymentClient))throw Error('Original deployment client required');
 const receipt={schema:'cloud-original-deployment-receipt/1',endpoint:client.endpoint,selection:prepared.selection,state:'PREPARED'};
 try{await create(file,receipt);}catch(e){if(e.code!=='EEXIST')throw e;const saved=receiptFor(client,await read(file));if(JSON.stringify(saved.selection)!==JSON.stringify(receipt.selection))throw Error('Original deployment receipt selection changed; no resubmission');return reconcileDeploymentReceipt(client,file,{signal});}
 receipt.state='UNKNOWN';await replace(file,receipt); // durable BEFORE any foreign Source/HTTP action
 const {operation}=await client.submitPrepared(prepared,{signal});
 await replace(file,{...receipt,state:'OBSERVED',operation});return operation;
}
export async function reconcileDeploymentReceipt(client,file,{signal}={}){
 const receipt=receiptFor(client,await read(file));
 const operation=await client.lookupOriginal(receipt.selection,{signal});
 await replace(file,{...receipt,state:'OBSERVED',operation});return operation;
}

// Same-process CLI entry for the original normal IDE/Wallet bootstrap. It
// requires the actual original SDK client, and does not load arbitrary provider
// modules or convert an ordinary session into a deployment proof factory.
export async function runDeploymentCommand(client,args,{signal}={}){
 const [command,file,...rest]=args;if(!file||rest.length)throw Error('status|reconcile|logs|usage ORIGINAL_PRIVATE_RECEIPT');
 const receipt=receiptFor(client,await read(file));
 if(command==='status'||command==='reconcile')return reconcileDeploymentReceipt(client,file,{signal});
 if(command==='logs')return client.logs(receipt.selection,{signal});
 if(command==='usage')return client.usage(receipt.selection,{signal});
 throw Error('Original deployment status, reconcile, logs or usage command required');
}

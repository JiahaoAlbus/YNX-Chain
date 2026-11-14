import { createHash } from 'node:crypto';
import { fault } from './central-identity.mjs';
const sha=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=256&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);
const fields=['projectId','version','contentDigest','publishPurpose','targetEnvironment','byteSize'];
const sameBinding=(a,b)=>a&&b&&fields.every(field=>a[field]===b[field]);
const sameDual=(a,b)=>a&&b&&['bytes','sha3_512','sha512'].every(field=>a[field]===b[field]);
const slot=value=>typeof value==='string'&&value.length<=20&&/^(0|[1-9][0-9]*)$/.test(value)&&BigInt(value)<18446744073709551615n;

// The original six-field manifest remains legacy signed DATA. Dual content
// binding and slot selection are separate caller DATA, not a new signedRef.
export function prepareCloudManifest({projectId,version,publishPurpose,targetEnvironment,content}) {
 if(![projectId,version,publishPurpose,targetEnvironment].every(text)||!(content instanceof Uint8Array)||!content.length||content.length>64*1024*1024)throw fault('A bounded artifact and exact project/version/environment are required.','deployment_manifest',400);
 const bytes=Buffer.from(content),binding=Object.freeze({projectId,version,contentDigest:sha(bytes),publishPurpose,targetEnvironment,byteSize:bytes.length});
 return {binding,manifest:Buffer.from(JSON.stringify(binding)),content:bytes,integrity:Object.freeze({bytes:String(bytes.length),sha3_512:sha(bytes,'sha3-512'),sha512:sha(bytes,'sha512')})};
}

// Same original outbox schema for legacy and V2; never migrate old signed bytes.
export function ensureCloudOperationJournal(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS codeoss_cloud_operations(principal TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,manifest BLOB NOT NULL,approval BLOB NOT NULL,artifact BLOB NOT NULL,state TEXT NOT NULL,observation TEXT,PRIMARY KEY(principal,request_id));`);
 // Old observations have no dual/slot selection. Never backfill invented data.
 const ownsMigration=!db.isTransaction;
 if(ownsMigration)db.exec('BEGIN IMMEDIATE');
 try{
  if(!db.prepare('PRAGMA table_info(codeoss_cloud_operations)').all().some(column=>column.name==='selection'))db.exec('ALTER TABLE codeoss_cloud_operations ADD COLUMN selection TEXT');
  if(ownsMigration)db.exec('COMMIT');
 }catch(error){if(ownsMigration)db.exec('ROLLBACK');throw error;}
}

export function createCloudDeploymentCaller({db,authorize,transport}) {
 if(!db||typeof authorize!=='function'||typeof transport!=='function')throw TypeError('Original journal, authorization and Cloud transport are required.');
 ensureCloudOperationJournal(db);
 const find=(owner,id)=>db.prepare('SELECT * FROM codeoss_cloud_operations WHERE principal=? AND request_id=?').get(owner,id);
 const selected=row=>row.selection?JSON.parse(row.selection):null;
 const view=row=>({requestId:row.request_id,state:row.state,...(row.observation?{observation:JSON.parse(row.observation)}:{})});
 async function principal(ctx,operation,selection){const owner=await authorize(ctx,operation,selection);if(!text(owner))throw fault('Current deployment access is required.','deployment_authority',403);return owner;}
 async function recheck(ctx,operation,selection,owner){if(await principal(ctx,operation,selection)!==owner)throw fault('Deployment identity changed.','deployment_authority',403);}
 function accept(row,observation){
  if(selected(row)?.manifestVersion==='2')throw fault('Use the original V2 caller for this operation.','deployment_version',409);
  const expected=JSON.parse(Buffer.from(row.manifest).toString('utf8')),selection=selected(row);
  if(!observation||observation.requestId!==row.request_id||observation.manifestSHA256!==sha(row.manifest)||observation.approvalSHA256!==sha(row.approval)||!sameBinding(observation.binding,expected)||!text(observation.publisherId)||!text(observation.resourceId)||!['unknown','running','completed','failed'].includes(observation.state))throw fault('Cloud observation does not match the original deployment.','deployment_receipt',502);
  if(selection&&(!sameDual(observation.contentBinding,selection.contentBinding)||observation.expectedSlotRevision!==selection.expectedSlotRevision||(observation.rollbackTarget??'')!==selection.rollbackTo||
   (observation.slotRevision!==undefined&&observation.slotRevision!==String(BigInt(selection.expectedSlotRevision)+1n))||(['running','completed'].includes(observation.state)&&observation.slotRevision===undefined)))throw fault('Cloud observation does not match the original content or slot.','deployment_receipt',502);
  if(observation.state==='completed'&&observation.exitCode!==0)throw fault('Completed deployment lacks a successful exit.','deployment_receipt',502);
  if(['running','completed'].includes(observation.state)){
   let url;try{url=new URL(observation.runtimeUrl);}catch{throw fault('Cloud runtime URL is invalid.','deployment_receipt',502);}
   if(!['http:','https:'].includes(url.protocol)||!url.host||url.username||url.password||url.search||url.hash||!text(observation.deploymentId))throw fault('Cloud runtime URL is invalid.','deployment_receipt',502);
  }
  // Conditional UPDATE protects terminal facts even across independent callers
  // whose earlier GET/POST callbacks settle after the terminal writer.
  db.prepare("UPDATE codeoss_cloud_operations SET state=?,observation=? WHERE principal=? AND request_id=? AND state NOT IN ('completed','failed')").run(observation.state,JSON.stringify(observation),row.principal,row.request_id);
  return find(row.principal,row.request_id);
 }
 async function reconcile(ctx,requestId,{signal}={}){
  if(!key(requestId))throw fault('Original operation ID is required.','deployment_operation',400);
  const owner=await principal(ctx,'read-deployment',{requestId}),row=find(owner,requestId);if(!row)throw fault('Original deployment operation not found.','deployment_not_found',404);
  if(selected(row)?.manifestVersion==='2')throw fault('Use the original V2 caller for this operation.','deployment_version',409);
  signal?.throwIfAborted();let response;
  try{response=await transport({method:'GET',path:`/api/v1/ide/deployments/${requestId}`,selection:selected(row),signal});}
  catch{await recheck(ctx,'read-deployment',{requestId},owner);return view(find(owner,requestId));}
  await recheck(ctx,'read-deployment',{requestId},owner);
  if((response?.originalSDK===true||response?.status===200)&&response?.body?.requestId===requestId)return view(accept(row,response.body));
  return view(find(owner,requestId)); // 404/403/503 do not authorize another POST.
 }
 async function submit(ctx,{requestId,selection,approval,expectedSlotRevision,rollbackTo},{signal}={}){
  if(!key(requestId)||!slot(expectedSlotRevision)||!(approval instanceof Uint8Array)||!approval.length||approval.length>1024*1024||(rollbackTo!==undefined&&!key(rollbackTo)))throw fault('Original request, approval and canonical deployment slot revision are required.','deployment_operation',400);
  const prepared=prepareCloudManifest(selection),envelope=Buffer.from(approval);
  const held=Object.freeze({requestId,manifestSHA256:sha(prepared.manifest),approvalSHA256:sha(envelope),contentBinding:prepared.integrity,expectedSlotRevision,rollbackTo:rollbackTo??''});
  const exact={requestId,binding:prepared.binding,manifestSHA256:held.manifestSHA256,approvalSHA256:held.approvalSHA256,integrity:held.contentBinding,expectedSlotRevision,rollbackTo:held.rollbackTo};
  const owner=await principal(ctx,'submit-deployment',exact),fingerprint=sha(Buffer.from(JSON.stringify(exact)));let row=find(owner,requestId);
  if(row){if(!row.selection)throw fault('Legacy operations support original read-only reconciliation only.','deployment_legacy_reconcile_only',409);if(row.fingerprint!==fingerprint)throw fault('Original operation is bound to different bytes, approval, slot or environment.','deployment_conflict',409);return reconcile(ctx,requestId,{signal});}
  if(rollbackTo){
   if(rollbackTo===requestId)throw fault('Rollback needs a new original request and approval.','deployment_rollback',409);
   const target=find(owner,rollbackTo);if(!target)throw fault('Original rollback target is not available to this owner.','deployment_rollback',404);
   const original=await reconcile(ctx,rollbackTo,{signal});
   if(original.state!=='completed'||!sameBinding(JSON.parse(Buffer.from(target.manifest).toString('utf8')),prepared.binding)||!Buffer.from(target.artifact).equals(prepared.content)||sha(target.approval)===held.approvalSHA256)throw fault('Rollback needs the original successful bytes and a new approval.','deployment_rollback',409);
   await recheck(ctx,'submit-deployment',exact,owner);
  }
  signal?.throwIfAborted();
  db.prepare('INSERT INTO codeoss_cloud_operations(principal,request_id,fingerprint,manifest,approval,artifact,state,observation,selection) VALUES(?,?,?,?,?,?,?,NULL,?)').run(owner,requestId,fingerprint,prepared.manifest,envelope,prepared.content,'unknown',JSON.stringify(held));row=find(owner,requestId);
  await recheck(ctx,'submit-deployment',exact,owner);signal?.throwIfAborted();
  const form=new FormData();form.append('manifest',new Blob([prepared.manifest]),'manifest.json');form.append('approval',new Blob([envelope]),'approval.json');form.append('artifact',new Blob([prepared.content]),'artifact');
  const headers={'Idempotency-Key':requestId,'X-Expected-Deployment-Revision':expectedSlotRevision};if(rollbackTo)headers['X-Rollback-To']=rollbackTo;
  let response;try{response=await transport({method:'POST',path:'/api/v1/ide/deployments',headers,body:form,selection:held,signal});}
  catch{await recheck(ctx,'read-deployment',{requestId},owner);return view(find(owner,requestId));}
  await recheck(ctx,'read-deployment',{requestId},owner);
  if((response?.originalSDK===true||[200,201,202,409].includes(response?.status))&&response?.body?.requestId===requestId)return view(accept(row,response.body));
  return view(find(owner,requestId));
 }
 async function details(ctx,requestId,resource,{signal}={}){
  if(!key(requestId))throw fault('Original operation ID is required.','deployment_operation',400);
  const access={requestId,view:resource},owner=await principal(ctx,'read-deployment',access),row=find(owner,requestId);if(!row)throw fault('Original deployment operation not found.','deployment_not_found',404);
  if(resource==='usage'&&!row.selection)throw fault('Legacy deployment has no original usage selection.','deployment_selection_unavailable',409);
  signal?.throwIfAborted();const response=await transport({method:'GET',path:`/api/v1/ide/deployments/${requestId}/${resource}`,selection:selected(row),signal});await recheck(ctx,'read-deployment',access,owner);
  if(!(response?.originalSDK===true||response?.status===200)||response?.body?.requestId!==requestId)throw fault('Original deployment details are unavailable.','deployment_receipt',502);
  const value=response.body;
  if(resource==='logs'&&(value.runtimeLogSource!=='original-resource'||typeof value.runtimeLogs!=='string'||Buffer.byteLength(value.runtimeLogs)>65536||!Array.isArray(value.operationLogs)))throw fault('Original resource logs are invalid.','deployment_receipt',502);
  if(resource==='usage'&&(value.billingState!=='UNPRICED'||!value.samples||!value.latest))throw fault('Usage is not an original UNPRICED observation.','deployment_receipt',502);
  return value;
 }
 return Object.freeze({submit,reconcile,logs:(ctx,id,options)=>details(ctx,id,'logs',options),usage:(ctx,id,options)=>details(ctx,id,'usage',options)});
}

export function createOriginalCloudDeploymentTransport(raw,{DeploymentClient}={}){
 if(raw?.product!=='cloud'||typeof raw.getDeploymentRequestHeaders!=='function'||typeof raw.submitIDEDeployment!=='function'||typeof raw.getIDEDeploymentStatus!=='function')throw TypeError('Original Cloud SDK and deployment proof provider are required.');
 const client=DeploymentClient?new DeploymentClient(raw):null;
 return async request=>{
  let operation;
  if(request.method==='POST'&&request.path==='/api/v1/ide/deployments'){
   if(!client||!request.selection)throw TypeError('Original CloudDeploymentClient is required for new submissions.');
   const names=[...request.body.keys()];if(names.join(',')!=='manifest,approval,artifact')throw TypeError('Original Cloud multipart order is required.');
   const [manifest,approval,artifact]=await Promise.all(names.map(async name=>new Uint8Array(await request.body.get(name).arrayBuffer())));
   const {operation:result,selection}=await client.submit({requestId:request.headers['Idempotency-Key'],manifest,approval,artifact,expectedSlotRevision:request.selection.expectedSlotRevision,...(request.selection.rollbackTo?{rollbackTo:request.selection.rollbackTo}:{}),signal:request.signal});
   if(selection.requestId!==request.selection.requestId||selection.manifestSHA256!==request.selection.manifestSHA256||selection.approvalSHA256!==request.selection.approvalSHA256||!sameDual(selection.contentBinding,request.selection.contentBinding)||selection.expectedSlotRevision!==request.selection.expectedSlotRevision||selection.rollbackTo!==request.selection.rollbackTo)throw fault('Original SDK selection changed.','deployment_receipt',502);operation=result;
  }else{
   const match=request.method==='GET'&&request.path.match(/^\/api\/v1\/ide\/deployments\/([A-Za-z0-9_-]{16,128})(?:\/(logs|usage))?$/);if(!match)throw TypeError('Only original deployment submission/status/logs/usage are supported.');
   const options={signal:request.signal};
   if(request.selection){if(!client)throw TypeError('Original CloudDeploymentClient is required for bound observations.');operation=await(match[2]==='logs'?client.logs(request.selection,options):match[2]==='usage'?client.usage(request.selection,options):client.lookupOriginal(request.selection,options));}
   else if(match[2]==='usage')throw TypeError('Legacy deployment cannot invent a usage selection.');
   else operation=await(match[2]==='logs'?raw.getIDEDeploymentLogs(match[1],options):raw.getIDEDeploymentStatus(match[1],options));
  }
  return {originalSDK:true,body:operation};
 };
}

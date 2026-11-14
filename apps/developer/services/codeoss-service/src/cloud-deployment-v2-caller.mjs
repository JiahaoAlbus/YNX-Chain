import {createHash} from 'node:crypto';
import {fault} from './central-identity.mjs';
import {ensureCloudOperationJournal} from './cloud-deployment-caller.mjs';
import {createOriginalDeploymentV2Signer} from './original-deployment-v2-signer.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const validID=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(value);
// New Native prepare IDs only. Historical read/UNKNOWN identifiers retain the
// original grammar and bytes; this must never become a migration/rename rule.
const validNewID=value=>typeof value==='string'&&/^req_[A-Za-z0-9_-]{12,80}$/.test(value);
const result=row=>({requestId:row.request_id,state:row.state,...(row.observation?{observation:JSON.parse(row.observation)}:{}),...(row.signing_state?{signing:{state:row.signing_state,partial:row.signing_partial?JSON.parse(row.signing_partial):null,cleanupPending:row.signing_cleanup===1}}:{})});

// The original CloudDeploymentV2Client owns the sole codec, artifact assertions,
// selected request proof and HTTP calls. This module owns only IDE outbox/CAS.
// In particular a prepared payload is DATA for the original V2 signer, never a
// grant, a legacy ARTIFACT-RELEASE message, or an automatic signing request.
export function createCloudDeploymentV2Caller({db,authorize,client,signer=createOriginalDeploymentV2Signer()}) {
 if(!db||typeof authorize!=='function'||['prepare','payloadOriginal','verifyReadback','submitPrepared','lookupOriginal'].some(name=>typeof client?.[name]!=='function'))throw TypeError('Original journal, authority and CloudDeploymentV2Client required.');
 ensureCloudOperationJournal(db);
 // Add only signing lifecycle metadata to the original outbox. Legacy signed
 // bytes and the independent POST state are never reinterpreted or migrated.
 const ownsMigration=!db.isTransaction;if(ownsMigration)db.exec('BEGIN IMMEDIATE');
 try {
  const columns=new Set(db.prepare('PRAGMA table_info(codeoss_cloud_operations)').all().map(c=>c.name));
  for(const [name,type] of [['signing_state','TEXT'],['signing_partial','TEXT'],['signing_cleanup','INTEGER'],['upload_body_sha256','TEXT'],['upload_content_type','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE codeoss_cloud_operations ADD COLUMN ${name} ${type}`);
  if(ownsMigration)db.exec('COMMIT');
 }catch(error){if(ownsMigration)db.exec('ROLLBACK');throw error;}
 const find=(owner,id)=>db.prepare('SELECT * FROM codeoss_cloud_operations WHERE principal=? AND request_id=?').get(owner,id);
 async function ownerFor(ctx,operation,selection){const owner=await authorize(ctx,operation,selection);if(typeof owner!=='string'||!owner||Buffer.byteLength(owner)>256)throw fault('Current original deployment authority required.','deployment_authority',403);return owner;}
 async function recheck(ctx,operation,selection,owner){if(await ownerFor(ctx,operation,selection)!==owner)throw fault('Deployment identity changed.','deployment_authority',403);}
 function selected(row){const selection=row?.selection&&JSON.parse(row.selection);if(selection?.manifestVersion!=='2')throw fault('Legacy operation remains with its original caller.','deployment_version',409);if(selection.requestId!==row.request_id||hash(Buffer.from(JSON.stringify(selection)))!==row.fingerprint)throw fault('Original selected operation changed.','deployment_integrity',409);client.verifyReadback(selection,row.manifest,row.artifact);return selection;}
 // Match original workflow terminal DATA in the sole outbox, never a
 // second sidecar or a cache of authorization success.
 function verifyTerminal(current,observation){
   if(!['completed','failed'].includes(current.state))return;
   const previous=current.observation&&JSON.parse(current.observation);
   const identity=value=>JSON.stringify(['requestId','state','deploymentId','resourceId','slotRevision','runtimeKind','runtimeUrl','exitCode'].map(key=>value?.[key]));
   if(!previous||previous.state!==current.state||identity(previous)!==identity(observation))throw fault('Original terminal deployment observation changed.','deployment_terminal_conflict',409);
 }
 function accept(row,observation){
  // lookup/submit already passed the actual original client's V2 receipt check.
  if(observation?.requestId!==row.request_id||!['unknown','running','completed','failed'].includes(observation.state))throw fault('Original deployment observation invalid.','deployment_receipt',502);
  const unchanged=()=>{
   const current=find(row.principal,row.request_id);
   if(!current||current.fingerprint!==row.fingerprint||!Buffer.from(current.manifest).equals(Buffer.from(row.manifest))||!Buffer.from(current.artifact).equals(Buffer.from(row.artifact)))throw fault('Original selected operation changed.','deployment_integrity',409);
   selected(current);return current;
  };
  verifyTerminal(unchanged(),observation);
  db.prepare("UPDATE codeoss_cloud_operations SET state=?,observation=? WHERE principal=? AND request_id=? AND state NOT IN ('completed','failed')").run(observation.state,JSON.stringify(observation),row.principal,row.request_id);
  const current=unchanged();verifyTerminal(current,observation);return result(current);
 }
 async function reconcile(ctx,requestId,{signal}={}){
  if(!validID(requestId))throw fault('Original request ID required.','deployment_operation',400);
  const owner=await ownerFor(ctx,'read-deployment-v2',{requestId}),row=find(owner,requestId);if(!row)throw fault('Original operation not found.','deployment_not_found',404);
  const selection=selected(row);signal?.throwIfAborted();
  if(row.state==='awaiting-approval'){await recheck(ctx,'read-deployment-v2',selection,owner);return result(row);}
  let observation;
  try {observation=await client.lookupOriginal(selection,{signal});}
  catch(error){await recheck(ctx,'read-deployment-v2',selection,owner);signal?.throwIfAborted();return {...result(find(owner,requestId)),unavailable:{status:Number.isInteger(error?.status)?error.status:0}};}
  await recheck(ctx,'read-deployment-v2',selection,owner);const observed=accept(row,observation);signal?.throwIfAborted();return observed;
 }
 async function prepare(ctx,{requestId,manifest,artifact,expectedSlotRevision,rollbackTo=''}, {signal}={}) {
  signal?.throwIfAborted();
  if(!validNewID(requestId))throw fault('A new deployment request requires req_ followed by 12 to 80 allowed characters. Historical operations remain query-only.','deployment_request_id',400);
  if(!(artifact instanceof Uint8Array)||!artifact.length||artifact.length>64*1024*1024)throw fault('Bounded original artifact and request ID required.','deployment_operation',400);
  const bytes=Buffer.from(artifact),prepared=client.prepare(manifest,bytes,{requestId,expectedSlotRevision,rollbackTo}),payload=Buffer.from(client.payloadOriginal(prepared));
  // All refs and epochs are supplied by original owners and captured by the
  // sole codec; none are derived from Ref.rev or issuer declarations here.
  const selection=JSON.parse(JSON.stringify(prepared.selection));client.verifyReadback(selection,payload,bytes);
  const fingerprint=hash(Buffer.from(JSON.stringify(selection))),owner=await ownerFor(ctx,'prepare-deployment-v2',selection);signal?.throwIfAborted();
  if(rollbackTo){const prior=find(owner,rollbackTo);if(!prior||selected(prior).manifestVersion!=='2')throw fault('Original V2 rollback target required.','deployment_rollback',404);const observed=await reconcile(ctx,rollbackTo,{signal});if(observed.state!=='completed'||!Buffer.from(prior.manifest).equals(payload)||!Buffer.from(prior.artifact).equals(bytes))throw fault('Rollback requires original successful selected bytes.','deployment_rollback',409);}
  await recheck(ctx,'prepare-deployment-v2',selection,owner);signal?.throwIfAborted();
  db.prepare("INSERT OR IGNORE INTO codeoss_cloud_operations(principal,request_id,fingerprint,manifest,approval,artifact,state,observation,selection) VALUES(?,?,?,?,?,?,'awaiting-approval',NULL,?)").run(owner,requestId,fingerprint,payload,Buffer.alloc(0),bytes,JSON.stringify(selection));
  const row=find(owner,requestId);if(row.fingerprint!==fingerprint||!Buffer.from(row.manifest).equals(payload)||!Buffer.from(row.artifact).equals(bytes))throw fault('Original operation already selects different bytes or slot.','deployment_conflict',409);
  selected(row);return {...result(row),selection:JSON.parse(row.selection),payloadOriginal:Buffer.from(row.manifest)};
 }
 async function submit(ctx,{requestId,approval},{signal}={}) {
  signal?.throwIfAborted();
  if(!validID(requestId)||!(approval instanceof Uint8Array)||!approval.length||approval.length>1048576)throw fault('Actual original Auth V2 approval bytes required.','deployment_operation',400);
  const approved=Buffer.from(approval),owner=await ownerFor(ctx,'read-deployment-v2',{requestId});let row=find(owner,requestId);if(!row)throw fault('Prepare the original operation first.','deployment_not_found',404);
  const selection=selected(row),exact={...selection,approvalSHA256:hash(approved)};
  if(row.state!=='awaiting-approval'){if(!Buffer.from(row.approval).equals(approved))throw fault('Approval differs from the original operation.','deployment_conflict',409);return reconcile(ctx,requestId,{signal});}
  if(!validNewID(requestId))throw fault('Preserve this historical request and query its original result; do not rename or resubmit it.','deployment_request_id_reconcile_only',409);
  if(selection.rollbackTo&&Buffer.from(find(owner,selection.rollbackTo)?.approval??[]).equals(approved))throw fault('Rollback requires a new original approval.','deployment_rollback',409);
  await recheck(ctx,'submit-deployment-v2',exact,owner);signal?.throwIfAborted();
  // Only one writer may enter the effect. A crash after this durable claim is
  // UNKNOWN forever until original GET reconciliation, never a second POST.
  const claim=db.prepare("UPDATE codeoss_cloud_operations SET approval=?,state='unknown' WHERE principal=? AND request_id=? AND state='awaiting-approval' AND length(approval)=0").run(approved,owner,requestId);
  if(!claim.changes){if(!Buffer.from(find(owner,requestId).approval).equals(approved))throw fault('Approval differs from the original operation.','deployment_conflict',409);return reconcile(ctx,requestId,{signal});}
  row=find(owner,requestId);await recheck(ctx,'submit-deployment-v2',exact,owner);signal?.throwIfAborted();
  const prepared=client.prepare(selection.manifest,Buffer.from(row.artifact),selection);
  if(!Buffer.from(client.payloadOriginal(prepared)).equals(Buffer.from(row.manifest)))throw fault('Original V2 payload changed.','deployment_integrity',409);
  let observation;
  try {observation=await client.submitPrepared(prepared,approved,{signal});}
  catch(error){await recheck(ctx,'read-deployment-v2',selection,owner);signal?.throwIfAborted();return {...result(find(owner,requestId)),unavailable:{status:Number.isInteger(error?.status)?error.status:0}};}
  await recheck(ctx,'read-deployment-v2',selection,owner);const observed=accept(row,observation);signal?.throwIfAborted();return observed;
 }
 async function signPrepared(ctx,{requestId},{signal}={}) {
  signal?.throwIfAborted();
  if(!validID(requestId))throw fault('Original request ID required.','deployment_operation',400);
  const owner=await ownerFor(ctx,'read-deployment-v2',{requestId}),row=find(owner,requestId);if(!row)throw fault('Prepare the original operation first.','deployment_not_found',404);
  const selection=selected(row);await recheck(ctx,'sign-deployment-v2',selection,owner);signal?.throwIfAborted();
  if(row.signing_state||row.state!=='awaiting-approval')return result(row);
  if(!validNewID(requestId))throw fault('Choose a valid new request before signing; the historical request is unchanged.','deployment_request_id',400);
  let entered=false;
  try {
   const partial=await signer.sign(JSON.stringify([owner,requestId]),Buffer.from(row.manifest),Buffer.from(row.artifact),{
    signal,
    reserve:()=>{
     selected(find(owner,requestId));
     const claim=db.prepare("UPDATE codeoss_cloud_operations SET signing_state='unknown',signing_cleanup=1 WHERE principal=? AND request_id=? AND signing_state IS NULL AND state='awaiting-approval'").run(owner,requestId);
     if(!claim.changes)throw fault('Reconcile the original signing attempt.','IDE_DEPLOYMENT_V2_SIGNING_RECONCILE_REQUIRED',409);
     entered=true;
    },
    beforeSign:async()=>{await recheck(ctx,'sign-deployment-v2',selection,owner);signal?.throwIfAborted();},
    retainPartial:partial=>{if(entered)db.prepare('UPDATE codeoss_cloud_operations SET signing_partial=? WHERE principal=? AND request_id=?').run(JSON.stringify(partial),owner,requestId);},
   });
   if(!Buffer.from(partial.payloadOriginal,'base64url').equals(Buffer.from(row.manifest)))throw fault('Original signed payload changed.','deployment_integrity',409);
   db.prepare("UPDATE codeoss_cloud_operations SET signing_state='signed',signing_cleanup=0 WHERE principal=? AND request_id=? AND signing_state='unknown'").run(owner,requestId);
   await recheck(ctx,'read-deployment-v2',selection,owner);signal?.throwIfAborted();return result(find(owner,requestId));
  }catch(error){
   if(entered)db.prepare('UPDATE codeoss_cloud_operations SET signing_cleanup=? WHERE principal=? AND request_id=?').run(error?.cleanupPending?1:0,owner,requestId);
   throw error;
  }
 }
 async function finishSigningCleanup(ctx,{requestId}) {
  if(!validID(requestId))throw fault('Original request ID required.','deployment_operation',400);
  const owner=await ownerFor(ctx,'read-deployment-v2',{requestId}),row=find(owner,requestId);if(!row)throw fault('Original operation not found.','deployment_not_found',404);
  const selection=selected(row);await recheck(ctx,'read-deployment-v2',selection,owner);
  if(row.signing_cleanup===1){signer.finishCleanup(JSON.stringify([owner,requestId]));db.prepare('UPDATE codeoss_cloud_operations SET signing_cleanup=0 WHERE principal=? AND request_id=?').run(owner,requestId);}
  return result(find(owner,requestId)); // Cleanup never promotes UNKNOWN to signed.
 }
 async function submitSigned(ctx,{requestId},{signal}={}) {
  signal?.throwIfAborted();
  if(!validID(requestId))throw fault('Original request ID required.','deployment_operation',400);
  const owner=await ownerFor(ctx,'read-deployment-v2',{requestId}),row=find(owner,requestId);if(!row)throw fault('Original operation not found.','deployment_not_found',404);
  const selection=selected(row);await recheck(ctx,'submit-deployment-v2',selection,owner);signal?.throwIfAborted();
  const partial=row.signing_partial&&JSON.parse(row.signing_partial);
  if(row.signing_state!=='signed'||row.signing_cleanup!==0||partial?.signed!==true||!Buffer.from(partial.payloadOriginal,'base64url').equals(Buffer.from(row.manifest)))throw fault('Original signing and cleanup must complete before submission.','IDE_DEPLOYMENT_V2_SIGNING_RECONCILE_REQUIRED',409);
  // These are actual original SDK operations, not a caller-owned codec/proof.
  // Raw Member travels in the original approval part. The protected SERVER
  // Source/Catalog separately acquires execution approval for this SAME request.
  const member=Buffer.from(partial.memberOriginal,'base64url');
  if(row.state!=='awaiting-approval'){
   if(!Buffer.from(row.approval).equals(member))throw fault('Original member differs from the entered operation.','deployment_conflict',409);
   return reconcile(ctx,requestId,{signal});
  }
  if(!validNewID(requestId))throw fault('Preserve this historical signature and request; only query the original result.','deployment_request_id_reconcile_only',409);
  if(['captureOriginalE11Result','captureMultipartOriginal','submitOriginalE11'].some(name=>typeof client[name]!=='function'))throw fault('The matching original SDK/Native whole-multipart proof transport is not supplied.','IDE_DEPLOYMENT_V2_WHOLE_MULTIPART_TRANSPORT_NOT_SUPPLIED',503);
  const prepared=client.prepare(selection.manifest,Buffer.from(row.artifact),selection);
  if(!Buffer.from(client.payloadOriginal(prepared)).equals(Buffer.from(row.manifest)))throw fault('Original V2 payload changed.','deployment_integrity',409);
  const retained=client.captureOriginalE11Result(prepared,partial);
  if(retained?.readyForTransport!==true||retained.sourceGranted!==false||retained.independentlyVerifiedByCloud!==false||retained.deployed!==false)throw fault('Original signature transport capture is not ready.','deployment_integrity',409);
  // SDK serializes once before proof; its same prepared owner retains this
  // exact boundary/body for submission. No fetch-generated second boundary.
  const snapshot=await client.captureMultipartOriginal(prepared,member);
  const exact={...selection,approvalSHA256:hash(member)};
  await recheck(ctx,'submit-deployment-v2',exact,owner);signal?.throwIfAborted();
  const claim=db.prepare("UPDATE codeoss_cloud_operations SET approval=?,state='unknown',upload_body_sha256=?,upload_content_type=? WHERE principal=? AND request_id=? AND state='awaiting-approval' AND length(approval)=0").run(member,hash(snapshot.bodyOriginal),snapshot.contentType,owner,requestId);
  if(!claim.changes){if(!Buffer.from(find(owner,requestId).approval).equals(member))throw fault('Original member differs from the entered operation.','deployment_conflict',409);return reconcile(ctx,requestId,{signal});}
  await recheck(ctx,'submit-deployment-v2',exact,owner);signal?.throwIfAborted();
  let observation;
  try {observation=await client.submitOriginalE11(prepared,{signal});}
  catch(error){await recheck(ctx,'read-deployment-v2',selection,owner);signal?.throwIfAborted();return {...result(find(owner,requestId)),unavailable:{status:Number.isInteger(error?.status)?error.status:0}};}
  await recheck(ctx,'read-deployment-v2',selection,owner);const observed=accept(find(owner,requestId),observation);signal?.throwIfAborted();return observed;
 }
 // Read only from the SAME durable operation. These observations never
 // reconcile POST state, create a bill, enter Pay, or acquire a signer.
 async function observe(ctx,{requestId,view,period,productId,sourceOrder},{signal,originalRequestContext}={}) {
  signal?.throwIfAborted();
  // Host owns this lifecycle object. Preserve its identity for the original
  // client/sender; it is neither project authority nor a new request proof.
  // Legacy callers may omit it, but an invalid supplied context must not fall
  // back to a different signal or silently start an uncancellable read.
  if(originalRequestContext!==undefined){
   if(originalRequestContext===null||typeof originalRequestContext!=='object')throw fault('The original read context must retain its Host signal.','deployment_read_context',400);
   const keys=Reflect.ownKeys(originalRequestContext),descriptor=Object.getOwnPropertyDescriptor(originalRequestContext,'signal');
   let actualSignal=false;
   try{Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(signal);actualSignal=true;}catch{}
   if(!Object.isFrozen(originalRequestContext)||keys.length!==1||keys[0]!=='signal'||!descriptor||!Object.hasOwn(descriptor,'value')||descriptor.value!==signal||!actualSignal)throw fault('The original read context must retain its Host signal.','deployment_read_context',400);
  }
  const readOptions=originalRequestContext===undefined?{signal}:{signal,originalRequestContext};
  const method=new Map([['runtime','runtime'],['logs','logs'],['usage','usage'],['bill','billOriginal'],['native-invoice-intent','nativeInvoiceIntentOriginal']]).get(view);
  if(!validID(requestId)||!method)throw fault('An original operation and supported observation are required.','deployment_observation',400);
  const owner=await ownerFor(ctx,'read-deployment-v2',{requestId}),row=find(owner,requestId);
  if(!row)throw fault('Original operation not found.','deployment_not_found',404);
  const selection=selected(row);
  if(row.state==='awaiting-approval')throw fault('This operation has not entered deployment.','deployment_observation',409);
  if(typeof client[method]!=='function')throw fault('The matching original Cloud observation client is not supplied.','deployment_observation_unavailable',503);
  await recheck(ctx,'read-deployment-v2',selection,owner);signal?.throwIfAborted();
  const unchanged=()=>{
   const current=find(owner,requestId);
   if(!current||current.fingerprint!==row.fingerprint||!Buffer.from(current.manifest).equals(Buffer.from(row.manifest))||!Buffer.from(current.artifact).equals(Buffer.from(row.artifact)))throw fault('Original selected operation changed.','deployment_integrity',409);
   selected(current);return current;
  };
  unchanged();
  let value;
  try {
   if(view==='runtime')value=await client.runtime(selection,readOptions);
   else if(view==='logs')value=await client.logs(selection,readOptions);
   else if(view==='usage')value=await client.usage(selection,{...readOptions,observe:false});
   else if(view==='bill')value=await client.billOriginal(selection,period,readOptions);
   else value=await client.nativeInvoiceIntentOriginal(selection,period,{...readOptions,productId,sourceOrder});
  } catch(error) {
   await recheck(ctx,'read-deployment-v2',selection,owner);signal?.throwIfAborted();unchanged();throw error;
  }
  await recheck(ctx,'read-deployment-v2',selection,owner);signal?.throwIfAborted();
  const current=unchanged();if(view==='runtime')verifyTerminal(current,value);
  return value;
 }
 return Object.freeze({prepare,signPrepared,finishSigningCleanup,submitSigned,submit,reconcile,observe});
}

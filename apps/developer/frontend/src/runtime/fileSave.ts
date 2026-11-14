export type FileSaveIntent = Readonly<{projectId:string;expectedRevision:number;path:string;contents:string;idempotencyKey:string}>;
// workspace is the ORIGINAL saved revision, not an assertion about current editor state.
export type FileSaveStatus = Readonly<{state:'prepared'|'saving'|'unknown'|'saved'|'rejected';workspace?:Record<string,any>;code?:string}>;
type Request = (path:string,init:RequestInit)=>Promise<Response>;
const validPath=(path:string)=>typeof path==='string'&&new TextEncoder().encode(path).length<=240&&path.length>0&&!path.startsWith('/')&&
 /^[\p{L}\p{M}\p{N}_./ +@-]+$/u.test(path)&&!path.split('/').some(part=>!part||part==='.'||part==='..');
async function requestDigest(intent:FileSaveIntent) {
 const bytes=new TextEncoder().encode(JSON.stringify({domain:'YNX_WORKSPACE_FILE_SAVE_V1',expectedRevision:intent.expectedRevision,path:intent.path,contents:intent.contents}));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
// One original save operation. A lost write response is reconciled with reads;
// it cannot rotate the key, silently merge later source or repeat a PATCH.
export function createWorkspaceFileSave(input:Omit<FileSaveIntent,'idempotencyKey'> & {idempotencyKey?:string},
 {request = fetch, resumed = false}:{request?:Request;resumed?:boolean} = {}) {
 const intent:FileSaveIntent=Object.freeze({projectId:input.projectId,expectedRevision:input.expectedRevision,path:input.path,contents:input.contents,idempotencyKey:input.idempotencyKey||crypto.randomUUID()});
 if(!/^[A-Za-z0-9_-]{1,160}$/.test(intent.projectId)||!Number.isSafeInteger(intent.expectedRevision)||intent.expectedRevision<1||
  !validPath(intent.path)||typeof intent.contents!=='string'||new TextEncoder().encode(intent.contents).length>2*1024*1024||
  !/^[A-Za-z0-9_-]{8,160}$/.test(intent.idempotencyKey))throw Error('An existing project, exact revision, normalized file path and bounded contents are required.');
 const url=`/runtime/workspaces/${encodeURIComponent(intent.projectId)}`;
 let attempted=resumed,state:FileSaveStatus={state:resumed?'unknown':'prepared'},inflight:Promise<FileSaveStatus>|undefined;
 const result=(next:FileSaveStatus)=>{state=Object.freeze(next);return state;};
 const actualWorkspace=(value:any)=>value&&value.revision===intent.expectedRevision+1&&value.files&&
  Object.hasOwn(value.files,intent.path)&&value.files[intent.path]===intent.contents;
 async function reconcile(signal?:AbortSignal):Promise<FileSaveStatus> {
  if(state.state==='saved')return state;
  try {
   const receiptResponse=await request(`${url}?view=mutation&idempotencyKey=${encodeURIComponent(intent.idempotencyKey)}`,{credentials:'same-origin',cache:'no-store',signal});
   if(!receiptResponse.ok)return result({state:'unknown',code:'save_receipt_unavailable'});
   const receipt=(await receiptResponse.json()).receipt;
   if(receipt?.requestHash!==await requestDigest(intent)||receipt?.revision!==intent.expectedRevision+1)return result({state:'unknown',code:'save_receipt_mismatch'});
   const snapshotResponse=await request(`${url}?view=snapshot&revision=${receipt.revision}`,{credentials:'same-origin',cache:'no-store',signal});
   if(!snapshotResponse.ok)return result({state:'unknown',code:'save_snapshot_unavailable'});
   const workspace=(await snapshotResponse.json()).workspace;
   return actualWorkspace(workspace)?result({state:'saved',workspace}):result({state:'unknown',code:'save_snapshot_mismatch'});
  } catch {return result({state:'unknown',code:'save_connection_unavailable'});}
 }
 async function dispatch(signal?:AbortSignal):Promise<FileSaveStatus> {
  if(attempted)return reconcile(signal);
  signal?.throwIfAborted();attempted=true;result({state:'saving'});
  try {
   const response=await request(url,{method:'PATCH',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},
    body:JSON.stringify({protocolVersion:'ynx-code/v1',expectedRevision:intent.expectedRevision,idempotencyKey:intent.idempotencyKey,path:intent.path,contents:intent.contents}),signal});
   const value=await response.json();
   if(response.ok&&actualWorkspace(value.workspace))return result({state:'saved',workspace:value.workspace});
   if(!response.ok&&['revision_conflict','core_writer_active','core_native_project','invalid_revision','invalid_workspace_snapshot','workspace_not_found'].includes(value.code))return result({state:'rejected',code:value.code});
   return result({state:'unknown',code:value.code||'save_response_unverified'});
  } catch {return result({state:'unknown',code:'save_connection_unavailable'});}
 }
 return Object.freeze({intent,status:()=>state,serialize:()=>({intent,attempted}),
  submit(signal?:AbortSignal){if(inflight)return inflight;inflight=dispatch(signal).finally(()=>{inflight=undefined;});return inflight;},reconcile});
}
export function resumeWorkspaceFileSave(saved:{intent:FileSaveIntent;attempted:boolean},options:{request?:Request}={}) {
 if(!saved||saved.attempted!==true)throw Error('An original attempted save is required for recovery.');
 return createWorkspaceFileSave(saved.intent,{...options,resumed:true});
}

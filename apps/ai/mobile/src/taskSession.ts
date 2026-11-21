import type {OriginalAITaskActionV6Client as Client} from '../contracts/sdk047/original-ai-task-action-v6-client';
import type {TaskCredentials} from './tasks';
import type {V6Persistence} from './taskV6';
export interface TaskSessionRuntime {open(signal:AbortSignal):Promise<TaskCredentials>;openWorkspace(signal:AbortSignal):Promise<TaskCredentials>;bindWorkspace(client:Client,close:()=>Promise<void>):void;retire():Promise<void>}
const cancelled=()=>Error('TASK_SESSION_RETIRED_OR_CANCELLED');
// Application lifetime scheduling only. The normal composition supplies the
// sole zero-input SDK opener; no product route/provider can install authority.
export class TaskSessionLifetime implements TaskSessionRuntime {
 private retired=false;private closing:Promise<void>|null=null;
 private clients=new Set<Client>();private flights=new Set<Promise<unknown>>();
 private cleanupPresent=false;private cleanupCause:unknown;
 private workspaceTail:Promise<void>=Promise.resolve();
 private workspaceClosers=new Map<Client,()=>Promise<void>>();
 constructor(private identity:string,private acquireOriginal:()=>Promise<Client>,private journal:V6Persistence,private newOperationId:()=>string){}
 private remember(error:unknown){if(!this.cleanupPresent){this.cleanupPresent=true;this.cleanupCause=error}}
 open(signal:AbortSignal):Promise<TaskCredentials>{
  if(this.retired||signal.aborted)return Promise.reject(cancelled());
  if(this.cleanupPresent)return Promise.reject(this.cleanupCause);
  // Reserve before invoking foreign async acquisition, including sync throws.
  const flight=Promise.resolve().then(async()=>{
   if(this.retired||signal.aborted)throw cancelled();
   if(this.cleanupPresent)throw this.cleanupCause;
   const original=await this.acquireOriginal();let closing:Promise<void>|null=null;
   const client:Client={prepare:i=>original.prepare(i),prove:p=>original.prove(p),send:p=>original.send(p),read:p=>original.read(p),lookupOriginal:(id,c)=>original.lookupOriginal(id,c),readRecovery:r=>original.readRecovery(r),close:()=>{
    if(closing)return closing;
    closing=Promise.resolve().then(()=>original.close()).then(()=>{this.clients.delete(client)},error=>{this.remember(error);throw error});return closing;
   }};
   this.clients.add(client);
   if(this.cleanupPresent){await client.close();throw this.cleanupCause}
   if(this.retired||signal.aborted){await client.close();throw cancelled()}
   return {identity:this.identity,v6:{client,journal:this.journal,newOperationId:this.newOperationId}};
  });
  this.flights.add(flight);void flight.then(()=>this.flights.delete(flight),()=>this.flights.delete(flight));return flight;
 }
 // A workspace owns both the original client and its local journals. A new
 // screen waits for the old adapter to drain and close before reading them.
 async openWorkspace(signal:AbortSignal):Promise<TaskCredentials>{
  if(this.retired||signal.aborted)throw cancelled();
  const previous=this.workspaceTail;let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  this.workspaceTail=previous.then(()=>held);
  try{
   await new Promise<void>((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(cancelled())};
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){abort();return}
    void previous.then(()=>{signal.removeEventListener('abort',abort);resolve()},error=>{signal.removeEventListener('abort',abort);reject(error)});
   });
   const credentials=await this.open(signal);const client=credentials.v6!.client;const close=client.close.bind(client);
   let workspaceClose:Promise<void>|null=null;
   client.close=()=>{if(!workspaceClose)workspaceClose=close().then(()=>{this.workspaceClosers.delete(client);release()},error=>{release();throw error});return workspaceClose};
   if(this.retired||signal.aborted){await client.close();throw cancelled()}
   return credentials;
  }catch(error){release();throw error}
 }
 bindWorkspace(client:Client,close:()=>Promise<void>){
  if(this.retired||!this.clients.has(client)||this.workspaceClosers.has(client))throw Error('TASK_WORKSPACE_OWNER_UNAVAILABLE');
  this.workspaceClosers.set(client,close);
 }
 retire():Promise<void>{
  if(this.closing)return this.closing;this.retired=true;
  const existing=[...this.clients].map(c=>{const close=this.workspaceClosers.get(c);return close?Promise.resolve().then(close):c.close()});
  this.closing=(async()=>{const [results]=await Promise.all([Promise.allSettled(existing),Promise.allSettled([...this.flights])]);for(const result of results)if(result.status==='rejected')this.remember(result.reason);await Promise.allSettled([...this.clients].filter(c=>!this.workspaceClosers.has(c)).map(c=>c.close()));if(this.cleanupPresent)throw this.cleanupCause})();return this.closing;
 }
}

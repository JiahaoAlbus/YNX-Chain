import type {OriginalAITaskActionV6Client as Client} from '../contracts/sdk047/original-ai-task-action-v6-client';
import type {TaskCredentials} from './tasks';
import type {V6Persistence} from './taskV6';
export interface TaskSessionRuntime {open(signal:AbortSignal):Promise<TaskCredentials>;retire():Promise<void>}
const cancelled=()=>Error('TASK_SESSION_RETIRED_OR_CANCELLED');
// Application lifetime scheduling only. The normal composition supplies the
// sole zero-input SDK opener; no product route/provider can install authority.
export class TaskSessionLifetime implements TaskSessionRuntime {
 private retired=false;private closing:Promise<void>|null=null;
 private clients=new Set<Client>();private flights=new Set<Promise<unknown>>();
 private cleanupPresent=false;private cleanupCause:unknown;
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
 retire():Promise<void>{
  if(this.closing)return this.closing;this.retired=true;
  const existing=[...this.clients].map(c=>c.close());
  this.closing=(async()=>{await Promise.allSettled([...existing,...this.flights]);await Promise.allSettled([...this.clients].map(c=>c.close()));if(this.cleanupPresent)throw this.cleanupCause})();return this.closing;
 }
}

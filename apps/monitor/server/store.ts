import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Alert, AuditEvent, Incident, OpsState, Principal } from './types.js';

const empty = (): OpsState => ({ incidents:[], alerts:[], audits:[], rollbackProposals:[], backupRecords:[] });
export class OpsStore {
  private state: OpsState = empty();
  private loaded = false;
  private writes: Promise<void> = Promise.resolve();
  constructor(private path:string) {}
  async load() { if (this.loaded) return; try { this.state = JSON.parse(await readFile(this.path,'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } this.loaded = true; }
  snapshot() { return structuredClone(this.state); }
  async persist() { const content=JSON.stringify(this.state,null,2); this.writes=this.writes.then(async()=>{await mkdir(dirname(this.path),{recursive:true,mode:0o700});const temp=`${this.path}.${process.pid}.${randomUUID()}.tmp`;await writeFile(temp,content,{mode:0o600});await rename(temp,this.path)});await this.writes; }
  async audit(principal:Principal, action:string, target:string, outcome:string, evidence?:Record<string,unknown>) { const item:AuditEvent={id:randomUUID(),at:new Date().toISOString(),actor:principal.username,role:principal.role,action,target,outcome,evidence}; this.state.audits.unshift(item); this.state.audits=this.state.audits.slice(0,500); await this.persist(); return item; }
  async createIncident(principal:Principal, input:Pick<Incident,'title'|'severity'|'source'|'evidence'>) { const item:Incident={id:`inc_${randomUUID()}`,title:input.title,severity:input.severity,status:'open',openedAt:new Date().toISOString(),source:input.source,evidence:input.evidence,notes:[]}; this.state.incidents.unshift(item); await this.audit(principal,'incident.create',item.id,'created',{source:item.source}); return item; }
  async acknowledge(principal:Principal,id:string) { const alert=this.state.alerts.find(a=>a.id===id); if(!alert) return undefined; if(alert.state==='acknowledged') return alert; alert.state='acknowledged'; alert.acknowledgedBy=principal.username; alert.acknowledgedAt=new Date().toISOString(); await this.audit(principal,'alert.acknowledge',id,'acknowledged',{reason:alert.reason}); return alert; }
  async observeFailure(source:string,reason:string,evidenceUrl:string) { const now=new Date().toISOString(); const id=`upstream:${source}`; let alert=this.state.alerts.find(a=>a.id===id); if(!alert){alert={id,source,state:'firing',firstObservedAt:now,lastObservedAt:now,reason,evidenceUrl};this.state.alerts.unshift(alert);}else{alert.lastObservedAt=now;alert.reason=reason;if(alert.state==='resolved')alert.state='firing';} await this.persist(); return alert; }
  async observeRecovery(source:string) { const alert=this.state.alerts.find(a=>a.id===`upstream:${source}`); if(alert&&alert.state!=='resolved'){alert.state='resolved';alert.lastObservedAt=new Date().toISOString();await this.persist();} }
  async addRollbackProposal(principal:Principal, release:string, reason:string) { const proposal={id:`rb_${randomUUID()}`,release,reason,status:'approved-not-executed',approvedBy:principal.username,approvedAt:new Date().toISOString(),executionBoundary:'central infrastructure owner'};this.state.rollbackProposals.unshift(proposal);await this.audit(principal,'rollback.propose',String(proposal.id),'approved-not-executed',{release});return proposal; }
  async addBackupRecord(principal:Principal, evidence:string) { const item={id:`backup_${randomUUID()}`,evidence,status:'evidence-recorded',recordedAt:new Date().toISOString(),recordedBy:principal.username};this.state.backupRecords.unshift(item);await this.audit(principal,'backup.record',String(item.id),'recorded',{evidence});return item; }
}

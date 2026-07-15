export type Role = 'viewer' | 'operator';
export interface Principal { username:string; role:Role }
export interface AuditEvent { id:string; at:string; actor:string; role:Role; action:string; target:string; outcome:string; evidence?:Record<string,unknown> }
export interface Incident { id:string; title:string; severity:'low'|'medium'|'high'|'critical'; status:'open'|'investigating'|'resolved'; openedAt:string; source:string; evidence:string[]; notes:string[] }
export interface Alert { id:string; source:string; state:'firing'|'acknowledged'|'resolved'; firstObservedAt:string; lastObservedAt:string; reason:string; evidenceUrl:string; acknowledgedBy?:string; acknowledgedAt?:string }
export interface OpsState { incidents:Incident[]; alerts:Alert[]; audits:AuditEvent[]; rollbackProposals:Array<Record<string,unknown>>; backupRecords:Array<Record<string,unknown>> }

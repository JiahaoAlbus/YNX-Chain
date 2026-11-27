import type {WorkspaceRecord} from './tasks';

// Missing and corrupt journals have different meanings: a corrupt existing
// record may contain an unresolved original operation and must never reset it.
export function decodeStoredWorkspaceRecord(raw:string|null):WorkspaceRecord|null{
 if(raw===null)return null;
 if(raw.length>64<<10)throw Error('TASK_JOURNAL_INVALID');
 let record:WorkspaceRecord;
 try{record=JSON.parse(raw) as WorkspaceRecord}catch{throw Error('TASK_JOURNAL_INVALID')}
 if(!record||typeof record.selectedTask!=='string'||typeof record.runId!=='string'||!Array.isArray(record.deliveries)||record.deliveries.length>64||record.deliveries.some(d=>!d||typeof d.id!=='string'||typeof d.binding!=='string'||!['PENDING','UNKNOWN','RESPONSE_RECEIVED','REJECTED_RESPONSE','ORIGINAL_OBSERVED'].includes(d.state)))throw Error('TASK_JOURNAL_INVALID');
 return record;
}

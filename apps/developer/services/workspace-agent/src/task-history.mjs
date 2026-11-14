import { createHash } from 'node:crypto';
const MAX_OUTPUT=1024*1024, MAX_OUTCOME=2*1024*1024;
const fail=message=>Object.assign(Error(message),{code:'task_history_invalid'});
const text=value=>typeof value==='string'&&value.length>0&&value.length<=512;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function sourceIdentity(files){
 if(!files||typeof files!=='object'||Array.isArray(files))throw fail('Task history needs the validated file map.');
 const rows=Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0);let size=0;
 if(rows.length<1||rows.length>256)throw fail('Invalid task file count.');
 const hashes=rows.map(([path,content])=>{if(!text(path)||typeof content!=='string')throw fail('Invalid task source.');size+=Buffer.byteLength(content);if(size>2*1024*1024)throw fail('Task source exceeds 2 MiB.');return [path,digest(content)];});
 return digest(JSON.stringify(hashes));
}
function outcomeOf({result,error}={}){
 if((result===undefined)===(error===undefined))throw fail('Supply exactly one actual result or error.');
 if(error!==undefined){const value={code:typeof error?.code==='string'?error.code.slice(0,256):'task_failed',message:String(error?.message||'Task failed.').slice(0,8192),...(Number.isInteger(error?.status)?{status:error.status}:{})};return {status:error?.name==='AbortError'||value.code==='task_cancelled'?'cancelled':'failed',outcome:{error:value}};}
 if(!result||typeof result!=='object'||!Number.isInteger(result.code)||typeof result.ok!=='boolean')throw fail('Task result must include its real exit code and outcome.');
 let value=JSON.parse(JSON.stringify(result));
 if(typeof value.output==='string'&&Buffer.byteLength(value.output)>MAX_OUTPUT){value.output=Buffer.from(value.output).subarray(0,MAX_OUTPUT).toString('utf8');value.historyTruncated=true;}
 if(Buffer.byteLength(JSON.stringify(value))>MAX_OUTCOME)value={taskId:value.taskId,ok:value.ok,code:value.code,output:typeof value.output==='string'?value.output:undefined,historyTruncated:true};
 return {status:result.code===130?'cancelled':result.ok&&result.code===0?'completed':'failed',outcome:{result:value}};
}
// Original WAL database, local observations only. The caller must retain normal
// product authorization; neither a task ID nor this history grants access.
export function createTaskHistory({db,instanceId}={}){
 if(!db||!text(instanceId))throw fail('Original database and runtime instance are required.');
 db.exec(`CREATE TABLE IF NOT EXISTS workspace_task_history(task_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,kind TEXT NOT NULL,source_sha256 TEXT NOT NULL,instance_id TEXT NOT NULL,status TEXT NOT NULL,outcome TEXT,queued_at TEXT NOT NULL,started_at TEXT,finished_at TEXT)`);
 const insert=db.prepare('INSERT INTO workspace_task_history(task_id,owner_id,project_id,kind,source_sha256,instance_id,status,queued_at) VALUES(?,?,?,?,?,?,?,?)');
 const get=db.prepare('SELECT * FROM workspace_task_history WHERE owner_id=? AND task_id=?');
 const startRow=db.prepare("UPDATE workspace_task_history SET status='running',started_at=? WHERE task_id=? AND instance_id=? AND status='queued'");
 const finishRow=db.prepare("UPDATE workspace_task_history SET status=?,outcome=?,finished_at=? WHERE task_id=? AND instance_id=? AND status IN ('queued','running')");
 return Object.freeze({
  begin({taskId,owner,projectId,kind,files}){
   if(![taskId,owner,projectId,kind].every(text))throw fail('Original task owner/project/kind are required.');
   const sourceSha256=sourceIdentity(files);
   insert.run(taskId,owner,projectId,kind,sourceSha256,instanceId,'queued',new Date().toISOString());
   return {taskId,sourceSha256};
  },
  start(taskId){if(!text(taskId))throw fail('Invalid task ID.');return startRow.run(new Date().toISOString(),taskId,instanceId).changes===1;},
  complete(taskId,actual){if(!text(taskId))throw fail('Invalid task ID.');const {status,outcome}=outcomeOf(actual);return finishRow.run(status,JSON.stringify(outcome),new Date().toISOString(),taskId,instanceId).changes===1;},
  read(owner,taskId){
   if(!text(owner)||!text(taskId))return null;const row=get.get(owner,taskId);if(!row)return null;
   const interrupted=row.instance_id!==instanceId&&['queued','running'].includes(row.status);
   return {taskId:row.task_id,projectId:row.project_id,kind:row.kind,sourceSha256:row.source_sha256,status:interrupted?'unknown':row.status,
    ...(interrupted?{previousStatus:row.status,retryable:false}:{}),outcome:row.outcome?JSON.parse(row.outcome):null,queuedAt:row.queued_at,startedAt:row.started_at,finishedAt:row.finished_at};
  },
 });
}

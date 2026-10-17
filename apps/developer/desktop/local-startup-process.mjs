import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
const execute=promisify(execFile);

// Only the read-only bundled-runtime version probe may be retried here.
// An EAGAIN is eligible only when Node returned a child handle without a PID:
// no process started. Never replay a task, service call, or an unknown spawn.
export async function inspectBundledNodeVersion(node,{run=execute,pause=delay,signal}={}){
 for(let attempt=0;attempt<3;attempt++){
  signal?.throwIfAborted();
  let pending;
  try{
   pending=run(node,['--version'],{timeout:5000,...(signal?{signal}:{})});
   return (await pending).stdout.trim();
  }catch(error){
   signal?.throwIfAborted();
   if(error?.code!=='EAGAIN'||!pending?.child||pending.child.pid!==undefined||attempt===2)throw error;
   await pause(100*(attempt+1),undefined,{signal});
  }
 }
}

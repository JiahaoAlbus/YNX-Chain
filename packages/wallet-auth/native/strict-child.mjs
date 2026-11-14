import {spawn} from 'node:child_process';

// Private process custody: do not report completion until the original child
// has emitted close. A kernel-blocked child may delay close after SIGKILL.
export function runBoundedChild(command, args, {timeoutMs, graceMs=5000, maxBytes=16*1024*1024}={}) {
 if (!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(graceMs)||graceMs<1||!Number.isSafeInteger(maxBytes)||maxBytes<1) throw Error('STRICT_CHILD_INVALID_LIMIT');
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});let first=null,bytes=0,killTimer=null,deadline=null;const stdout=[],stderr=[];
  const stop=(error)=>{if(first)return;first=error;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),graceMs);};
  const read=dest=>chunk=>{bytes+=chunk.length;if(bytes>maxBytes){stop(Object.assign(Error('STRICT_CHILD_OUTPUT_LIMIT'),{code:'STRICT_CHILD_OUTPUT_LIMIT'}));return;}dest.push(chunk);};
  child.stdout.on('data',read(stdout));child.stderr.on('data',read(stderr));
  child.once('error',error=>{if(!first)first=error;});
  deadline=setTimeout(()=>stop(Object.assign(Error('STRICT_CHILD_TIMEOUT'),{code:'STRICT_CHILD_TIMEOUT'})),timeoutMs);
  child.once('close',(status,signal)=>{clearTimeout(deadline);if(killTimer)clearTimeout(killTimer);const output={status,signal,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')};if(first){Object.assign(first,output);reject(first);}else if(status!==0)reject(Object.assign(Error('STRICT_CHILD_FAILED'),{code:'STRICT_CHILD_FAILED',...output}));else resolve(output);});
 });
}
export const verifyOriginalDeepStrict=app=>runBoundedChild('/usr/bin/codesign',['--verify','--deep','--strict',app],{timeoutMs:180000,graceMs:5000});

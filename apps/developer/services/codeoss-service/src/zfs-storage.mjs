import { spawn } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fault } from './central-identity.mjs';
export function createZfsProjectStorage({ projectsRoot, maxBytes = 1073741824, run = runHelper } = {}) {
  const root=resolve(projectsRoot);
  if(maxBytes!==1073741824)throw Error('First native ZFS project quota is fixed at1GiB.');
  function path(context){const directory=typeof context==='string'?context:context.projectDirectory;if(!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(relative(root,directory)))throw fault('Not the exact owner/project volume.','core_state_unsafe',503);return directory;}
  async function verify(directory){directory=path(directory);const value=JSON.parse((await run('verify',directory)).stdout);if(value.driver!=='zfs-refquota'||value.directory!==directory||value.maxBytes!==maxBytes||value.enforced!==true||value.hardIsolation!==true)throw fault('Native ZFS hard quota is not verified.','core_disk_quota_unavailable',503);return value;}
  async function prepare(context){const directory=path(context);await run('prepare',directory);await verify(directory);}
  return{prepare,verify,projectsRoot:root};
}
async function runHelper(action,directory){return new Promise((resolve,reject)=>{const child=spawn('/usr/bin/sudo',['-n','--','/usr/bin/node','/etc/ynx-developer/helpers/native-zfs-quota.mjs',action,directory],{shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C'}});let stdout='';child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>16384)child.kill('SIGTERM');});child.stderr.resume();const timer=setTimeout(()=>{child.kill('SIGTERM');reject(fault('Native quota helper timed out; preserve volume for review.','core_disk_quota_unavailable',503));},30000);child.on('error',()=>{clearTimeout(timer);reject(fault('Native quota helper is not installed.','core_disk_quota_unavailable',503));});child.on('close',code=>{clearTimeout(timer);if(code)reject(fault('Native quota helper rejected the volume; preserve it for review.','core_disk_quota_unavailable',503));else resolve({stdout});});});}

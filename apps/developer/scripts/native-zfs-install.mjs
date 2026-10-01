import { lstat, readFile, mkdir, writeFile, chown, chmod, statfs, open, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';import { promisify } from 'node:util';import { dirname, join } from 'node:path';import { fileURLToPath } from 'node:url';
import { protectedPath, protectedAncestors } from './native-zfs-quota-helper.mjs';
const execute=promisify(execFile),GIB=1024**3,ROOT='/etc/ynx-developer',HELPER=ROOT+'/helpers/native-zfs-quota.mjs',ZCONFIG=ROOT+'/native-zfs.json';
export function nativeInstallPlan(config){
  if(Object.keys(config).sort().join()!==['projectsRoot','serviceUid','serviceGid','zfsExecutable','zpoolExecutable','libraryDirectory','sourceHelperPath','expectedHelperSha256'].sort().join())throw Error('Unexpected install fields.');
  if(config.projectsRoot!=='/var/lib/ynx-native/projects'||!Number.isInteger(config.serviceUid)||config.serviceUid<=0||!Number.isInteger(config.serviceGid)||config.serviceGid<=0||!/^[a-f0-9]{64}$/.test(config.expectedHelperSha256))throw Error('Canonical new project path and actual Gateway UID/GID/helper digest are required.');
  if(!/^\/snap\/lxd\/\d+\/zfs-2\.2\/bin\/zfs$/.test(config.zfsExecutable)||config.zpoolExecutable!==config.zfsExecutable.replace(/\/zfs$/,'/zpool')||config.libraryDirectory!==join(dirname(dirname(config.zfsExecutable)),'lib'))throw Error('Fixed matching reviewed snap tools/library required.');
  return{dryRun:true,mutated:false,resources:{projectPool:'ynx-core-projects',projectBacking:'/var/lib/ynx-native/projects-vdev.bin',projectBytes:32*GIB,lxdPool:'ynx-core-quota',lxdBytes:64*GIB,rootReserveBytes:48*GIB,projectsRoot:config.projectsRoot,helper:HELPER,quotaConfig:ZCONFIG},commands:[
    ['/usr/bin/fallocate',['--length',String(32*GIB),'/var/lib/ynx-native/projects-vdev.bin']],
    [config.zpoolExecutable,['create','-o','cachefile=none','-O','mountpoint=none','-O','devices=off','-O','setuid=off','ynx-core-projects','/var/lib/ynx-native/projects-vdev.bin']],
    [config.zfsExecutable,['create','-o','mountpoint=none','ynx-core-projects/projects']],
    ['/snap/bin/lxc',['storage','create','ynx-core-quota','zfs','size=64GiB']],
  ],notAdmitted:['actual per-project quota-full write','LXD shifted UID0600 read/fsync/checkpoint','strict package/extension egress','independent execution origin','long-edit grant renewal','multi-user capacity']};
}
async function absent(path){try{await lstat(path);throw Error('Install target already exists; preserve and inspect prior installation.');}catch(error){if(error.code!=='ENOENT')throw error;}}
async function main(){
  const args=process.argv.slice(2);if(args.length>1||args[0]&&args[0]!=='--apply')throw Error('Usage: node scripts/native-zfs-install.mjs [--apply]; default is dry-run.');
  const file=ROOT+'/native-install.json';await protectedPath(ROOT,{directory:true});await protectedPath(file);const config=JSON.parse(await readFile(file,'utf8')),plan=nativeInstallPlan(config);
  if(args[0]!=='--apply'){console.log(JSON.stringify(plan,null,2));return;}
  if(process.platform!=='linux'||process.arch!=='x64'||process.getuid()!==0)throw Error('A applies only on the reviewed Linuxx64 host as operator root.');
  for(const path of [config.zfsExecutable,config.zpoolExecutable,config.libraryDirectory,config.sourceHelperPath,fileURLToPath(import.meta.url)])await protectedPath(path);
  await protectedAncestors(dirname(config.sourceHelperPath));await protectedAncestors(dirname(fileURLToPath(import.meta.url)));
  await protectedAncestors(ROOT);
  if(createHash('sha256').update(await readFile(config.sourceHelperPath)).digest('hex')!==config.expectedHelperSha256)throw Error('Quota helper source differs from reviewed candidate.');
  await protectedAncestors('/var/lib');
  for(const path of [plan.resources.projectBacking,config.projectsRoot,HELPER,ZCONFIG,ROOT+'/native-install-journal.json','/etc/sudoers.d/ynx-native-quota'])await absent(path);
  const fs=await statfs('/var/lib',{bigint:true});if(fs.bavail*fs.bsize<BigInt(32*GIB+64*GIB+48*GIB))throw Error('96GiB new storage plus48GiB host reserve cannot fit.');
  const mem=String(await readFile('/proc/meminfo','utf8'));if(Number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(mem)?.[1]||0)*1024<6*GIB)throw Error('One2GiB QA runtime plus4GiB host reserve cannot fit.');
  const env={PATH:'/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin',LANG:'C',LC_ALL:'C',LD_LIBRARY_PATH:config.libraryDirectory};
  const run=(exe,params)=>execute(exe,params,{shell:false,env,timeout:30000,maxBuffer:262144});
  if(Number((await run('/usr/bin/id',['-u','ubuntu'])).stdout.trim())!==config.serviceUid||Number((await run('/usr/bin/id',['-g','ubuntu'])).stdout.trim())!==config.serviceGid)throw Error('Actual ubuntu Gateway UID/GID differs.');
  const zp=(await run(config.zpoolExecutable,['list','-H','-o','name'])).stdout.trim().split('\n');if(zp.includes('ynx-core-projects'))throw Error('Project pool already exists.');
  const pools=JSON.parse((await run('/snap/bin/lxc',['storage','list','--format','json'])).stdout);if(pools.some(row=>row.name==='ynx-core-quota'))throw Error('LXD core pool already exists.');
  const journal={status:'issued',resources:plan.resources,sourceHelperSha256:config.expectedHelperSha256,completed:[]};
  async function save(){const temporary=ROOT+'/native-install-journal.next';const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(journal,null,2));await handle.sync();}finally{await handle.close();}await rename(temporary,ROOT+'/native-install-journal.json');const directory=await open(ROOT,'r');try{await directory.sync();}finally{await directory.close();}}
  await save(); // Never retry an uncertain installation or delete failed resources.
  try{
    try{await mkdir('/var/lib/ynx-native',{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;await protectedPath('/var/lib/ynx-native',{directory:true});}
    await chmod('/var/lib/ynx-native',0o755);await mkdir(config.projectsRoot,{mode:0o755});await protectedAncestors(config.projectsRoot);
    for(const [exe,params]of plan.commands){await run(exe,params);if(exe==='/usr/bin/fallocate'){await chmod(plan.resources.projectBacking,0o600);const st=await lstat(plan.resources.projectBacking);journal.backing={inode:st.ino,bytes:st.size};}if(exe===config.zpoolExecutable){const guid=(await run(config.zpoolExecutable,['get','-H','-o','value','guid','ynx-core-projects'])).stdout.trim();if(!/^\d+$/.test(guid))throw Error('Created pool GUID unavailable; preserve resources.');journal.projectPoolGuid=guid;}journal.completed.push(params[0]);await save();}
    try{await mkdir(ROOT+'/helpers',{mode:0o755});}catch(error){if(error.code!=='EEXIST')throw error;await protectedPath(ROOT+'/helpers',{directory:true});}
    await writeFile(HELPER,await readFile(config.sourceHelperPath),{flag:'wx',mode:0o644});
    await writeFile(ZCONFIG,JSON.stringify({pool:'ynx-core-projects',projectsRoot:config.projectsRoot,serviceUid:config.serviceUid,serviceGid:config.serviceGid,maxBytes:GIB,zfsExecutable:config.zfsExecutable,libraryDirectory:config.libraryDirectory}),{flag:'wx',mode:0o644});
    const command='/usr/bin/node '+HELPER;const rule='Cmnd_Alias YNX_NATIVE_QUOTA = '+command+' *\nDefaults!YNX_NATIVE_QUOTA env_reset, !setenv, env_delete += "NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH"\nubuntu ALL=(root) NOPASSWD: YNX_NATIVE_QUOTA\n';
    const staged=ROOT+'/native-quota-sudoers.review';await writeFile(staged,rule,{flag:'wx',mode:0o440});await run('/usr/sbin/visudo',['-cf',staged]);await writeFile('/etc/sudoers.d/ynx-native-quota',rule,{flag:'wx',mode:0o440});
    journal.completed.push('helper-config-sudo-rule');journal.status='installed-not-admitted';await save();console.log(JSON.stringify({...plan,dryRun:false,mutated:true,status:journal.status}));
  }catch(error){journal.status='failed-preserve-all-resources';try{await save();}catch{}throw Error('Installation failed; preserve journal/backing/pools/config for A review. No rollback or cleanup was executed.');}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

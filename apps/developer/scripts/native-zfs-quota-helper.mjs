import { lstat, realpath, readFile, chmod, chown, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile),CONFIG='/etc/ynx-developer/native-zfs.json',MAX=1073741824;
export async function protectedPath(path,{uid=0,directory=false}={}){const stat=await lstat(path);if(stat.isSymbolicLink()||stat.uid!==uid||(stat.mode&0o022)||await realpath(path)!==path||directory&&!stat.isDirectory())throw Error('Quota path ownership or protection changed.');return stat;}
export function projectDataset(config,path){if(config.pool!=='ynx-core-projects'||config.maxBytes!==MAX||!Number.isInteger(config.serviceUid)||config.serviceUid<=0||!Number.isInteger(config.serviceGid)||config.serviceGid<=0)throw Error('Quota configuration is not the reviewed new pool policy.');const suffix=relative(config.projectsRoot,path);if(path!==resolve(path)||!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(suffix))throw Error('Only exact native owner/project paths are allowed.');return `${config.pool}/projects/${suffix.replace('/','_')}`;}
export async function protectedAncestors(path,protect=protectedPath){
  let current=resolve(path);for(;;){await protect(current,{uid:0,directory:true});if(current===dirname(current))break;current=dirname(current);}
}
export async function quotaOperation(config,action,path,{run,protect=protectedPath,setOwner=chown,setMode=chmod}={}){
  if(!['prepare','verify'].includes(action))throw Error('Quota operation is not allowed.');const dataset=projectDataset(config,path);
  // Every ancestor is immutable to the Gateway caller, including the mount slot parent.
  await protectedAncestors(config.projectsRoot,protect);
  if(action==='prepare'){try{await mkdir(dirname(path),{mode:0o711});}catch(error){if(error.code!=='EEXIST')throw error;}}
  await protect(dirname(path),{uid:0,directory:true});
  if(action==='prepare'){
    try{await lstat(path);throw Error('Existing volume is a recovery; do not overwrite.');}catch(error){if(error.code!=='ENOENT')throw error;}
    // Never -p, rollback, destroy, relimit, or overwrite a previous dataset.
    await run(['create','-o',`mountpoint=${path}`,'-o',`quota=${MAX}`,'-o',`refquota=${MAX}`,'-o','devices=off','-o','setuid=off','-o','sharenfs=off','-o','sharesmb=off',dataset]);
    // Caller cannot replace this pathname: the slot and all ancestors are root protected.
    await protect(path,{uid:0,directory:true});
    await setOwner(path,config.serviceUid,config.serviceGid);await setMode(path,0o700);
  }
  await protect(path,{uid:config.serviceUid,directory:true});
  const values=(await run(['get','-H','-p','-o','property,value,source','quota,refquota,mountpoint,readonly,canmount,devices,setuid,sharenfs,sharesmb',dataset])).stdout.trim().split('\n').map(line=>line.split('\t'));
  const props=new Map(values.map(([key,value,source])=>[key,{value,source}]));
  for(const[key,value]of Object.entries({quota:String(MAX),refquota:String(MAX),mountpoint:path,readonly:'off',canmount:'on',devices:'off',setuid:'off',sharenfs:'off',sharesmb:'off'}))if(props.get(key)?.value!==value)throw Error('ZFS quota/mount protection differs; retain data for review.');
  for(const key of ['quota','refquota','mountpoint'])if(props.get(key)?.source!=='local')throw Error('Project quota must be local and immutable to the workload.');
  const mounted=JSON.parse((await run(['@findmnt','--json','--target',path,'--output','TARGET,FSTYPE,SOURCE'])).stdout).filesystems;
  if(mounted?.length!==1||mounted[0].target!==path||mounted[0].fstype!=='zfs'||mounted[0].source!==dataset)throw Error('Exact project dataset is not mounted.');
  return{driver:'zfs-refquota',enforced:true,hardIsolation:true,directory:path,dataset,maxBytes:MAX};
}
async function main(){
  if(process.getuid()!==0)throw Error('Quota helper must run under its narrow root sudo rule.');
  for(const path of ['/etc/ynx-developer','/etc/ynx-developer/helpers',CONFIG,fileURLToPath(import.meta.url)])await protectedPath(path);
  const config=JSON.parse(await readFile(CONFIG,'utf8'));if(Number(process.env.SUDO_UID)!==config.serviceUid)throw Error('Quota helper caller is not the configured Gateway user.');
  if(Object.keys(config).sort().join()!==['pool','projectsRoot','serviceUid','serviceGid','maxBytes','zfsExecutable','libraryDirectory'].sort().join())throw Error('Unexpected quota configuration fields.');
  if(!/^\/snap\/lxd\/\d+\/zfs-2\.2\/bin\/zfs$/.test(config.zfsExecutable)||config.libraryDirectory!==join(dirname(dirname(config.zfsExecutable)),'lib'))throw Error('Use the reviewed fixed snap revision and matching2.2 library.');
  for(const path of [config.zfsExecutable,config.libraryDirectory])await protectedPath(path);
  const run=async args=>{const find=args[0]==='@findmnt';return exec(find?'/usr/bin/findmnt':config.zfsExecutable,find?args.slice(1):args,{shell:false,timeout:15000,maxBuffer:65536,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C',...(find?{}:{LD_LIBRARY_PATH:config.libraryDirectory})}});};
  const[action,path,...extra]=process.argv.slice(2);if(extra.length)throw Error('Unexpected quota helper arguments.');console.log(JSON.stringify(await quotaOperation(config,action,path,{run})));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Native quota helper failed; preserve exact volume and inspect operator prerequisites.');process.exitCode=1;});

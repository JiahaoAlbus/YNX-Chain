#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {root,verifyLease,issueLease,need,sha,parseDocument} from './lease.mjs';
export const verifierDigest=()=>sha(Buffer.concat([fs.readFileSync(new URL('./lease.mjs',import.meta.url)),Buffer.from([0]),fs.readFileSync(fileURLToPath(import.meta.url))]));
function read(p,protectedFile=false){need(typeof p==='string'&&path.isAbsolute(p),'ABSOLUTE_INPUT');const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.size<=262144,'INPUT_FILE');need(!protectedFile||(s.uid===process.getuid()&&(s.mode&0o022)===0),'TRUST_FILE_PERMISSIONS');return parseDocument(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}}
export function run(argv){const [mode,...rest]=argv;need(['doctor','verify','issue','transport-plan'].includes(mode),'COMMAND');const o={};for(let i=0;i<rest.length;i+=2){need(['--lease','--trust-root','--context','--approved-payload-sha256','--private-key-file','--output','--known-hosts','--identity-file'].includes(rest[i])&&rest[i+1]&&!Object.hasOwn(o,rest[i]),'ARGUMENTS');o[rest[i]]=rest[i+1];}
 const r=root(read(o['--trust-root']??process.env.YNX_FINANCE_RELEASE_PUBLIC_ROOT_FILE,true));
 if(mode==='doctor'&&!o['--lease']){const t=Date.now(),keys=r.keys.filter(k=>!k.revoked&&t>=Date.parse(k.notBefore)&&t<Date.parse(k.notAfter));return {status:keys.length?'CONFIGURED_NOT_AUTHORIZED':'BLOCKED_NO_PROTECTED_PUBLIC_KEY',mode:r.mode,rootVersion:r.rootVersion,activeKeyCount:keys.length,secretAccess:false,mutations:false};}
 const l=read(o['--lease']),context=o['--context']?read(o['--context']):{};need(Object.keys(context).every(k=>['host','minimumRootVersion'].includes(k)),'CONTEXT');const opts={...context,nowMs:Date.now()};
 if(mode==='issue'){
  need(o['--output']&&path.isAbsolute(o['--output'])&&!fs.existsSync(o['--output']),'EXCLUSIVE_OUTPUT');
  need(l.tooling?.verifierSha256===verifierDigest(),'VERIFIER_IDENTITY');
  const issued=issueLease(l,r,{...opts,approvedPayloadSha256:o['--approved-payload-sha256'],privateKeyFile:o['--private-key-file']??process.env.YNX_FINANCE_RELEASE_PRIVATE_KEY_FILE});
  const fd=fs.openSync(o['--output'],fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,JSON.stringify(issued,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(path.dirname(o['--output']),fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}return {status:'ISSUED_OFFLINE_NOT_CONSUMED',leaseId:issued.leaseId,digest:issued.signature.payloadSha256};
 }
 const verified=verifyLease(l,r,opts);need(verified.tooling.verifierSha256===verifierDigest(),'VERIFIER_IDENTITY');
 if(mode==='transport-plan'){
  // Known host is exactly one independently provisioned ed25519 line. No
  // ssh-keyscan or accept-new may establish trust. Nothing executes this argv.
  const p=o['--known-hosts'];need(p&&path.isAbsolute(p)&&o['--identity-file']&&path.isAbsolute(o['--identity-file']),'SSH_FILES');const st=fs.lstatSync(p);need(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o022)===0&&st.uid===process.getuid(),'KNOWN_HOSTS_PERMISSIONS');
  const lines=fs.readFileSync(p,'utf8').trim().split('\n');need(lines.length===1,'EXACT_HOST_KEY');const parts=lines[0].trim().split(/\s+/);need(parts.length===3&&parts[0]===verified.target.host&&parts[1]==='ssh-ed25519','EXACT_HOST_KEY');const raw=Buffer.from(parts[2],'base64');need(raw.toString('base64')===parts[2]&&'SHA256:'+Buffer.from(sha(raw),'hex').toString('base64').replace(/=+$/,'')===verified.target.sshHostFingerprint,'SSH_FINGERPRINT');
  return {status:'LOCALLY_VERIFIED_REMOTE_REVERIFY_REQUIRED',leaseId:verified.leaseId,argv:['ssh','-F','/dev/null','-T','-p','22','-i',o['--identity-file'],'-o','PermitLocalCommand=no','-o','ProxyCommand=none','-o','ProxyJump=none','-o','ControlMaster=no','-o','ControlPath=none','-o','ForwardAgent=no','-o','ForwardX11=no','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','HostKeyAlgorithms=ssh-ed25519','-o','GlobalKnownHostsFile=/dev/null','-o','UserKnownHostsFile='+p,'--','ubuntu@'+verified.target.host,'sudo','-n','/usr/bin/python3','/opt/ynx/finance-release-v2/executor.py','execute','--lease-id',verified.leaseId],executed:false};
 }
 return {status:'VERIFIED_NOT_CONSUMED',leaseId:verified.leaseId,digest:verified.signature.payloadSha256,rootVersion:r.rootVersion,operation:verified.operation,mode:r.mode,mutations:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const result=run(process.argv.slice(2));console.log(JSON.stringify(result));if(result.status.startsWith('BLOCKED'))process.exitCode=2;}catch(e){console.error(JSON.stringify({status:'BLOCKED',code:/^FINANCE_LEASE_[A-Z_]+$/.test(e.message)?e.message:'FINANCE_LEASE_INPUT_OR_CRYPTO',mutations:process.argv[2]==='issue'?'inspect-exclusive-output':false}));process.exitCode=1;}}

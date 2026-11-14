import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,open,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join} from 'node:path';
// Persistence for the existing workspace-cookie signing key, not Wallet/Auth
// credentials. Keep the desktop's existing 64-hex plus newline file format.
export async function loadWorkspaceSessionKey(path) {
 const directory=dirname(path);await mkdir(directory,{recursive:true,mode:0o700});
 const temporary=join(directory,`.workspace-session-${randomUUID()}.tmp`);
 const candidate=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try {await candidate.writeFile(`${randomBytes(32).toString('hex')}\n`);await candidate.sync();} finally {await candidate.close();}
 try {try {await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}}
 finally {await unlink(temporary);}
 const saved=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {const info=await saved.stat();if(!info.isFile()||info.size>128)throw Error('Workspace session key file is invalid.');
  const key=(await saved.readFile('utf8')).trim();if(!/^[a-f0-9]{64}$/.test(key))throw Error('Workspace session key is invalid.');await saved.chmod(0o600);
  const parent=await open(directory,constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}
  return key;
 } finally {await saved.close();}
}

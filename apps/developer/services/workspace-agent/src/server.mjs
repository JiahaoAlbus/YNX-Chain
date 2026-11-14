import {createServer} from 'node:http';
import {mkdir,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createWorkspaceRuntime} from './runtime.mjs';
import {createWorkspaceStore} from '../../workspace-manager/src/store.mjs';
import {loadWorkspaceSessionKey} from './session-key.mjs';

// Existing loopback workspace service: the normal entry now has the same
// durable project/admission configuration as the composed product gateway.
const port=Number(process.env.PORT??4187);
if(!Number.isInteger(port)||port<0||port>65535)throw Error('A valid local service port is required.');
const requested=resolve(process.env.YNX_CODE_STATE_DIR||join(homedir(),'.ynx-code','workspace-agent'));
await mkdir(requested,{recursive:true,mode:0o700});
const stateDir=await realpath(requested);
const sessionKey=process.env.YNX_CODE_WORKSPACE_SESSION_KEY||await loadWorkspaceSessionKey(join(stateDir,'workspace-session.key'));
if(typeof sessionKey!=='string'||Buffer.byteLength(sessionKey)<32)throw Error('Workspace session key is invalid.');
const store=createWorkspaceStore({filename:join(stateDir,'workspaces.sqlite')});
const runtime=createWorkspaceRuntime({root:join(stateDir,'tasks'),workspaceStore:store,guestAdmissionFilename:join(stateDir,'guest-admission.sqlite'),sessionKey,protectedReadRoots:[stateDir]});
const server=createServer(async(request,response)=>{
 try {if(await runtime.handler(request,response))return;response.writeHead(404,{'content-type':'application/json'}).end('{"error":"Not found"}');}
 catch {if(!response.headersSent)response.writeHead(503,{'content-type':'application/json'});if(!response.writableEnded)response.end('{"error":"Workspace service unavailable."}');}
});
server.listen(port,'127.0.0.1',()=>console.log(`YNX Code Workspace Agent http://127.0.0.1:${server.address().port}`));
let stopping=false;
function stop(){if(stopping)return;stopping=true;runtime.cancelAll();server.close(()=>{runtime.closeAdmission();store.close();});}
process.on('SIGTERM',stop);process.on('SIGINT',stop);

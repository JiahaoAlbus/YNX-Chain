import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway } from "./gateway.mjs";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";

if(process.env.NODE_ENV==="production"&&!process.env.YNX_CODE_WORKSPACE_SESSION_KEY)throw new Error("YNX_CODE_WORKSPACE_SESSION_KEY is required in production.");
const port=Number(process.env.PORT||4190),host=process.env.HOST||"127.0.0.1",staticRoot=process.env.YNX_CODE_STATIC_ROOT||fileURLToPath(new URL("../../../frontend/dist",import.meta.url)),stateDir=process.env.YNX_CODE_STATE_DIR||join(process.cwd(),".ynx-code");
mkdirSync(stateDir,{recursive:true,mode:0o700});
const workspaceStore=createWorkspaceStore({filename:join(stateDir,"workspaces.sqlite")}),runtime=createWorkspaceRuntime({workspaceStore});
const server=createServer(createGateway({staticRoot,runtime}));
server.listen(port,host,()=>console.log(`YNX Code Gateway http://${host}:${port}`));
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>server.close(()=>{workspaceStore.close();process.exit(0)}));

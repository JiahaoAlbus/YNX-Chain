import { createServer } from "node:http";
import { createWorkspaceRuntime } from "./runtime.mjs";

const port=Number(process.env.PORT||4187),runtime=createWorkspaceRuntime();
createServer(async(request,response)=>{if(await runtime.handler(request,response))return;response.writeHead(404,{"content-type":"application/json"}).end('{"error":"Not found"}')}).listen(port,"127.0.0.1",()=>console.log(`YNX Code Workspace Agent http://127.0.0.1:${port}`));

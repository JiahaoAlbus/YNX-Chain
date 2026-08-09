import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createGateway } from "./gateway.mjs";

if(process.env.NODE_ENV==="production"&&!process.env.YNX_CODE_WORKSPACE_SESSION_KEY)throw new Error("YNX_CODE_WORKSPACE_SESSION_KEY is required in production.");
const port=Number(process.env.PORT||4190),host=process.env.HOST||"127.0.0.1",staticRoot=process.env.YNX_CODE_STATIC_ROOT||fileURLToPath(new URL("../../../frontend/dist",import.meta.url));
createServer(createGateway({staticRoot})).listen(port,host,()=>console.log(`YNX Code Gateway http://${host}:${port}`));

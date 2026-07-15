import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL(".",import.meta.url));const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8"};
createServer(async(req,res)=>{const path=req.url==="/"?"index.html":req.url.slice(1);if(path.includes("..")){res.writeHead(400).end();return}try{const data=await readFile(join(root,path));res.writeHead(200,{"Content-Type":types[extname(path)]||"application/octet-stream","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'self'; connect-src 'self' http://127.0.0.1:8423; media-src 'self' blob: http://127.0.0.1:8423; style-src 'self'; script-src 'self'"});res.end(data)}catch{res.writeHead(404).end("Not found")}}).listen(Number(process.env.PORT||4173),"127.0.0.1",()=>console.log("YNX Video http://127.0.0.1:"+(process.env.PORT||4173)));

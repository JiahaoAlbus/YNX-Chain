import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const root=new URL('./',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('runtime-manifest.json',root)));
const allowed=new Set(Object.keys(manifest.files).filter(path=>!['server.mjs','package.json'].includes(path)));
allowed.add('runtime-manifest.json');
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-YNX-Source':manifest.sourceCommit,'X-YNX-Mode':'compatible-recovery','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://wallet-auth.ynxweb4.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
createServer(async(req,res)=>{
  let path;try{path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400,headers).end();return;}
  if(path==='/video')path='/';else if(path.startsWith('/video/'))path=path.slice(6);
  const entry=['/','/index.html','/wallet-auth/callback','/wallet-callback.html'].includes(path);
  const file=entry?'index.html':path.slice(1);
  if(!['GET','HEAD'].includes(req.method)||path.startsWith('/v1/')||path.startsWith('/api/')){res.writeHead(503,{...headers,'Retry-After':'300'}).end('Product actions are paused');return;}
  if(!allowed.has(file)){res.writeHead(404,headers).end('Not found');return;}
  try{const data=await readFile(new URL(file,root));res.writeHead(entry?503:200,{...headers,'Content-Type':types[file.split('.').pop()]||'application/octet-stream',...(entry?{'Retry-After':'300'}:{})});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(503,headers).end('Recovery file unavailable');}
}).listen(Number(process.env.PORT||6494),'127.0.0.1');

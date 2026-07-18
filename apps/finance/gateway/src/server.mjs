import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {FinanceWalletGateway,loadFinanceRegistry} from './gateway.mjs';

const listen=process.env.YNX_FINANCE_GATEWAY_LISTEN||'127.0.0.1:8787';
const upstream=process.env.YNX_FINANCE_UPSTREAM||'http://127.0.0.1:6436';
const internalKey=process.env.YNX_FINANCE_INTERNAL_KEY;
if(!internalKey||internalKey.length<32)throw new Error('YNX_FINANCE_INTERNAL_KEY must be at least 32 bytes');
const registryPath=fileURLToPath(new URL('../../integration/wallet-auth/registry-entry.json',import.meta.url));
const gateway=new FinanceWalletGateway({registry:await loadFinanceRegistry(registryPath),internalKey});

const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value))};
const body=async req=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>128*1024)throw new Error('request body too large');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')};
const bearer=req=>{const value=req.headers.authorization||'';if(!value.startsWith('Bearer '))throw new Error('bearer session required');return value.slice(7)};

const server=http.createServer(async(req,res)=>{try{
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,service:'ynx-finance-edge-gateway',version:'1.0.0',walletAuth:'canonical-v1',registrySchema:2,productClientId:'ynx-finance-v1'});
  if(req.method==='POST'&&req.url==='/wallet-auth/sessions')return json(res,201,gateway.begin(await body(req)));
  if(req.method==='POST'&&req.url==='/wallet-auth/sessions/complete')return json(res,201,gateway.complete(await body(req)));
  if(req.method==='POST'&&req.url==='/wallet-auth/introspect'){
    if(req.headers['x-ynx-finance-internal-key']!==internalKey)return json(res,403,{error:'internal authentication failed'});
    return json(res,200,gateway.introspect(bearer(req)));
  }
  if(req.method==='POST'&&req.url==='/wallet-auth/revoke'){
    if(req.headers['x-ynx-finance-internal-key']!==internalKey)return json(res,403,{error:'internal authentication failed'});
    gateway.revoke(bearer(req));res.writeHead(204);return res.end();
  }
  const target=new URL(req.url,upstream),headers={...req.headers};delete headers.host;
  const proxy=http.request(target,{method:req.method,headers},upstreamResponse=>{res.writeHead(upstreamResponse.statusCode||502,upstreamResponse.headers);upstreamResponse.pipe(res)});
  proxy.on('error',error=>json(res,502,{error:`Finance upstream unavailable: ${error.message}`}));req.pipe(proxy);
}catch(error){json(res,400,{error:error instanceof Error?error.message:String(error)})}});
const [host,port]=listen.split(':');server.listen(Number(port),host,()=>console.log(`YNX Finance edge gateway listening on ${listen}`));

import http from 'node:http';
import {FinanceWalletGatewayProxy} from './gateway.mjs';

const listen=process.env.YNX_FINANCE_GATEWAY_LISTEN||'127.0.0.1:8787',upstream=process.env.YNX_WALLET_GATEWAY_URL;
if(!upstream)throw new Error('YNX_WALLET_GATEWAY_URL is required');
const gateway=new FinanceWalletGatewayProxy({baseURL:upstream});
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value))};
const body=async req=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64*1024)throw new Error('request body too large');chunks.push(chunk)}const value=Buffer.concat(chunks).toString('utf8');JSON.parse(value);return value};
const routes=new Map([['/wallet-gateway/v1/wallet/sessions/complete','/v1/wallet/sessions/complete'],['/wallet-gateway/v1/wallet/sessions/revoke','/v1/wallet/sessions/revoke']]);
const server=http.createServer(async(req,res)=>{try{
  if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,service:'ynx-finance-wallet-proxy',version:'2.0.0',walletAuth:'canonical-product-proof',state:'none'});
  const route=routes.get(req.url||'');if(req.method!=='POST'||!route)return json(res,404,{ok:false,error:'route not found'});
  const result=await gateway.forward(route,await body(req),String(req.headers['x-ynx-product-session-proof']||''));
  res.writeHead(result.status,{'content-type':result.contentType,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(result.body);
}catch(error){json(res,400,{ok:false,error:error instanceof Error?error.message:'request rejected'})}});
const [host,port]=listen.split(':');server.listen(Number(port),host,()=>console.log(`YNX Finance Wallet proxy listening on ${listen}`));

const ROUTES=new Set(['/v1/wallet/sessions/complete','/v1/wallet/sessions/revoke']);

export class FinanceWalletGatewayProxy{
  constructor({baseURL,fetchImpl=fetch}){
    const parsed=new URL(baseURL);
    const loopback=parsed.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(parsed.hostname);
    if((parsed.protocol!=='https:'&&!loopback)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new Error('YNX_WALLET_GATEWAY_URL must be an HTTPS origin or loopback HTTP development origin');
    this.baseURL=parsed.origin;this.fetch=fetchImpl;
  }
  async forward(path,body,proof=''){
    if(!ROUTES.has(path))throw new Error('Finance Gateway route is not allowed');
    if(typeof body!=='string'||Buffer.byteLength(body)<2||Buffer.byteLength(body)>64*1024)throw new Error('Finance Gateway body is outside policy');
    if(path.endsWith('/revoke')&&(typeof proof!=='string'||proof.length<1||proof.length>8192))throw new Error('Canonical Product Session proof is required');
    const headers={'content-type':'application/json','accept':'application/json'};
    if(proof)headers['x-ynx-product-session-proof']=proof;
    const response=await this.fetch(this.baseURL+path,{method:'POST',headers,body,redirect:'error'});
    const result=await response.text();
    if(Buffer.byteLength(result)>64*1024)throw new Error('Canonical Wallet Gateway response is outside policy');
    return{status:response.status,body:result,contentType:response.headers.get('content-type')||'application/json; charset=utf-8'};
  }
}

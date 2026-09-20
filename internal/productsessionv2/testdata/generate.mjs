// Offline interoperability vector. Only fixed, disposable test keys are used.
// Usage: node generate.mjs /absolute/path/to/packages/wallet-auth
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2]);
const sdk = await import(pathToFileURL(`${root}/src/index.js`));
const { p256 } = await import(pathToFileURL(`${root}/node_modules/@noble/curves/nist.js`));
const registry = JSON.parse(readFileSync(`${root}/product-session-registry.json`));
const now = new Date('2026-09-12T09:00:00.000Z');
const secret = Buffer.alloc(32,19), deviceKey=Buffer.from(p256.getPublicKey(secret,true)).toString('base64url');
const token = x=>createHash('sha256').update(x).digest('base64url');
const handler=new sdk.ProductSessionGatewayHttpHandler(registry,()=>token('go-introspection-challenge'));
const call=(requestId,path,body,proofHeader=null)=>handler.handle({requestId,method:'POST',path,contentType:'application/json',body:sdk.canonicalJSON(body),proofHeader,networkAvailable:true},now);
const request=sdk.createProductSessionRequest(registry,{productId:'finance',platform:'web',deviceId:'go-interop-device-001',deviceKey,scopes:['finance.pay.read','finance.portfolio.read'],purpose:'Offline Go interoperability fixture',nonce:token('go-nonce'),state:token('go-state')},now);
const approval=sdk.signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:'2026-09-12T09:03:00.000Z'},now);
const challenge=JSON.parse(call('req_go_challenge_0001','/v2/product-sessions/challenge',{request,approval}).body).result;
const completion=sdk.signProductSessionChallenge(challenge,secret.toString('base64url'));
const session=JSON.parse(call('req_go_complete_00001','/v2/product-sessions/complete',{request,approval,completion}).body).result;
const requiredScopes=['finance.pay.read'];
const proof=sdk.createProductSessionProofV2(session,{method:'POST',path:'/v2/product-sessions/introspect',bodyDigest:sdk.httpBodyDigest(sdk.canonicalJSON({requiredScopes})),nonce:token('go-proof'),issuedAt:now.toISOString(),expiresAt:'2026-09-12T09:00:30.000Z'},secret.toString('base64url'));
const proofHeader=sdk.encodeProductSessionGatewayProofHeaderV2(proof);
const response=call('req_go_introspect_001','/v2/product-sessions/introspect',{requiredScopes},proofHeader);
if(response.status!==200)throw new Error(response.body);
const replay=call('req_go_replay_000001','/v2/product-sessions/introspect',{requiredScopes},proofHeader);
if(replay.status!==409)throw new Error('Authority did not reject consumed proof');
writeFileSync(new URL('finance-v2.json',import.meta.url),JSON.stringify({sourceCommit:'673522fe126b5b87f91c6790ca7bea0eb574f2e8',now:now.toISOString(),requiredScopes,proofHeader,proof,session,response,replay},null,2)+'\n');

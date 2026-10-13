import {createHash,createPrivateKey,createPublicKey,sign,timingSafeEqual} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,lstatSync,readFileSync} from 'node:fs';
import {isAbsolute,dirname} from 'node:path';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {CENTRAL_BROWSER_ISSUER} from './central-browser-session-registry.js';
export const CENTRAL_OIDC_PROTOCOL='ynx-central-oidc-code/v1';
export const CENTRAL_OIDC_ROUTES=Object.freeze(['/.well-known/openid-configuration','/oidc/jwks','/oidc/authorize','/oidc/token','/oidc/userinfo']);
const fail=code=>{throw new WalletAuthError(code,'Central OpenID authorization failed closed');};
const digest=value=>createHash('sha256').update(value).digest();
const bounded=value=>typeof value==='string'&&/^[A-Za-z0-9._~-]{16,256}$/.test(value);
const verifier=value=>typeof value==='string'&&/^[A-Za-z0-9._~-]{43,128}$/.test(value);
const secret=value=>typeof value==='string'&&/^[\x21-\x7e]{32,256}$/.test(value);
export function createCentralOIDCProvider(config=null){
 if(config===null)return null;
 exactFields(config,['clientId','redirectUri','clientSecret','signingKey','keyId'],'Central OIDC provider');
 if(typeof config.clientId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(config.clientId)||!secret(config.clientSecret)||typeof config.keyId!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(config.keyId))fail('OIDC_CONFIG_INVALID');
 let redirect,key;
 try{redirect=new URL(config.redirectUri);key=createPrivateKey(config.signingKey);}catch{fail('OIDC_CONFIG_INVALID');}
 if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.port||redirect.search||redirect.hash||redirect.href!==config.redirectUri||!redirect.pathname.endsWith('/_synapse/client/oidc/callback')||redirect.pathname.includes('//')||redirect.origin===CENTRAL_BROWSER_ISSUER||key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048)fail('OIDC_CONFIG_INVALID');
 const clientId=config.clientId,redirectUri=config.redirectUri,secretHash=digest(config.clientSecret),keyId=config.keyId;
 const jwk=Object.freeze({...createPublicKey(key).export({format:'jwk'}),kid:keyId,use:'sig',alg:'RS256'});
 const request=input=>{
  exactFields(input,['client_id','redirect_uri','response_type','scope','state','nonce','code_challenge','code_challenge_method',...(Object.hasOwn(input??{},'prompt')?['prompt']:[]),...(Object.hasOwn(input??{},'max_age')?['max_age']:[])],'OIDC authorization request');
  if(input.client_id!==clientId||input.redirect_uri!==redirectUri)fail('OIDC_CLIENT_INVALID');
  const scopes=typeof input.scope==='string'?input.scope.split(' '):[];
  if(input.response_type!=='code'||!scopes.includes('openid')||scopes.some(s=>!['openid','profile'].includes(s))||new Set(scopes).size!==scopes.length||!bounded(input.state)||!bounded(input.nonce)||typeof input.code_challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge)||input.code_challenge_method!=='S256'||input.prompt!==undefined&&!['none','login'].includes(input.prompt)||input.max_age!==undefined&&(!/^(0|[1-9][0-9]{0,3})$/.test(input.max_age)||Number(input.max_age)>7200))fail('OIDC_REQUEST_INVALID');
  return Object.freeze({...input,scope:[...scopes].sort().join(' ')});
 };
 const authenticate=headers=>{
  if(headers.origin!==undefined||headers.cookie!==undefined||headers['sec-fetch-site']!==undefined)fail('OIDC_BACKEND_ONLY');
  const value=headers.authorization;
  if(typeof value!=='string'||value.length>2048||!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(value))fail('OIDC_CLIENT_AUTH_INVALID');
  const encoded=value.slice(6),bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)fail('OIDC_CLIENT_AUTH_INVALID');
  const decoded=bytes.toString('utf8'),split=decoded.indexOf(':');if(split<0)fail('OIDC_CLIENT_AUTH_INVALID');
  let id,credential;try{id=decodeURIComponent(decoded.slice(0,split).replaceAll('+',' '));credential=decodeURIComponent(decoded.slice(split+1).replaceAll('+',' '));}catch{fail('OIDC_CLIENT_AUTH_INVALID');}
  if(id!==clientId||!secret(credential)||!timingSafeEqual(digest(credential),secretHash))fail('OIDC_CLIENT_AUTH_INVALID');
 };
 return Object.freeze({clientId,redirectUri,request,authenticate,
  metadata:()=>({issuer:CENTRAL_BROWSER_ISSUER,authorization_endpoint:CENTRAL_BROWSER_ISSUER+'/oidc/authorize',token_endpoint:CENTRAL_BROWSER_ISSUER+'/oidc/token',userinfo_endpoint:CENTRAL_BROWSER_ISSUER+'/oidc/userinfo',jwks_uri:CENTRAL_BROWSER_ISSUER+'/oidc/jwks',response_types_supported:['code'],grant_types_supported:['authorization_code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],code_challenge_methods_supported:['S256'],scopes_supported:['openid','profile'],claims_supported:['iss','sub','aud','exp','iat','auth_time','nonce','sid','ynx_account','ynx_generation']}),
  jwks:()=>({keys:[{...jwk}]}),
  loginState:input=>createHash('sha256').update(canonicalJSON(request(input))).digest('base64url'),
  codeInput:input=>{
   exactFields(input,['grant_type','code','redirect_uri','code_verifier',...(Object.hasOwn(input??{},'client_id')?['client_id']:[])],'OIDC code redemption');
   if(input.grant_type!=='authorization_code'||input.redirect_uri!==redirectUri||input.client_id!==undefined&&input.client_id!==clientId||typeof input.code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.code)||!verifier(input.code_verifier))fail('OIDC_CODE_INVALID');return input;
  },
  signIdentity:claims=>{
   const head=Buffer.from(canonicalJSON({alg:'RS256',kid:keyId,typ:'JWT'})).toString('base64url'),payload=Buffer.from(canonicalJSON(claims)).toString('base64url'),input=head+'.'+payload;
   return input+'.'+sign('RSA-SHA256',Buffer.from(input),key).toString('base64url');
  },
 });
}
// Default off. Operator-protected values never enter client bundles or diagnostics.
export function loadCentralOIDCConfiguration(path){
 if(!path)return null;
 const read=(file,limit)=>{
  if(typeof file!=='string'||!isAbsolute(file)||file==='/')fail('OIDC_CONFIG_INVALID');
  let parent=dirname(file);while(true){const st=lstatSync(parent);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o022)!==0||typeof process.getuid==='function'&&![0,process.getuid()].includes(st.uid))fail('OIDC_CONFIG_INVALID');if(parent==='/')break;parent=dirname(parent);}
  const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const st=fstatSync(fd),fresh=lstatSync(file);if(!st.isFile()||st.nlink!==1||(st.mode&0o077)!==0||typeof process.getuid==='function'&&st.uid!==process.getuid()||st.size>limit||fresh.dev!==st.dev||fresh.ino!==st.ino)fail('OIDC_CONFIG_INVALID');return readFileSync(fd,'utf8');}finally{closeSync(fd)}
 };
 try{
  const config=JSON.parse(read(path,16384));exactFields(config,['schemaVersion','clientId','redirectUri','clientSecretFile','signingKeyFile','keyId'],'Protected OIDC configuration');if(config.schemaVersion!=='ynx-central-oidc-rp/v1')fail('OIDC_CONFIG_INVALID');
  const result={clientId:config.clientId,redirectUri:config.redirectUri,clientSecret:read(config.clientSecretFile,256),signingKey:read(config.signingKeyFile,16384),keyId:config.keyId};createCentralOIDCProvider(result);return result;
 }catch{fail('OIDC_CONFIG_INVALID');}
}

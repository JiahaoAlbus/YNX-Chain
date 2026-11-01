import {openSync,closeSync,fstatSync,lstatSync,readFileSync,constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash,createPublicKey,verify,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {CENTRAL_BROWSER_ISSUER} from './central-browser-session-registry.js';
const fail=code=>{throw new WalletAuthError(code,'Confidential client request failed closed')};
export const backendBodyDigest=value=>createHash('sha256').update(canonicalJSON(value)).digest('hex');
export function createCentralBackendVerifier(clients=[]){
 if(!Array.isArray(clients)||clients.length>32)fail('SSO_BACKEND_CONFIG_INVALID');
 const keys=new Map();for(const c of clients){exactFields(c,['clientId','keyId','publicKey'],'Confidential client');if(typeof c.clientId!=='string'||typeof c.keyId!=='string'||keys.has(c.clientId))fail('SSO_BACKEND_CONFIG_INVALID');const key=createPublicKey(c.publicKey);if(key.asymmetricKeyType!=='ed25519')fail('SSO_BACKEND_CONFIG_INVALID');keys.set(c.clientId,{...c,key});}
 return (path,input,proof,now)=>{
  if(!proof||typeof proof!=='object'||Array.isArray(proof))fail('SSO_BACKEND_AUTH_REQUIRED');
  exactFields(proof,['version','issuer','audience','clientId','keyId','method','path','bodySha256','issuedAt','nonce','signature'],'Confidential client proof');
  const key=keys.get(input.clientId),at=Date.parse(proof.issuedAt);
  if(!key||proof.version!==1||proof.issuer!==CENTRAL_BROWSER_ISSUER||proof.audience!==CENTRAL_BROWSER_ISSUER+'/v2/browser-sessions'||proof.clientId!==input.clientId||proof.keyId!==key.keyId||proof.method!=='POST'||proof.path!==path||proof.bodySha256!==backendBodyDigest(input)||!Number.isFinite(at)||new Date(at).toISOString()!==proof.issuedAt||Math.abs(now-at)>30000||typeof proof.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof.nonce)||typeof proof.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(proof.signature))fail('SSO_BACKEND_AUTH_INVALID');
  const {signature,...signed}=proof;let ok=false;try{ok=verify(null,Buffer.from(canonicalJSON(signed)),key.key,Buffer.from(signature,'base64url'))}catch{}if(!ok)fail('SSO_BACKEND_AUTH_INVALID');
  return {clientId:input.clientId,nonceHash:backendBodyDigest(proof.nonce),digest:backendBodyDigest(signed),expiresAt:at+30000};
 };
}
export function createCentralFamilySeal(key){
 if(key===null||key===undefined)return null;if(!Buffer.isBuffer(key)||key.length!==32)fail('SSO_BACKEND_SEAL_INVALID');const secret=Buffer.from(key);
 return {seal(value,binding){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',secret,iv);c.setAAD(Buffer.from(binding));const ciphertext=Buffer.concat([c.update(canonicalJSON(value)),c.final()]);return {iv:iv.toString('base64url'),tag:c.getAuthTag().toString('base64url'),ciphertext:ciphertext.toString('base64url')}},open(record,binding){try{exactFields(record,['iv','tag','ciphertext'],'Family retry seal');const d=createDecipheriv('aes-256-gcm',secret,Buffer.from(record.iv,'base64url'));d.setAAD(Buffer.from(binding));d.setAuthTag(Buffer.from(record.tag,'base64url'));return JSON.parse(Buffer.concat([d.update(Buffer.from(record.ciphertext,'base64url')),d.final()]).toString('utf8'))}catch{fail('SSO_BACKEND_RETRY_INVALID')}}};
}

// Operator-provisioned credentials only. Missing configuration leaves the new
// confidential routes unavailable; it never falls back to browser headers.
export function loadCentralBackendConfiguration(file){
 if(!file)return {};if(typeof file!=='string'||!isAbsolute(file))fail('SSO_BACKEND_CONFIG_INVALID');
 const protectedBytes=(path,limit)=>{if(typeof path!=='string'||!isAbsolute(path))fail('SSO_BACKEND_CONFIG_INVALID');const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const st=fstatSync(fd),fresh=lstatSync(path);if(!st.isFile()||st.nlink!==1||(st.mode&0o077)||typeof process.getuid==='function'&&st.uid!==process.getuid()||st.size>limit||fresh.dev!==st.dev||fresh.ino!==st.ino)fail('SSO_BACKEND_CONFIG_INVALID');return readFileSync(fd)}finally{closeSync(fd)}};
 let config;try{config=JSON.parse(protectedBytes(file,32768).toString('utf8'))}catch(e){if(e instanceof WalletAuthError)throw e;fail('SSO_BACKEND_CONFIG_INVALID')}
 exactFields(config,['schemaVersion','clients','familySealKeyFile'],'Confidential client configuration');if(config.schemaVersion!=='ynx-central-backend-clients/v1')fail('SSO_BACKEND_CONFIG_INVALID');const key=protectedBytes(config.familySealKeyFile,32);if(key.length!==32)fail('SSO_BACKEND_SEAL_INVALID');createCentralBackendVerifier(config.clients);return {backendClients:config.clients,familySealKey:key};
}

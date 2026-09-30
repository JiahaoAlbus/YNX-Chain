import {canonicalJSON,exactFields,WalletAuthError} from "./canonical.js";
import {CENTRAL_BROWSER_ISSUER,centralBrowserClient} from "./central-browser-session-registry.js";
export {CENTRAL_BROWSER_ISSUER} from "./central-browser-session-registry.js";
export const CENTRAL_BROWSER_PURPOSE='Sign in to registered YNX official apps in this browser. Identity only; no automatic signing, transfers or sensitive product scopes.';
export const CENTRAL_BROWSER_RPC_METHOD='ynx_requestCentralBrowserSignIn';
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
export function centralBrowserConsentSignBytes(challenge,account,accountPublicKey){
  return `YNX Central Browser Sign-In v1\n${canonicalJSON({challenge,account,accountPublicKey})}`;
}
export function parseCentralBrowserSignInChallenge(challenge,registry,{peerOrigin,now=Date.now()}={}){
  exactFields(challenge,['version','issuer','purpose','challengeId','browserBinding','nonce','initiator','clients','issuedAt','expiresAt'],'Central browser challenge');
  if(challenge.version!==1||challenge.issuer!==CENTRAL_BROWSER_ISSUER||peerOrigin!==CENTRAL_BROWSER_ISSUER||challenge.purpose!==CENTRAL_BROWSER_PURPOSE||!token(challenge.challengeId)||!token(challenge.nonce)||typeof challenge.browserBinding!=='string'||!/^[a-f0-9]{64}$/.test(challenge.browserBinding))fail('SSO_CHALLENGE_INVALID');
  const initiator=challenge.initiator;
  exactFields(initiator,['clientId','origin','redirectUri','state','codeChallenge','codeChallengeMethod'],'Central browser initiator');
  centralBrowserClient(registry,{clientId:initiator.clientId,origin:initiator.origin,redirectUri:initiator.redirectUri});
  if(!token(initiator.state)||!token(initiator.codeChallenge)||initiator.codeChallengeMethod!=='S256')fail('SSO_TRANSACTION_INVALID');
  const clients=registry.map(value=>({clientId:value.clientId,origin:value.origin,audience:value.audience,scopes:[...value.scopes]})).sort((a,b)=>a.clientId.localeCompare(b.clientId));
  if(canonicalJSON(challenge.clients)!==canonicalJSON(clients))fail('SSO_CLIENTS_MISMATCH');
  const issued=Date.parse(challenge.issuedAt),expires=Date.parse(challenge.expiresAt);
  if(!Number.isSafeInteger(now)||!Number.isFinite(issued)||!Number.isFinite(expires)||new Date(issued).toISOString()!==challenge.issuedAt||new Date(expires).toISOString()!==challenge.expiresAt||issued>now+30000||expires<=now||expires<=issued||expires-issued>120000)fail('SSO_CHALLENGE_EXPIRED');
  return Object.freeze(structuredClone(challenge));
}
export function parseCentralBrowserSignInApproval(approval){
  exactFields(approval,['challengeId','account','accountPublicKey','walletSignature'],'Central browser approval');
  if(!token(approval.challengeId)||typeof approval.account!=='string'||!/^ynx1[a-z0-9]{38}$/.test(approval.account)||typeof approval.accountPublicKey!=='string'||!/^0[23][a-f0-9]{64}$/.test(approval.accountPublicKey)||typeof approval.walletSignature!=='string'||!/^([a-f0-9]{128})$/.test(approval.walletSignature))fail('SSO_SIGNATURE_INVALID');
  return Object.freeze({...approval});
}
function fail(code){throw new WalletAuthError(code,"Central browser sign-in contract was rejected");}


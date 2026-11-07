// Independently reviewed protected narrowing ORIGINAL. This DATA never mints
// a LINK registeredServer, authenticates an HTTP request, or authorizes a grant.
import{canonicalJSON}from'./canonical.js';
export const ORIGINAL_DESKTOP_GRANT_ROUTES=Object.freeze([
 ['POST','/internal/auth/task-grants/issue','issue'],
 ['POST','/internal/auth/task-grants/effect','effect'],
 ['POST','/internal/auth/task-grants/query','query-grant'],
 ['POST','/internal/auth/task-grants/effect-query','query-effect'],
 ['POST','/internal/auth/task-grants/effect-reconcile','reconcile-effect'],
 ['POST','/internal/auth/task-grants/revoke','revoke'],
 ['POST','/internal/auth/task-grants/management','management']
].map(x=>Object.freeze(x)));
const fail=c=>{throw Object.assign(Error(c),{code:c})};
export function inspectOriginalDesktopCallerResourceDATA(raw,scope){
 const value=JSON.parse(raw);if(canonicalJSON(value)!==raw||Object.keys(value).sort().join('|')!==['version','authority','realm','tenant','account','service','origin','localSAN','peer','actions','observedAt','expires'].sort().join('|'))fail('DESKTOP_CALLER_RESOURCE_SCHEMA');
 if(value.version!=='AUTH-ORIGINAL-INBOUND-SCOPE/private-v1'||value.authority!==scope.authorityRef.id||value.realm!==scope.realm||value.tenant!==scope.tenant||value.account!==scope.issuerAccount)fail('DESKTOP_CALLER_SAME_SOURCE');
 for(const k of['service','origin','localSAN'])if(typeof value[k]!=='string'||!value[k]||value[k].length>512||/[\x00-\x1f]/.test(value[k]))fail('DESKTOP_CALLER_RESOURCE_TEXT');
 const origin=new URL(value.origin);if(origin.protocol!=='https:'||origin.origin!==value.origin||origin.username||origin.password)fail('DESKTOP_CALLER_RESOURCE_ORIGIN');
 const peer=value.peer;if(!peer||Object.keys(peer).sort().join('|')!==['ServiceID','SubjectAltName','CertDigest','RootDigest','Edge','Epoch','Expires'].sort().join('|'))fail('DESKTOP_CALLER_RESOURCE_PEER');
 for(const k of['ServiceID','SubjectAltName','Edge'])if(typeof peer[k]!=='string'||!peer[k]||peer[k].length>512||/[\x00-\x1f]/.test(peer[k]))fail('DESKTOP_CALLER_RESOURCE_PEER');
 for(const k of['CertDigest','RootDigest'])if(!/^[0-9a-f]{64}$/.test(peer[k]))fail('DESKTOP_CALLER_RESOURCE_PEER');
 for(const n of[value.observedAt,value.expires,peer.Epoch,peer.Expires])if(typeof n!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(n)||BigInt(n)>BigInt(Number.MAX_SAFE_INTEGER))fail('DESKTOP_CALLER_RESOURCE_WINDOW');
 if(BigInt(peer.Epoch)<1n||BigInt(value.expires)<=BigInt(Date.now())||BigInt(value.observedAt)>BigInt(Date.now())||BigInt(peer.Expires)<BigInt(value.expires)||BigInt(value.expires)>BigInt(scope.expiresMS))fail('DESKTOP_CALLER_RESOURCE_WINDOW');
 const allowed=new Set(ORIGINAL_DESKTOP_GRANT_ROUTES.map(x=>x[2]));if(!Array.isArray(value.actions)||!value.actions.length||new Set(value.actions).size!==value.actions.length||value.actions.some(x=>!allowed.has(x)))fail('DESKTOP_CALLER_RESOURCE_ACTION');
 return structuredClone(value);
}

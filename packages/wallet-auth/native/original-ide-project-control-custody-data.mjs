// Root-signed CONTROL selection interpretation only. No key lookup or grant.
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
import{inspectPQAuthorizationView}from'../src/pq-wallet-policy.js';
const fail=()=>{throw Object.assign(Error('IDE_CONTROL_CUSTODY_NOT_ADMITTED'),{code:'IDE_CONTROL_CUSTODY_NOT_ADMITTED'})};
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail()}
function bytes(v,n){if(typeof v!=='string'||!v.length||!/^[A-Za-z0-9_-]+$/.test(v)||v.length>Math.ceil(n*4/3))fail();const b=Buffer.from(v,'base64url');if(b.length!==n||b.toString('base64url')!==v)fail();return b}
export function inspectOriginalProjectControlCustodyDATA(c,network,subject,registeredSubject,profileIssued,profileExpires,at){
 exact(c,['version','purpose','keyRole','owner','keyVersion','pkA','pkB','keychainAccount','expiresAtMs']);
 if(c.version!=='YNX-IDE-PROJECT-CONTROL-CUSTODY/v1'||c.purpose!=='IDE-PROJECT-CONTROL'||c.keyRole!=='ide-project-control-consent'||c.owner!==subject||typeof network!=='string'||!/^[a-f0-9]{64}$/.test(network)||typeof c.keyVersion!=='string'||!/^[1-9][0-9]*$/.test(c.keyVersion)||BigInt(c.keyVersion)>18446744073709551615n||typeof c.expiresAtMs!=='string'||!/^[1-9][0-9]*$/.test(c.expiresAtMs)||BigInt(c.expiresAtMs)>9007199254740991n)fail();
 const a=bytes(c.pkA,2592),b=bytes(c.pkB,64),v=inspectPQAuthorizationView(registeredSubject),r=v.activeRecord;
 if(!r||!v.pqSigningEnabled||registeredSubject.owner!==subject||registeredSubject.networkId!==network||r.revision!==c.keyVersion||!a.equals(Buffer.from(r.pkA,'hex'))||!b.equals(Buffer.from(r.pkB,'hex'))||!Number.isSafeInteger(at)||at<profileIssued||BigInt(at)>=BigInt(c.expiresAtMs)||BigInt(c.expiresAtMs)>BigInt(profileExpires))fail();
 // Local item address, NOT an authority reference or signing frame. Service is
 // fixed in the Native reader; no caller-selected keychain/path is accepted.
 const address=sha(canonical({version:c.version,purpose:c.purpose,keyRole:c.keyRole,networkId:network,owner:c.owner,keyVersion:c.keyVersion,pkA:c.pkA,pkB:c.pkB}));
 if(c.keychainAccount!==address)fail();return Object.freeze({keychainAccount:address,owner:c.owner,keyVersion:c.keyVersion,expiresAtMs:Number(c.expiresAtMs),dataOnly:true,protectedCustodyAcquired:false,authorized:false});
}

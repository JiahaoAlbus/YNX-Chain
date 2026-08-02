import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
  OneTimeNonceStore,
  assertCentralWalletSessionActive,
  createGatewayChallenge,
  parseCentralRegistryEntry,
  requestDigest,
  verifyAuthorization,
  verifyCentralWalletSession,
  parseAuthorizationRequest,
  registryParserBinding,
} from '@ynx-chain/wallet-auth';

const token=()=>randomBytes(32).toString('base64url');

export class FinanceWalletGateway {
  constructor({registry,internalKey,now=()=>new Date()}) {
    this.registry=parseCentralRegistryEntry(registry);
    this.internalKey=internalKey;
    this.now=now;
    this.pending=new Map();
    this.sessions=new Map();
    this.nonces=new OneTimeNonceStore();
    this.revokedSessionBindings=[];
    this.revokedRequestDigests=[];
  }

  begin(input) {
    const at=this.now();
    const authorizationRequest=parseAuthorizationRequest(input.authorizationRequest,{now:at,registry:registryParserBinding(this.registry)});
    const walletApproval=verifyAuthorization(input.walletApproval,{...authorizationRequest,requestDigest:requestDigest(authorizationRequest),now:at});
    const challenge=createGatewayChallenge(walletApproval,{challenge:token(),expiresAt:new Date(Math.min(Date.parse(walletApproval.expiresAt),at.getTime()+90_000)).toISOString()},at);
    this.pending.set(walletApproval.requestDigest,{authorizationRequest,walletApproval,challenge});
    return challenge;
  }

  complete(input) {
    const digest=input?.walletApproval?.requestDigest;
    const pending=this.pending.get(digest);
    if(!pending) throw new Error('unknown or consumed Wallet approval');
    if(JSON.stringify(input.authorizationRequest)!==JSON.stringify(pending.authorizationRequest)||JSON.stringify(input.walletApproval)!==JSON.stringify(pending.walletApproval)||JSON.stringify(input.gatewayCompletion?.challenge)!==JSON.stringify(pending.challenge)) throw new Error('Wallet completion binding mismatch');
    const at=this.now();
    const session=verifyCentralWalletSession({registryEntry:this.registry,authorizationRequest:pending.authorizationRequest,walletApproval:pending.walletApproval,gatewayCompletion:input.gatewayCompletion},at);
    this.nonces.consume(pending.authorizationRequest,at);
    this.pending.delete(digest);
    const accessToken=token();
    this.sessions.set(accessToken,session);
    return {token:accessToken,tokenType:'Bearer',expiresAt:session.expiresAt,account:session.account,scopes:session.scopes,sessionBinding:session.sessionBinding};
  }

  introspect(accessToken) {
    const value=this.sessions.get(accessToken);
    if(!value) throw new Error('central session is missing');
    return assertCentralWalletSessionActive(value,{revokedSessionBindings:this.revokedSessionBindings,revokedRequestDigests:this.revokedRequestDigests},this.now());
  }

  revoke(accessToken) {
    const value=this.sessions.get(accessToken);
    if(value&&!this.revokedSessionBindings.includes(value.sessionBinding))this.revokedSessionBindings.push(value.sessionBinding);
    this.sessions.delete(accessToken);
  }
}

export async function loadFinanceRegistry(path) {
  return parseCentralRegistryEntry(JSON.parse(await readFile(path,'utf8')));
}

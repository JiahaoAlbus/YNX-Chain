import registry from "../vendor/product-session-registry-123016847.json" with {type:"json"};
import {walletIdentity} from "@ynx-chain/wallet-auth";
import {SigningKey,sha256,toUtf8Bytes} from "ethers";
import {CENTRAL_BROWSER_RPC_METHOD,parseCentralBrowserSignInChallenge,parseCentralBrowserSignInApproval,centralBrowserConsentSignBytes} from "@ynx-chain/wallet-auth/central-browser-session-contract";
import {createCentralBrowserSessionRegistry} from "@ynx-chain/wallet-auth/central-browser-session-registry";
const clients=createCentralBrowserSessionRegistry(registry);
export const CENTRAL_METHOD=CENTRAL_BROWSER_RPC_METHOD;
export function parseCentralRequest(params,origin,now=Date.now()){
  if(!Array.isArray(params)||params.length!==1)throw Object.assign(new Error("Expected one central sign-in challenge."),{code:"SSO_CHALLENGE_INVALID"});
  return parseCentralBrowserSignInChallenge(params[0],clients,{peerOrigin:origin,now});
}
export function signCentralApproval(challenge,origin,secret,now=Date.now()){
  const checked=parseCentralRequest([challenge],origin,now),identity=walletIdentity(secret);
  const signature=new SigningKey(`0x${secret}`).sign(sha256(toUtf8Bytes(centralBrowserConsentSignBytes(checked,identity.account,identity.accountPublicKey))));
  return parseCentralBrowserSignInApproval({challengeId:checked.challengeId,...identity,walletSignature:signature.r.slice(2)+signature.s.slice(2)});
}

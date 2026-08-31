export const STANDARD_WALLET_CONNECT_AUTHORITY = Object.freeze({
  sourceCommit:"98c6d5d784d212df8981a53b17118a511e246ad2",
  sourceBlob:"60879be26a4b4760dea53b38f76872045c421202",
  sourceSha256:"72558116f22625c6e9abf363b9dd16a7b1b80c93d88099be531cb63e70a62b92",
});
export const STANDARD_WALLET_CHAIN_ID="0x1917";
export const STANDARD_WALLET_RPC_PROBE_TRANSPORT="accepted-cors-safe";
export const STANDARD_WALLET_PRIVATE_SERVICE=Object.freeze({NOT_REQUESTED:"not-requested",READY:"ready",DEGRADED:"degraded"});
export const STANDARD_WALLET_CONNECT_STATUS=Object.freeze({IDLE:"idle",DISCOVERING:"discovering",AWAITING_ACCOUNT:"awaiting-account",SWITCHING_CHAIN:"switching-chain",CONNECTED:"connected",WRONG_CHAIN:"wrong-chain",DISCONNECTED:"disconnected",FAILED:"failed"});
const EMPTY=Object.freeze([]),CONNECTED_ACTIONS=Object.freeze(["disconnect","switch-account","close"]);

export function createStandardWalletConnectState(){return state({status:STANDARD_WALLET_CONNECT_STATUS.IDLE})}
export function reduceStandardWalletConnectState(current,event){
  const previous=parseState(current);if(!event||typeof event!=="object"||typeof event.type!=="string")fail("INVALID_STANDARD_WALLET_EVENT");
  switch(event.type){
    case"BEGIN":return state({status:STANDARD_WALLET_CONNECT_STATUS.DISCOVERING,chooserOpen:true,chooserMode:"connect",pendingIntent:token(event.pendingIntent)});
    case"PROVIDER_SELECTED":requirePending(previous);return state({...previous,status:STANDARD_WALLET_CONNECT_STATUS.AWAITING_ACCOUNT,providerKind:providerKind(event.providerKind)});
    case"ACCOUNT_APPROVED":if(previous.status!==STANDARD_WALLET_CONNECT_STATUS.AWAITING_ACCOUNT||previous.providerKind===null)fail("INVALID_STANDARD_WALLET_TRANSITION");return state({...previous,status:STANDARD_WALLET_CONNECT_STATUS.SWITCHING_CHAIN,account:account(event.account)});
    case"CHAIN_CONFIRMED":if(previous.status!==STANDARD_WALLET_CONNECT_STATUS.SWITCHING_CHAIN||previous.providerKind===null||previous.account===null)fail("INVALID_STANDARD_WALLET_TRANSITION");return chain(event.chainId)===STANDARD_WALLET_CHAIN_ID?connected(previous.providerKind,previous.account,previous.rpcProbe,previous.rpcProbeCode):state({...previous,status:STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN,chainId:chain(event.chainId),chooserOpen:true,chooserMode:"wrong-chain"});
    case"RESTORE":{const kind=providerKind(event.providerKind),accounts=accountList(event.accounts),chainId=chain(event.chainId);if(accounts.length===0)return disconnected("accounts-empty");return chainId===STANDARD_WALLET_CHAIN_ID?connected(kind,accounts[0]):state({status:STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN,providerKind:kind,account:accounts[0],chainId,chooserOpen:false,chooserMode:"closed",focusRestoreTarget:"wallet-connect-trigger"})}
    case"OPEN_CHOOSER":return state({...previous,chooserOpen:true,chooserMode:previous.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED?"connection-details":previous.status===STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN?"wrong-chain":"connect",chooserActions:previous.status===STANDARD_WALLET_CONNECT_STATUS.CONNECTED?CONNECTED_ACTIONS:EMPTY});
    case"CLOSE_CHOOSER":return state({...previous,chooserOpen:false,chooserMode:"closed",focusRestoreTarget:"wallet-connect-trigger"});
    case"PRIVATE_SESSION_READY":requireConnected(previous);return state({...previous,privateService:STANDARD_WALLET_PRIVATE_SERVICE.READY,privateServiceCode:null});
    case"PRIVATE_SESSION_DEGRADED":requireConnected(previous);return state({...previous,privateService:STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED,privateServiceCode:safeCode(event.code),chooserOpen:false,chooserMode:"closed"});
    case"RPC_PROBE_READY":requireConnected(previous);requireProbe(event);return state({...previous,rpcProbe:"ready",rpcProbeCode:null});
    case"RPC_PROBE_DEGRADED":requireConnected(previous);requireProbe(event);return state({...previous,rpcProbe:"degraded",rpcProbeCode:safeCode(event.code),chooserOpen:false,chooserMode:"closed"});
    case"ACCOUNTS_CHANGED":{const accounts=accountList(event.accounts);if(accounts.length===0)return disconnected("accounts-empty");if(![STANDARD_WALLET_CONNECT_STATUS.CONNECTED,STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN].includes(previous.status))fail("INVALID_STANDARD_WALLET_TRANSITION");return state({...previous,account:accounts[0]})}
    case"CHAIN_CHANGED":{if(previous.providerKind===null||previous.account===null)fail("INVALID_STANDARD_WALLET_TRANSITION");const chainId=chain(event.chainId);return chainId===STANDARD_WALLET_CHAIN_ID?connected(previous.providerKind,previous.account,previous.rpcProbe,previous.rpcProbeCode):state({...previous,status:STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN,chainId,standardPermissions:EMPTY,productAccess:"guest-or-public-only",chooserOpen:false,chooserMode:"closed"})}
    case"PROVIDER_DISCONNECT":return disconnected("provider-disconnect");
    case"DISCONNECT":return disconnected("user-disconnect");
    case"FAIL":return state({status:STANDARD_WALLET_CONNECT_STATUS.FAILED,chooserOpen:true,chooserMode:"error",errorCode:safeCode(event.code)});
    default:fail("INVALID_STANDARD_WALLET_EVENT");
  }
}
function connected(providerKindValue,approvedAccount,rpcProbe="not-run",rpcProbeCode=null){return state({status:STANDARD_WALLET_CONNECT_STATUS.CONNECTED,providerKind:providerKindValue,account:approvedAccount,chainId:STANDARD_WALLET_CHAIN_ID,chooserOpen:false,chooserMode:"closed",chooserActions:CONNECTED_ACTIONS,pendingIntent:null,focusRestoreTarget:"wallet-connect-trigger",rpcProbe,rpcProbeCode,standardPermissions:Object.freeze(["account:read","chain:read"]),productAccess:"standard-wallet-connected"})}
function disconnected(reason){return state({status:STANDARD_WALLET_CONNECT_STATUS.DISCONNECTED,disconnectReason:reason,focusRestoreTarget:"wallet-connect-trigger"})}
function state(input){return Object.freeze({status:input.status,chooserOpen:input.chooserOpen??false,chooserMode:input.chooserMode??"closed",chooserActions:input.chooserActions??EMPTY,pendingIntent:input.pendingIntent??null,providerKind:input.providerKind??null,account:input.account??null,chainId:input.chainId??null,privateService:input.privateService??STANDARD_WALLET_PRIVATE_SERVICE.NOT_REQUESTED,privateServiceCode:input.privateServiceCode??null,rpcProbe:input.rpcProbe??"not-run",rpcProbeCode:input.rpcProbeCode??null,standardPermissions:input.standardPermissions??EMPTY,productAccess:input.productAccess??"guest-or-public-only",focusRestoreTarget:input.focusRestoreTarget??null,errorCode:input.errorCode??null,disconnectReason:input.disconnectReason??null,authority:"standard-wallet-eip1193-state-only"})}
function parseState(value){if(!value||value.authority!=="standard-wallet-eip1193-state-only"||!Object.values(STANDARD_WALLET_CONNECT_STATUS).includes(value.status))fail("INVALID_STANDARD_WALLET_STATE");return value}
function requirePending(value){if(value.status!==STANDARD_WALLET_CONNECT_STATUS.DISCOVERING||value.pendingIntent===null)fail("INVALID_STANDARD_WALLET_TRANSITION")}
function requireConnected(value){if(value.status!==STANDARD_WALLET_CONNECT_STATUS.CONNECTED||value.providerKind===null||value.account===null||value.chainId!==STANDARD_WALLET_CHAIN_ID)fail("INVALID_STANDARD_WALLET_TRANSITION")}
function requireProbe(event){if(event.probeTransport!==STANDARD_WALLET_RPC_PROBE_TRANSPORT)fail("UNSAFE_BROWSER_RPC_PROBE")}
function providerKind(value){if(!["metamask","ynx-wallet"].includes(value))fail("INVALID_STANDARD_WALLET_PROVIDER");return value}
function account(value){if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value))fail("INVALID_STANDARD_WALLET_ACCOUNT");return value.toLowerCase()}
function accountList(value){if(!Array.isArray(value)||value.length>1024)fail("INVALID_STANDARD_WALLET_ACCOUNT");return value.map(account)}
function chain(value){if(typeof value!=="string"||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))fail("INVALID_STANDARD_WALLET_CHAIN");return value.toLowerCase()}
function token(value){if(typeof value!=="string"||!/^[A-Za-z0-9_-]{16,128}$/.test(value))fail("INVALID_STANDARD_WALLET_INTENT");return value}
function safeCode(value){if(typeof value!=="string"||!/^[A-Z][A-Z0-9_]{2,63}$/.test(value))fail("INVALID_STANDARD_WALLET_ERROR");return value}
function fail(code){throw Object.assign(new Error(code),{code})}

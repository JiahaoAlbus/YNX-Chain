import {
  StandardWalletConnection,
  discoverInjectedWalletProviders,
  discoverWalletProviders as discoverSharedWalletProviders,
} from "./vendor/wallet-standard-c97f85e9/standard-wallet-browser.mjs";

// These are unverified discovery candidates, never account approval or authentication.
const selectedKinds = new WeakMap<object, "ynx-wallet" | "metamask">();
const connections = new WeakMap<object, StandardWalletConnection>();
const operationEpochs = new WeakMap<object, number>();

// Card has awaits around the SDK (network selection), so it needs its own fence too.
export function beginStandardWalletOperation(provider:object):()=>boolean {
  const epoch=(operationEpochs.get(provider)??0)+1;
  operationEpochs.set(provider,epoch);
  return()=>operationEpochs.get(provider)===epoch;
}

export async function discoverWalletProviders(scope:unknown=globalThis,waitMs=160) {
  const discovery=await discoverSharedWalletProviders(scope,waitMs);
  for(const candidate of discovery.candidates)selectedKinds.delete(candidate.provider);
  for(const candidate of [discovery.ynx,discovery.metamask]) {
    if(candidate)selectedKinds.set(candidate.provider,candidate.kind);
  }
  return discovery;
}

export function isSharedWalletProvider(provider:unknown,kind:"ynx-wallet"|"metamask"):boolean {
  if(!provider||typeof provider!=="object")return false;
  const value=provider as {request?:unknown;isYNXWallet?:unknown;isMetaMask?:unknown};
  if(typeof value.request!=="function")return false;
  if(kind==="ynx-wallet"&&value.isMetaMask===true||kind==="metamask"&&value.isYNXWallet===true)return false;
  if(selectedKinds.get(provider)===kind)return true;
  const discovery=discoverInjectedWalletProviders({ethereum:provider});
  return (kind==="ynx-wallet"?discovery.ynx:discovery.metamask)?.provider===provider;
}

export function standardWalletConnection(provider:object):StandardWalletConnection {
  let connection=connections.get(provider);
  if(!connection) {
    connection=new StandardWalletConnection({provider,origin:"https://card.ynxweb4.com",metadata:{name:"YNX Card",url:"https://card.ynxweb4.com"}});
    connections.set(provider,connection);
  }
  return connection;
}

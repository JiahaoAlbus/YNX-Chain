type Listener = (url: string) => void;
const pending: string[] = [];
const MAX_PENDING = 4;
const listeners = new Set<Listener>();
export function offerWalletConnectDeepLink(url: string): void {
  if(typeof url!=="string"||url.length>4096||!url.startsWith("ynxwallet://wc?"))throw new Error("WalletConnect deep link is invalid.");
  if(pending.includes(url))return;
  if(pending.length>=MAX_PENDING)throw new Error("WalletConnect pairing inbox is full. Finish or reject an earlier link first.");
  pending.push(url);
  if(pending.length===1)for(const listener of listeners)listener(url);
}
export function subscribeWalletConnectDeepLinks(listener: Listener): () => void { listeners.add(listener); if (pending[0]) listener(pending[0]); return () => listeners.delete(listener); }
export function consumeWalletConnectDeepLink(url: string): void {
  if(pending[0]!==url)return;
  pending.shift();
  if(pending[0])for(const listener of listeners)listener(pending[0]);
}

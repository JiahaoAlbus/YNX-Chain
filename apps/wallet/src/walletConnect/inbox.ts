type Listener = (url: string) => void;
let pending: string | null = null;
const listeners = new Set<Listener>();
export function offerWalletConnectDeepLink(url: string): void { pending = url; for (const listener of listeners) listener(url); }
export function subscribeWalletConnectDeepLinks(listener: Listener): () => void { listeners.add(listener); if (pending) listener(pending); return () => listeners.delete(listener); }
export function consumeWalletConnectDeepLink(url: string): void { if (pending === url) pending = null; }

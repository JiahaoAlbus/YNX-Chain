// Notifications are invalidation hints only. Every receiving tab restores through Auth.
export function createMediaSessionEvents(product, environment = globalThis) {
  const key = 'ynx.' + product + '.session-change';
  let channel;
  const listeners = new Set(), seen = new Set();
  const receive = value => {
    if (!value || value.event !== 'changed' || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/.test(value.id) || seen.has(value.id)) return;
    seen.add(value.id); if (seen.size > 64) seen.delete(seen.values().next().value);
    for (const listener of listeners) listener();
  };
  try {if (environment.window?.BroadcastChannel) {channel = new environment.window.BroadcastChannel(key); channel.onmessage = event => receive(event.data);}} catch {}
  environment.window?.addEventListener?.('storage', event => {if (event.key === key && event.newValue) {try {receive(JSON.parse(event.newValue));} catch {}}});
  return {
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    announce() {
      const message = {event: 'changed', id: environment.crypto.randomUUID()};
      seen.add(message.id);
      try {channel?.postMessage(message);} catch {}
      try {environment.localStorage?.setItem(key, JSON.stringify(message));} catch {}
    },
    close() {channel?.close();listeners.clear();},
  };
}

// A return location never grants access and cannot leave this product origin.
export function createMediaReturnLocation(product, views, environment = globalThis) {
  const key = 'ynx.' + product + '.return-location';
  return {
    remember(request, view) {
      if (!request.state || !views.includes(view)) return;
      const url = new URL(environment.location.href);
      url.hash = ''; url.searchParams.delete('result'); url.searchParams.set('mediaView', view);
      try {environment.localStorage?.setItem(key, JSON.stringify({state: request.state, expiresAt: request.expiresAt, path: url.pathname + url.search}));} catch {}
    },
    consume(session) {
      try {
        const raw = environment.localStorage?.getItem(key);
        if (!raw || raw.length > 8192) return '/';
        const saved = JSON.parse(raw);
        if (saved.state !== session?.state || Date.parse(saved.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(saved.expiresAt))) return '/';
        const target = new URL(saved.path, environment.location.origin);
        if (target.origin !== environment.location.origin || !views.includes(target.searchParams.get('mediaView')) || target.pathname.includes('callback') || target.searchParams.has('result')) return '/';
        environment.localStorage.removeItem(key);
        return target.pathname + target.search;
      } catch {return '/';}
    },
  };
}

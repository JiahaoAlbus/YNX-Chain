import {ContextChangedError} from './request-context.js';

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

// Keep only opaque digests and retry keys. A fresh session for the same account
// can recover an unconfirmed write without retaining private form text.
export function createMutationIntents(account) {
  const pending = new Map();
  return {
    async prepare(method, path, input) {
      const actor = account();
      if (!actor) throw new Error('Connect Wallet before saving changes.');
      const body = JSON.parse(JSON.stringify(input));
      delete body.IdempotencyKey;
      const bytes = new TextEncoder().encode(canonical({actor, method, path, body}));
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
      if (actor !== account()) throw new ContextChangedError();
      let key = pending.get(fingerprint);
      if (!key) {
        if (pending.size >= 256) throw new Error('Too many unconfirmed changes. Recover earlier requests before starting more.');
        key = crypto.randomUUID();
        pending.set(fingerprint, key);
      }
      return {fingerprint, key, body: {...body, IdempotencyKey: key}};
    },
    confirm(intent) {
      if (pending.get(intent.fingerprint) === intent.key) pending.delete(intent.fingerprint);
    },
  };
}

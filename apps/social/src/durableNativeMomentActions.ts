import { NativeMomentActions } from './nativeMomentActions';

type Action = Readonly<
  { kind: 'follow'; subject: string; active: boolean } |
  { kind: 'reaction'; subject: string; reaction: 'like' | 'love' | 'insight' | 'support'; active: boolean } |
  { kind: 'delete'; subject: string }
>;
type Storage = Readonly<{ read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void> }>;
type Intent = Readonly<{ version: 1; account: string; action: Action; nonce: string; completed: boolean }>;

/** Original operation data only. Storage is not authorization or a server receipt. */
export class DurableNativeMomentActions {
  private readonly busy = new Set<string>();
  constructor(private readonly nonce: () => Promise<string>, private readonly storage: Storage) {}

  async run(account: string, input: Action, current: () => boolean,
    send: (action: Action, idempotencyKey: string) => Promise<unknown>): Promise<boolean> {
    if (!/^ynx1[0-9a-z]{38}$/.test(account)) throw new Error('Invalid moment account');
    const action = snapshot(input);
    if (!current()) return false;
    const { sha256 } = await import('@noble/hashes/sha2.js');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js');
    const key = 'ynx.social.moment.action.v1.' + bytesToHex(sha256(utf8ToBytes(JSON.stringify([account, action.kind, action.subject]))));
    if (!current() || this.busy.has(key)) return false;
    this.busy.add(key);
    try {
      const raw = await this.storage.read(key);
      if (!current()) return false;
      let intent: Intent | null = raw === null ? null : decode(raw, account, action.kind, action.subject);
      if (intent && !intent.completed && JSON.stringify(intent.action) !== JSON.stringify(action)) {
        throw new Error('Review and retry the original pending moment action before changing it');
      }
      if (!intent || intent.completed) {
        const nonce = await this.nonce();
        if (!current()) return false;
        if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('Invalid moment operation nonce');
        intent = Object.freeze({ version: 1, account, action, nonce, completed: false });
        await this.storage.write(key, JSON.stringify(intent));
        if (!current()) return false;
      }
      const original = intent;
      const executor = new NativeMomentActions(async () => original.nonce);
      const confirmed = await executor.run(account, original.action, current, send);
      if (!confirmed || !current()) return false;
      // A failed/stale acknowledgement retains the exact original request for retry.
      await this.storage.write(key, JSON.stringify({ ...original, completed: true }));
      return current();
    } finally {
      this.busy.delete(key);
    }
  }
}

function snapshot(input: Action): Action {
  if (!input || typeof input.subject !== 'string' || !input.subject || input.subject.length > 256) throw new Error('Invalid moment subject');
  if (input.kind === 'delete') return Object.freeze({ kind: input.kind, subject: input.subject });
  if (typeof input.active !== 'boolean') throw new Error('Invalid moment state');
  if (input.kind === 'follow') return Object.freeze({ kind: input.kind, subject: input.subject, active: input.active });
  if (input.kind === 'reaction' && ['like', 'love', 'insight', 'support'].includes(input.reaction)) {
    return Object.freeze({ kind: input.kind, subject: input.subject, reaction: input.reaction, active: input.active });
  }
  throw new Error('Invalid moment action');
}

function decode(raw: string, account: string, kind: Action['kind'], subject: string): Intent {
  try {
    if (raw.length > 4096) throw new Error('oversize');
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'account,action,completed,nonce,version' ||
      value.version !== 1 || value.account !== account || typeof value.completed !== 'boolean' ||
      typeof value.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(value.nonce)) throw new Error('schema');
    const action = snapshot(value.action);
    if (action.kind !== kind || action.subject !== subject ||
      Object.keys(value.action).sort().join(',') !== Object.keys(action).sort().join(',')) throw new Error('scope');
    return Object.freeze({ version: 1, account, action, nonce: value.nonce, completed: value.completed });
  } catch {
    throw new Error('Stored moment action requires recovery; original data was retained');
  }
}

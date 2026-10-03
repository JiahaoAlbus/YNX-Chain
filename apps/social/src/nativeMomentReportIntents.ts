export type MomentReportDraft = Readonly<{
  targetType: 'moment'; targetId: string; category: string; detail: string;
  evidenceHashes: readonly string[];
}>;
type Body = MomentReportDraft & Readonly<{ idempotencyKey: string }>;
type Receipt = Readonly<{ record: Readonly<{ id: string }> }>;
type Intent = Readonly<{ version: 1; account: string; body: Body; completed: boolean; recordId: string | null }>;
type Storage = Readonly<{ read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void> }>;

/** Original user-confirmed request data. No background send or authority grant. */
export class NativeMomentReportIntents {
  private readonly busy = new Set<string>();
  constructor(private readonly nonce: () => Promise<string>, private readonly storage: Storage) {}

  async reviewOriginal(account: string, targetId: string, current: () => boolean): Promise<Readonly<{ draft: MomentReportDraft; completed: boolean; recordId: string | null }> | undefined> {
    if (!current()) return undefined;
    const key = await reportKey(account, targetId);
    if (!current()) return undefined;
    const raw = await this.storage.read(key);
    if (!current() || raw === null) return undefined;
    const original = decode(raw, account, targetId);
    return Object.freeze({ draft: snapshot(original.body), completed: original.completed, recordId: original.recordId });
  }

  async run<T extends Receipt>(account: string, input: MomentReportDraft, current: () => boolean,
    send: (body: Body) => Promise<T>): Promise<T | undefined> {
    if (!/^ynx1[0-9a-z]{38}$/.test(account)) throw new Error('Invalid report account');
    const draft = snapshot(input);
    if (!current()) return undefined;
    const key = await reportKey(account, draft.targetId);
    if (!current() || this.busy.has(key)) return undefined;
    this.busy.add(key);
    try {
      const raw = await this.storage.read(key);
      if (!current()) return undefined;
      let original = raw === null ? null : decode(raw, account, draft.targetId);
      const same = original && JSON.stringify(snapshot(original.body)) === JSON.stringify(draft);
      if (original && !original.completed && !same) throw new Error('Review the original pending report before changing it');
      if (!original || (!same && original.completed)) {
        const nonce = await this.nonce();
        if (!current()) return undefined;
        if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error('Invalid report operation nonce');
        original = Object.freeze({ version: 1, account, body: Object.freeze({ ...draft, idempotencyKey: 'native-report-' + nonce }), completed: false, recordId: null });
        await this.storage.write(key, JSON.stringify(original));
        if (!current()) return undefined;
      }
      const result = await send(original.body);
      if (!current()) return undefined;
      const recordId = result?.record?.id;
      if (typeof recordId !== 'string' || !recordId || recordId.length > 256) throw new Error('Report response requires recovery');
      if (original.recordId !== null && original.recordId !== recordId) throw new Error('Original report result changed; retained request requires recovery');
      await this.storage.write(key, JSON.stringify({ ...original, completed: true, recordId }));
      return current() ? result : undefined;
    } finally { this.busy.delete(key); }
  }
}

async function reportKey(account: string, targetId: string): Promise<string> {
  if (!/^ynx1[0-9a-z]{38}$/.test(account) || typeof targetId !== 'string' || !targetId || targetId.length > 256) throw new Error('Invalid report review scope');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js');
  return 'ynx.social.moment.report.v1.' + bytesToHex(sha256(utf8ToBytes(JSON.stringify([account, 'moment', targetId]))));
}

function snapshot(input: MomentReportDraft): MomentReportDraft {
  if (!input || input.targetType !== 'moment' || typeof input.targetId !== 'string' || !input.targetId || input.targetId.length > 256 ||
    typeof input.category !== 'string' || !['spam','harassment','hate','violence','sexual','misinformation','other'].includes(input.category) ||
    typeof input.detail !== 'string' || input.detail.length > 2000 || !Array.isArray(input.evidenceHashes) || input.evidenceHashes.length > 10 ||
    input.evidenceHashes.some(value => typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))) throw new Error('Invalid original moment report');
  return Object.freeze({ targetType: 'moment', targetId: input.targetId, category: input.category, detail: input.detail, evidenceHashes: Object.freeze([...input.evidenceHashes]) });
}

function decode(raw: string, account: string, targetId: string): Intent {
  try {
    if (raw.length > 16384) throw new Error('size');
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'account,body,completed,recordId,version' || value.version !== 1 || value.account !== account ||
      typeof value.completed !== 'boolean' || !value.body || Object.keys(value.body).sort().join(',') !== 'category,detail,evidenceHashes,idempotencyKey,targetId,targetType' ||
      typeof value.body.idempotencyKey !== 'string' || !/^native-report-[0-9a-f]{32}$/.test(value.body.idempotencyKey)) throw new Error('schema');
    const draft = snapshot(value.body);
    if (draft.targetId !== targetId || (value.completed ? typeof value.recordId !== 'string' || !value.recordId || value.recordId.length > 256 : value.recordId !== null)) throw new Error('binding');
    return Object.freeze({ version: 1, account, body: Object.freeze({ ...draft, idempotencyKey: value.body.idempotencyKey }), completed: value.completed, recordId: value.recordId });
  } catch { throw new Error('Stored report requires recovery; original data was retained'); }
}

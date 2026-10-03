import { checkedChatSlot, parseChatAppearance, type ChatAppearancePort } from './chatAppearance';
type Saved = { sequence: number; raw: string; sha256: string };
// A <=80,000-character preference plus JSON escaping fits in this envelope.
// Native consumers enforce the same byte limit BEFORE allocating file contents.
export const chatAppearanceEnvelopeLimit = 200000;
export class ChatAppearanceStorageLimitError extends Error {
  constructor() { super('CHAT_APPEARANCE_STORAGE_LIMIT'); this.name = 'ChatAppearanceStorageLimitError'; }
}
export function createChatAppearanceJournal(port: {
  read(slot: string, side: 'a' | 'b'): Promise<string | null>;
  write(slot: string, side: 'a' | 'b', raw: string): Promise<void>;
  hash(raw: string): Promise<string>;
}): ChatAppearancePort {
  async function checkedHash(raw: string): Promise<string> {
    const digest = await port.hash(raw);
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))
      throw new Error('CHAT_APPEARANCE_HASH_PROVIDER_INVALID');
    return digest;
  }
  async function inspect(slot: string) {
    checkedChatSlot(slot);
    const records: { side: 'a' | 'b'; saved: Saved | null; present: boolean }[] = [];
    for (const side of ['a', 'b'] as const) {
      let raw: string | null;
      try { raw = await port.read(slot, side); }
      catch (error) {
        if (!(error instanceof ChatAppearanceStorageLimitError)) throw error;
        records.push({ side, saved: null, present: true });
        continue;
      }
      let saved: Saved | null = null;
      if (raw !== null && raw.length <= chatAppearanceEnvelopeLimit) {
        let candidate: Saved | null = null;
        try {
          const value: unknown = JSON.parse(raw);
          if (value && typeof value === 'object') {
            const entry = value as Record<string, unknown>;
            if (Object.keys(entry).length === 3 && Number.isSafeInteger(entry.sequence) && Number(entry.sequence) > 0 &&
                typeof entry.raw === 'string' && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256)) {
              parseChatAppearance(entry.raw);
              candidate = { sequence: Number(entry.sequence), raw: entry.raw, sha256: entry.sha256 };
            }
          }
        } catch { /* Invalid JSON/shape only. Never catch asynchronous provider failure. */ }
        if (candidate && await checkedHash(candidate.raw) === candidate.sha256) saved = candidate;
      }
      records.push({ side, saved, present: raw !== null });
    }
    const valid = records.filter(record => record.saved !== null).sort((a, b) => b.saved!.sequence - a.saved!.sequence);
    if (!valid.length && records.some(record => record.present)) throw new Error('CHAT_APPEARANCE_STORAGE_NEEDS_RECOVERY');
    if (valid.length === 2 && valid[0]!.saved!.sequence === valid[1]!.saved!.sequence && valid[0]!.saved!.sha256 !== valid[1]!.saved!.sha256)
      throw new Error('CHAT_APPEARANCE_AMBIGUOUS_STORAGE');
    return { records, latest: valid[0] ?? null };
  }
  return {
    async read(slot) { return (await inspect(slot)).latest?.saved?.raw ?? null; },
    async write(slot, raw) {
      parseChatAppearance(raw);
      const { records, latest } = await inspect(slot);
      const sequence = (latest?.saved?.sequence ?? 0) + 1;
      if (!Number.isSafeInteger(sequence)) throw new Error('CHAT_APPEARANCE_STORAGE_NEEDS_RECOVERY');
      const target = latest ? records.find(record => record.side !== latest.side)! : records[0]!;
      const envelope = JSON.stringify({ sequence, raw, sha256: await checkedHash(raw) });
      await port.write(slot, target.side, envelope);
      if (await port.read(slot, target.side) !== envelope) throw new Error('CHAT_APPEARANCE_WRITE_NOT_CONFIRMED');
    },
  };
}

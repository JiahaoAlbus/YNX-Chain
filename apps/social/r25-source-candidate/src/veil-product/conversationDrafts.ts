import {productLimits} from './productModel';

export type ConversationDraft = Readonly<{
  body: string; replyToMessageId: string | null; revision: number; generation: number;
}>;
const hiddenDraft: ConversationDraft = Object.freeze({body: '', replyToMessageId: null, revision: 0, generation: 0});

/** Unsaved editor state and observed protected revision metadata only.
 * No outbox, replay, persistence or authority.
 * A temporarily hidden view can retain drafts; an account change or lock clears
 * them. Monotone revisions stop old receipts from clearing newer text.
 */
export class ConversationDrafts {
  private account: string | null = null;
  private generation = 0;
  private revision = 0;
  private drafts = new Map<string, ConversationDraft>();
  private savedRevisions = new Map<string, string>();
  selectAccount(account: string | null): boolean {
    if (this.account === account) return false;
    this.account = account; this.drafts.clear(); this.savedRevisions.clear(); ++this.generation;
    return true;
  }
  read(account: string | null, conversation: string | null): ConversationDraft {
    if (!account || !conversation || account !== this.account) return hiddenDraft;
    return this.drafts.get(conversation) ?? Object.freeze({...hiddenDraft, generation: this.generation});
  }
  protectedRevision(account: string | null, conversation: string | null): string | null {
    if (!account || account !== this.account || !conversation) return null;
    return this.savedRevisions.get(conversation) ?? null;
  }
  observeProtectedRevision(account: string, conversation: string, generation: number, revision: string): boolean {
    if (account !== this.account || generation !== this.generation || !conversation ||
      !/^(0|[1-9][0-9]{0,15})$/.test(revision) || Number(revision) > 9007199254740990) return false;
    this.savedRevisions.set(conversation, revision);
    return true;
  }
  forgetProtectedRevision(account: string, conversation: string, generation?: number): boolean {
    if (account !== this.account || (generation !== undefined && generation !== this.generation)) return false;
    return this.savedRevisions.delete(conversation);
  }
  edit(account: string, conversation: string, generation: number,
    patch: Partial<Pick<ConversationDraft, 'body' | 'replyToMessageId'>>): boolean {
    if (account !== this.account || generation !== this.generation || !conversation || this.revision >= Number.MAX_SAFE_INTEGER) return false;
    if (patch.body !== undefined && patch.body.length > productLimits.body) return false;
    const previous = this.read(account, conversation);
    const next = {...previous, ...patch};
    if (next.body === previous.body && next.replyToMessageId === previous.replyToMessageId) return false;
    this.drafts.set(conversation, Object.freeze({...next, revision: ++this.revision}));
    return true;
  }
  /** Apply a real protected read only while the SAME unsaved editor revision
   * is still selected. Reading saved text grants no send/replay permission. */
  restore(account: string, conversation: string, revision: number | null, generation: number,
    body: string, replyToMessageId: string | null): boolean {
    if (this.account !== account || this.generation !== generation || !conversation || revision === null || body.length > productLimits.body) return false;
    const current = this.read(account, conversation);
    if (current.revision !== revision) return false;
    if (current.body === body && current.replyToMessageId === replyToMessageId) return true;
    return this.edit(account, conversation, current.generation, {body, replyToMessageId});
  }
  confirm(account: string, conversation: string, revision: number | null): boolean {
    const original = this.drafts.get(conversation);
    if (account !== this.account || !original || original.revision !== revision) return false;
    this.drafts.delete(conversation);
    return true;
  }
}

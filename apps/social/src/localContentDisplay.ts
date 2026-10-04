import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const CONTENT_CATEGORIES = ['gore', 'explicit_violence', 'sexual_content'] as const;
export type ContentCategory = typeof CONTENT_CATEGORIES[number];
export type ContentScores = Readonly<Record<ContentCategory, number>>;
export type ContentFilterPreferences = Readonly<{
  enabled: boolean;
  thresholds: ContentScores;
}>;
export const DEFAULT_CONTENT_FILTER: ContentFilterPreferences = Object.freeze({
  enabled: false,
  thresholds: Object.freeze({ gore: 0.7, explicit_violence: 0.7, sexual_content: 0.7 }),
});

/** This is a display boundary, not a model or a claim of local protection.
 * Only a separately reviewed, installed device classifier may supply this port.
 * It must not upload plaintext, invoke tools, or fall back to a remote service.
 * Passing a callback does not establish that those requirements are satisfied.
 */
export interface DeviceContentClassifier {
  readonly supportedMimeTypes: readonly string[];
  classify(bytes: Uint8Array, mimeType: string, signal: AbortSignal): Promise<ContentScores>;
}

export type ContentDisplayDecision = Readonly<{
  contentId: string;
  revision: number;
  status: 'disabled' | 'pending' | 'clear' | 'folded' | 'unavailable';
  reason?: 'model_unavailable' | 'unsupported' | 'resource_limit' | 'timeout' | 'cancelled' | 'classification_failed' | 'stale';
  flagged: readonly ContentCategory[];
}>;
type Pending = { abort: AbortController; stop: () => void };
type DecisionRecord = { digest: string; decision: ContentDisplayDecision };

function checkedScores(value: unknown): ContentScores {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid device classification result');
  }
  const source = value as Record<ContentCategory, unknown>;
  const scores = {} as Record<ContentCategory, number>;
  for (const category of CONTENT_CATEGORIES) {
    // Read each adapter field once: a bridge/getter must not change the score
    // between validation and the display decision.
    const score = source[category];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error('Invalid device classification score');
    }
    scores[category] = score;
  }
  return Object.freeze(scores);
}

function preferences(value: ContentFilterPreferences): ContentFilterPreferences {
  if (typeof value.enabled !== 'boolean' || CONTENT_CATEGORIES.some(category =>
    !Number.isFinite(value.thresholds[category]) || value.thresholds[category] <= 0 || value.thresholds[category] > 1)) {
    throw new Error('Invalid local content filter preferences');
  }
  return Object.freeze({ enabled: value.enabled, thresholds: Object.freeze({ ...value.thresholds }) });
}

/** Receives only original content already authorized and decrypted by the caller.
 * No network, storage, logging, report, send, block or moderation entry points.
 * Decisions are ephemeral: they cannot certify changed content or another device.
 */
export class LocalContentDisplay {
  private settings = DEFAULT_CONTENT_FILTER;
  private revision = 0;
  private active = new Map<string, Pending>();
  private decisions = new Map<string, DecisionRecord>();
  private readonly mimeTypes: ReadonlySet<string>;

  constructor(private readonly classifier?: DeviceContentClassifier,
    private readonly limits = { maxConcurrent: 2, maxBytes: 8 * 1024 * 1024, timeoutMs: 10_000 }) {
    if (![limits.maxConcurrent, limits.maxBytes, limits.timeoutMs].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Invalid local content filter limits');
    }
    this.limits = Object.freeze({ ...limits });
    this.mimeTypes = new Set(classifier?.supportedMimeTypes ?? []);
  }

  configure(value: ContentFilterPreferences): void {
    const next = preferences(value);
    ++this.revision;
    this.settings = next;
    this.decisions.clear();
    for (const pending of this.active.values()) { pending.abort.abort(); pending.stop(); }
    this.active.clear();
  }

  /** Synchronous initial decision lets consumers withhold the original before
   * awaiting inference. Never render an enabled original based on a pending job.
   */
  begin(contentId: string, original: Uint8Array, mimeType: string): Readonly<{
    initial: ContentDisplayDecision;
    completed: Promise<ContentDisplayDecision>;
    cancel: () => void;
  }> {
    if (!contentId || contentId.length > 512) throw new Error('Invalid display content identity');
    const revision = this.revision;
    const decide = (status: ContentDisplayDecision['status'], reason?: ContentDisplayDecision['reason'],
      flagged: readonly ContentCategory[] = []): ContentDisplayDecision =>
      Object.freeze({ contentId, revision, status, ...(reason ? { reason } : {}), flagged: Object.freeze([...flagged]) });
    const immediate = (decision: ContentDisplayDecision) => Object.freeze({
      initial: decision, completed: Promise.resolve(decision), cancel: () => {},
    });
    const previous = this.active.get(contentId);
    if (previous) { previous.abort.abort(); previous.stop(); this.active.delete(contentId); }
    this.decisions.delete(contentId);
    if (!this.settings.enabled) return immediate(decide('disabled'));
    if (!this.classifier) return immediate(decide('unavailable', 'model_unavailable'));
    if (!this.mimeTypes.has(mimeType)) return immediate(decide('unavailable', 'unsupported'));
    if (!original.byteLength || original.byteLength > this.limits.maxBytes || this.active.size >= this.limits.maxConcurrent) {
      return immediate(decide('unavailable', 'resource_limit'));
    }

    // A consumer mutation while inference awaits must not alter this snapshot.
    const bytes = original.slice();
    const digest = bytesToHex(sha256(bytes));
    const abort = new AbortController();
    const initial = decide('pending');
    const thresholds = this.settings.thresholds;
    let stop: () => void = () => {};
    const stopped = new Promise<'cancelled'>(resolve => { stop = () => resolve('cancelled'); });
    const pending: Pending = { abort, stop };
    this.active.set(contentId, pending);
    this.decisions.set(contentId, { digest, decision: initial });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => { abort.abort(); resolve('timeout'); }, this.limits.timeoutMs);
    });
    // Attach handlers before invoking the adapter; sync throws and late rejected
    // promises stay contained. A timeout is never interpreted as a clear result.
    const classification = Promise.resolve().then<ContentScores | 'cancelled'>(() => {
      if (abort.signal.aborted) return 'cancelled' as const;
      return this.classifier!.classify(bytes, mimeType, abort.signal);
    }).catch(() => 'classification_failed' as const);
    const completed = Promise.race([classification, stopped, timeout]).then(result => {
      let decision: ContentDisplayDecision;
      if (revision !== this.revision || this.active.get(contentId) !== pending) {
        decision = decide('unavailable', 'stale');
      } else if (typeof result === 'string') {
        decision = decide('unavailable', result);
      } else if (abort.signal.aborted) {
        decision = decide('unavailable', 'cancelled');
      } else {
        try {
          const scores = checkedScores(result);
          const flagged = CONTENT_CATEGORIES.filter(category => scores[category] >= thresholds[category]);
          decision = decide(flagged.length ? 'folded' : 'clear', undefined, flagged);
        } catch {
          decision = decide('unavailable', 'classification_failed');
        }
      }
      if (timer !== undefined) clearTimeout(timer);
      if (this.active.get(contentId) === pending) {
        this.active.delete(contentId);
        this.decisions.set(contentId, { digest, decision });
      }
      // JS/runtime copies cannot be guaranteed erased; no persistence is used.
      bytes.fill(0);
      return decision;
    });
    return Object.freeze({ initial, completed, cancel: () => { abort.abort(); stop(); } });
  }

  /** Mandatory final render fence. All previews/notifications/search consumers
   * must use it with the original bytes, not just trust a fulfilled Promise.
   * Permission/legality checks remain the caller's responsibility; this gate
   * cannot authorize content and offers no bypass of service rules.
   */
  canDisplay(contentId: string, original: Uint8Array, decision: ContentDisplayDecision): boolean {
    if (decision.contentId !== contentId || decision.revision !== this.revision) return false;
    if (!this.settings.enabled) return decision.status === 'disabled';
    if (decision.status !== 'clear') return false;
    const record = this.decisions.get(contentId);
    return record?.decision === decision && record.digest === bytesToHex(sha256(original));
  }

  dispose(): void {
    this.configure({ ...this.settings, enabled: false });
  }
}

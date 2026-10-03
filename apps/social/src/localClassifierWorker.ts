import type { ContentScores, DeviceContentClassifier } from './localContentDisplay';

const protocol = 'ynx-social-classifier-worker-v1';
const categories = ['gore', 'explicit_violence', 'sexual_content'] as const;
const supportedImages = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ClassifierWorkerRequest = Readonly<{
  protocol: typeof protocol; type: 'classify'; id: number;
  content: ArrayBuffer; mimeType: string;
}>;
export interface ClassifierWorkerPort {
  subscribe(result: (data: unknown) => void, failure: () => void): () => void;
  postMessage(request: ClassifierWorkerRequest, transfer: readonly ArrayBuffer[]): void;
  terminate(): void;
}
export type LocalClassifierWorkerOptions = Readonly<{
  supportedMimeTypes: readonly string[];
  timeoutMs?: number; maximumBytes?: number; maximumConcurrent?: number;
}>;

function strictRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field => 'value' in field);
}
function scoresFrom(value: unknown): ContentScores {
  if (!strictRecord(value) || Object.keys(value).length !== categories.length ||
    categories.some(category => typeof value[category] !== 'number' ||
      !Number.isFinite(value[category]) || value[category] < 0 || value[category] > 1)) {
    throw new Error('Invalid local classifier scores');
  }
  return Object.freeze({ gore: value.gore as number, explicit_violence: value.explicit_violence as number,
    sexual_content: value.sexual_content as number });
}

// The factory must supply an independently reviewed, admitted local engine.
// This boundary does not prove model authenticity, accuracy, network isolation
// or secure erasure; it never downloads a model or creates a remote transport.
export class LocalClassifierWorker implements DeviceContentClassifier {
  readonly supportedMimeTypes: readonly string[];
  private readonly timeoutMs: number;
  private readonly maximumBytes: number;
  private readonly maximumConcurrent: number;
  private readonly pending = new Map<number, () => void>();
  private sequence = 0;
  private closed = false;

  constructor(private readonly createWorker: () => ClassifierWorkerPort, options: LocalClassifierWorkerOptions) {
    const mimeTypes = [...options.supportedMimeTypes];
    if (!mimeTypes.length || new Set(mimeTypes).size !== mimeTypes.length ||
      mimeTypes.some(type => !supportedImages.has(type))) throw new Error('Unsupported classifier image types');
    this.supportedMimeTypes = Object.freeze(mimeTypes);
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maximumBytes = options.maximumBytes ?? 8 * 1024 * 1024;
    this.maximumConcurrent = options.maximumConcurrent ?? 1;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000 ||
      !Number.isSafeInteger(this.maximumBytes) || this.maximumBytes < 1 || this.maximumBytes > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(this.maximumConcurrent) || this.maximumConcurrent < 1 || this.maximumConcurrent > 2) {
      throw new Error('Invalid classifier worker limits');
    }
  }

  classify(bytes: Uint8Array, mimeType: string, signal: AbortSignal): Promise<ContentScores> {
    if (this.closed || signal.aborted) return Promise.reject(new Error('Local classifier stopped'));
    if (!this.supportedMimeTypes.includes(mimeType) || bytes.byteLength < 1 || bytes.byteLength > this.maximumBytes) {
      return Promise.reject(new Error('Unsupported local classifier input'));
    }
    if (this.pending.size >= this.maximumConcurrent || this.sequence === Number.MAX_SAFE_INTEGER) {
      return Promise.reject(new Error('Local classifier capacity exceeded'));
    }
    const id = ++this.sequence;
    const content = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(content).set(bytes); // Never transfer or overwrite the caller's bytes.
    return new Promise<ContentScores>((resolve, reject) => {
      let worker: ClassifierWorkerPort | undefined;
      let unsubscribe: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      let dispatched = false;
      const finish = (scores?: ContentScores, failure?: Error) => {
        if (finished) return;
        finished = true;
        this.pending.delete(id);
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        let cleanupFailed = false;
        try { unsubscribe?.(); } catch { cleanupFailed = true; }
        try { worker?.terminate(); } catch { cleanupFailed = true; }
        if (content.byteLength) new Uint8Array(content).fill(0);
        if (cleanupFailed) {
          this.closed = true;
          for (const stop of Array.from(this.pending.values())) stop();
          reject(new Error('Local classifier cleanup failed'));
        } else if (failure || !scores) reject(failure ?? new Error('Local classification failed'));
        else resolve(scores);
      };
      const cancel = () => finish(undefined, new Error('Local classifier stopped'));
      const result = (value: unknown) => {
        if (finished || !dispatched) return;
        try {
          if (!strictRecord(value) || value.protocol !== protocol || !Number.isSafeInteger(value.id)) {
            throw new Error('Invalid classifier worker message');
          }
          if (value.id !== id) return; // A queued result cannot resolve another job.
          if (Object.keys(value).length !== 4 || value.type !== 'scores') {
            throw new Error('Local classification failed');
          }
          finish(scoresFrom(value.scores));
        } catch { finish(undefined, new Error('Invalid local classifier result')); }
      };
      this.pending.set(id, cancel);
      signal.addEventListener('abort', cancel, { once: true });
      try {
        worker = this.createWorker();
        if (finished) {
          // Cancellation or close can run synchronously inside the factory,
          // before finish has a port to terminate. Reclaim that returned port.
          try { worker.terminate(); } catch {
            this.closed = true;
            for (const stop of Array.from(this.pending.values())) stop();
          }
          return;
        }
        if (signal.aborted || this.closed) { cancel(); return; }
        unsubscribe = worker.subscribe(result, () => finish(undefined, new Error('Local classifier worker failed')));
        if (finished) { unsubscribe(); return; }
        timer = setTimeout(() => finish(undefined, new Error('Local classifier timed out')), this.timeoutMs);
        dispatched = true;
        worker.postMessage({ protocol, type: 'classify', id, content, mimeType }, [content]);
      } catch { finish(undefined, new Error('Local classifier worker failed')); }
    });
  }

  close(): void {
    this.closed = true;
    for (const stop of Array.from(this.pending.values())) stop();
  }
}

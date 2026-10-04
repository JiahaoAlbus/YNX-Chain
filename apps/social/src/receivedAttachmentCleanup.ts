export type PreviewCleanupPort = Readonly<{ close(): Promise<void> }>;
export type CleanupSource = Readonly<{ target: Readonly<{ preview: PreviewCleanupPort }> }>;
export type AttachmentCleanupObligation<Source extends CleanupSource> = Readonly<{
  source: Source;
  preview: PreviewCleanupPort;
}>;

// Retain original source/port references in process, including across a parent
// unmount. This is not a native durable journal, grant or remote erase receipt.
export class ReceivedAttachmentCleanups<Source extends CleanupSource> {
  private entries: readonly AttachmentCleanupObligation<Source>[] = Object.freeze([]);
  private readonly listeners = new Set<() => void>();
  private readonly running = new Map<AttachmentCleanupObligation<Source>, Promise<void>>();

  snapshot = (): readonly AttachmentCleanupObligation<Source>[] => this.entries;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: readonly AttachmentCleanupObligation<Source>[]): void {
    this.entries = Object.freeze([...next]);
    for (const listener of this.listeners) listener();
  }
  retain(source: Source): AttachmentCleanupObligation<Source> {
    const existing = this.entries.find(entry => entry.source === source);
    if (existing) return existing;
    const original = Object.freeze({ source, preview: source.target.preview });
    this.publish([...this.entries, original]);
    return original;
  }
  complete(original: AttachmentCleanupObligation<Source>): void {
    if (this.entries.includes(original)) this.publish(this.entries.filter(entry => entry !== original));
  }
  async close(original: AttachmentCleanupObligation<Source>): Promise<void> {
    if (!this.entries.includes(original)) return;
    const existing = this.running.get(original);
    if (existing) { await existing; return; }
    const running = Promise.resolve().then(() => original.preview.close());
    this.running.set(original, running);
    try { await running; this.complete(original); }
    finally { this.running.delete(original); }
  }
  async retry(): Promise<void> {
    let failure: unknown;
    let failed = false;
    // A failed old preview must not prevent retrying other original obligations.
    for (const original of this.entries) {
      try { await this.close(original); }
      catch (error) { if (!failed) failure = error; failed = true; }
    }
    if (failed) throw failure;
  }
}

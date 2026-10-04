export type ClipboardAdapter = Readonly<{
  getStringAsync(): Promise<string>;
  setStringAsync(value: string): Promise<unknown>;
}>;

export type ClipboardSchedule = (
  task: () => void | Promise<void>,
  delayMs: number,
) => Readonly<{ cancel(): void }>;

const DEFAULT_TTL_MS = 30_000;
// A successful new copy supersedes timers from every Wallet surface, including
// a Receive modal that has since unmounted. Values here contain no account keys.
const copies = new WeakMap<ClipboardAdapter, () => void>();
const writes = new WeakMap<ClipboardAdapter, Promise<unknown>>();

export async function copyPublicValueWithExpiry(
  clipboard: ClipboardAdapter,
  value: string,
  options: Readonly<{ ttlMs?: number; schedule?: ClipboardSchedule; guard?: () => void }> = {},
): Promise<() => void> {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || value.trim() !== value) {
    throw new Error("Clipboard value is invalid");
  }
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 120_000) {
    throw new Error("Clipboard expiry must be between 1 and 120 seconds");
  }
  const schedule = options.schedule ?? defaultSchedule;
  const guard=options.guard??(()=>{});
  guard();
  return serialWrite(clipboard, async () => {
    // A queued public copy may outlive its account, modal or operation lease.
    guard();
    await clipboard.setStringAsync(value);
    // Only replace the previous lease after the write succeeds. Invalid input or
    // a denied replacement must not disable the earlier value's expiry.
    copies.get(clipboard)?.();
    let active = true;
    let scheduled: Readonly<{ cancel(): void }> | undefined;
    const cancel = () => {
      active = false;
      scheduled?.cancel();
      if (copies.get(clipboard) === cancel) copies.delete(clipboard);
    };
    copies.set(clipboard, cancel);
    scheduled = schedule(async () => {
      if (!active || copies.get(clipboard) !== cancel) return;
      try {
        const unchanged = await clipboard.getStringAsync() === value;
        // Cancel/new-copy may have happened while the OS clipboard read awaited.
        if (!active || copies.get(clipboard) !== cancel) return;
        if (unchanged) await serialWrite(clipboard, async () => {
          if (!active || copies.get(clipboard) !== cancel) return;
          // A queued write may wait behind a new copy. Recheck the actual value
          // and lease inside the same queue as all Wallet writes.
          const stillUnchanged = await clipboard.getStringAsync() === value;
          if (!active || copies.get(clipboard) !== cancel) return;
          active = false;
          if (stillUnchanged) await clipboard.setStringAsync("");
        });
      } catch {
        // Clipboard access may disappear while the app backgrounds. Do not retry
        // indefinitely or surface OS clipboard contents in logs.
      } finally {
        active = false;
        if (copies.get(clipboard) === cancel) copies.delete(clipboard);
      }
    }, ttlMs);
    // OS writes already started cannot be undone. Even if the lease expired
    // during that write, retain expiry of the written value before rejecting.
    guard();
    return cancel;
  });
}

/** OS writes already started cannot be cancelled. Keep a later Wallet copy
 * behind their completion, including rejection, so an old clear cannot finish
 * after the new copy. This is not CAS against other apps/system clipboard writes;
 * the OS offers no atomic compare-and-clear through this adapter. */
async function serialWrite<T>(clipboard: ClipboardAdapter, work: () => Promise<T>): Promise<T> {
  const pending = (writes.get(clipboard) ?? Promise.resolve()).catch(() => {}).then(work);
  writes.set(clipboard, pending);
  try { return await pending; }
  finally { if (writes.get(clipboard) === pending) writes.delete(clipboard); }
}

function defaultSchedule(task: () => void | Promise<void>, delayMs: number) {
  const handle = setTimeout(() => void task(), delayMs);
  return Object.freeze({ cancel: () => clearTimeout(handle) });
}

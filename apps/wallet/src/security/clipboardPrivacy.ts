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

export async function copyPublicValueWithExpiry(
  clipboard: ClipboardAdapter,
  value: string,
  options: Readonly<{ ttlMs?: number; schedule?: ClipboardSchedule }> = {},
): Promise<() => void> {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || value.trim() !== value) {
    throw new Error("Clipboard value is invalid");
  }
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 120_000) {
    throw new Error("Clipboard expiry must be between 1 and 120 seconds");
  }
  const schedule = options.schedule ?? defaultSchedule;
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
      active = false;
      if (unchanged) await clipboard.setStringAsync("");
    } catch {
      // Clipboard access may disappear while the app backgrounds. Do not retry
      // indefinitely or surface OS clipboard contents in logs.
    } finally {
      active = false;
      if (copies.get(clipboard) === cancel) copies.delete(clipboard);
    }
  }, ttlMs);
  return cancel;
}

function defaultSchedule(task: () => void | Promise<void>, delayMs: number) {
  const handle = setTimeout(() => void task(), delayMs);
  return Object.freeze({ cancel: () => clearTimeout(handle) });
}

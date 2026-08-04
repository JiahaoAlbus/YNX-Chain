export type ClipboardAdapter = Readonly<{
  getStringAsync(): Promise<string>;
  setStringAsync(value: string): Promise<unknown>;
}>;

export type ClipboardSchedule = (
  task: () => void | Promise<void>,
  delayMs: number,
) => Readonly<{ cancel(): void }>;

const DEFAULT_TTL_MS = 30_000;

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
  let active = true;
  const scheduled = schedule(async () => {
    if (!active) return;
    active = false;
    try {
      if (await clipboard.getStringAsync() === value) await clipboard.setStringAsync("");
    } catch {
      // Clipboard access may disappear while the app backgrounds. Do not retry
      // indefinitely or surface OS clipboard contents in logs.
    }
  }, ttlMs);
  return () => {
    active = false;
    scheduled.cancel();
  };
}

function defaultSchedule(task: () => void | Promise<void>, delayMs: number) {
  const handle = setTimeout(() => void task(), delayMs);
  return Object.freeze({ cancel: () => clearTimeout(handle) });
}

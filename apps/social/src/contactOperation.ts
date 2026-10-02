// Cancelling a local wait does not revoke a request already received by a server.
export class ContactOperation {
  private active: { cancel: () => void } | null = null;

  cancel(): void {
    this.active?.cancel();
    this.active = null;
  }

  async run<T>(start: (signal: AbortSignal) => Promise<T>, timeoutMs = 30000): Promise<T> {
    if (this.active) throw new Error("A contact request is already being sent");
    const controller = new AbortController();
    let rejectWait!: (reason: Error) => void;
    const stopped = new Promise<never>((_, reject) => { rejectWait = reject; });
    const operation = {
      cancel: () => {
        rejectWait(new Error("Contact request wait cancelled; delivery is not confirmed"));
        controller.abort();
      },
    };
    this.active = operation;
    const timer = setTimeout(() => {
      rejectWait(new Error("Contact request timed out; delivery is not confirmed"));
      controller.abort();
    }, timeoutMs);
    try {
      // Race keeps the local flow bounded even if proof or transport ignores abort.
      return await Promise.race([start(controller.signal), stopped]);
    } finally {
      clearTimeout(timer);
      if (this.active === operation) this.active = null;
    }
  }
}

// Count observed playback time only. Seeking, paused playback and guest sessions
// cannot manufacture history. Failed writes retain elapsed time for a later retry.
export function createWatchProgress({send, signedIn, clock = () => performance.now()}) {
  let last = null;
  let pending = 0;
  let sending = null;
  let discarded = false;
  return {
    sample({position, paused, seeking, rate = 1}) {
      const now = clock();
      if (!signedIn() || paused || seeking || !Number.isFinite(position)) {last = null; return;}
      if (last) {
        const elapsed = Math.max(0, (now - last.at) / 1000);
        const progress = position - last.position;
        if (elapsed <= 3 && progress > 0 && progress <= elapsed * Math.max(1, rate) + 0.5) {
          pending += Math.min(progress, elapsed);
        }
      }
      last = {position, at: now};
    },
    resetSample() {last = null;},
    discard() {discarded = true; pending = 0; last = null;},
    flush(completed = false) {
      if (sending) return sending;
      const seconds = Math.floor(pending);
      if (discarded || !signedIn() || seconds < 1) return Promise.resolve();
      sending = (async () => {
        await send({seconds, completed});
        if (!discarded) pending = Math.max(0, pending - seconds);
      })().finally(() => {sending = null;});
      return sending;
    },
  };
}

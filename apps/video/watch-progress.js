// Count observed playback time only. Seeking, paused playback and guest sessions
// cannot manufacture history. Failed writes retain elapsed time; UNKNOWN
// batches await original-result confirmation instead of another dispatch.
export function createWatchProgress({send, signedIn, onError = () => {}, clock = () => performance.now(), idFactory = () => crypto.randomUUID()}) {
  const checkpointSeconds = 15;
  const playbackID = idFactory();
  let last = null;
  let pending = 0;
  let sending = null;
  let discarded = false;
  let observed = false;
  let completionRequested = false;
  let completionRecorded = false;
  let flushRequested = false;
  let batch = null;
  let observedSeconds = 0;
  let lastAutomaticAttempt = 0;
  let automaticFlight = null;
  let unconfirmed = null;
  const tracker = {
    sample({position, paused, seeking, rate = 1}) {
      const now = clock();
      if (discarded || !signedIn() || paused || seeking || !Number.isFinite(position)) {last = null; return;}
      if (last) {
        const elapsed = Math.max(0, (now - last.at) / 1000);
        const progress = position - last.position;
        if (elapsed <= 3 && progress > 0 && progress <= elapsed * Math.max(1, rate) + 0.5) {
          const duration = Math.min(progress, elapsed);
          pending += duration;
          observedSeconds += duration;
          if (duration > 0) observed = true;
        }
      }
      last = {position, at: now};
      // Playback observations earn checkpoints. A retained failed batch alone
      // cannot cause a retry on every timeupdate or while playback is paused.
      if (!unconfirmed && pending >= checkpointSeconds && observedSeconds - lastAutomaticAttempt >= checkpointSeconds) {
        lastAutomaticAttempt = observedSeconds;
        const operation = tracker.flush(false);
        if (operation !== automaticFlight) {
          automaticFlight = operation;
          void operation.catch(async error => {
            if (discarded || !signedIn()) return;
            try {await onError(error);} catch { /* An optional UI callback cannot reject a background save. */ }
          }).finally(() => {if (automaticFlight === operation) automaticFlight = null;});
        }
      }
    },
    resetSample() {last = null;},
    discard() {discarded = true; pending = 0; last = null; batch = null; completionRequested = false; flushRequested = false;},
    flush(completed = false) {
      if (discarded || !signedIn()) return Promise.resolve();
      if (unconfirmed) return Promise.reject(unconfirmed);
      if (completed && observed && !completionRecorded) completionRequested = true;
      flushRequested = true;
      if (sending) return sending;
      sending = Promise.resolve().then(async () => {
        while (flushRequested && !discarded && signedIn()) {
          flushRequested = false;
          if (!batch) {
            const seconds = Math.floor(pending);
            if (seconds < 1 && !completionRequested) return;
            batch = Object.freeze({
              body: Object.freeze({playback_id: playbackID, seconds, completed: completionRequested}),
              idempotencyKey: idFactory(),
            });
          }
          // Keep this exact body and key. An UNKNOWN result pauses this tracker;
          // only a confirmed pre-dispatch failure can be tried again normally.
          const active = batch;
          try {await send(active.body, Object.freeze({idempotencyKey: active.idempotencyKey}));}
          catch(error){if(error.code==='VIDEO_MUTATION_UNKNOWN')unconfirmed=error;throw error;}
          if (discarded) return;
          pending = Math.max(0, pending - active.body.seconds);
          batch = null;
          if (active.body.completed) {
            completionRecorded = true;
            completionRequested = false;
          }
          // A terminal event can arrive while an ordinary flush is in flight.
          // The playback record accepts its final marker without another view.
          if (completionRequested || pending >= checkpointSeconds) flushRequested = true;
        }
      }).finally(() => {sending = null;});
      return sending;
    },
  };
  return tracker;
}

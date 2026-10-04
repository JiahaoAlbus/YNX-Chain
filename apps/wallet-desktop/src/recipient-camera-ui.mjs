/** A camera owns public frames and one Send input intent, never key access. */
export function createRecipientCameraUI({getContext, begin, end, openStream, attach, detach,
  capture, decode, apply, report, schedule = (fn, delay = 500) => setTimeout(fn, delay), cancel = clearTimeout,
  now = Date.now}) {
  let generation = 0, current = null, frameInFlight = false, frameWaiter = null;
  const stopTracks = stream => {for (const track of stream?.getTracks?.() ?? []) {try {track.stop();} catch {}}};
  function stop() {
    generation++;
    const old = current; current = null; frameWaiter = null;
    if (!old) return;
    cancel(old.timer); cancel(old.expiry); stopTracks(old.stream); detach();
    if (old.permit) void Promise.resolve().then(() => end(old.permit)).catch(() => {});
  }
  function live(job) {
    const after = getContext();
    return current === job && generation === job.generation && now() < job.deadline &&
      after.open && !after.locked && after.focused && after.account === job.before.account &&
      after.keyRevision === job.before.keyRevision && after.draftRevision === job.before.draftRevision;
  }
  async function frame(job) {
    if (!live(job)) {if (current === job) stop(); return;}
    // Stop retires an intent, not an unresolved capture/IPC promise. Keep one
    // controller-wide slot until actual completion, with only the latest waiter.
    if (frameInFlight) {frameWaiter = job; return;}
    frameInFlight = true;
    try {
      const image = await capture();
      if (!live(job)) {if (current === job) stop(); return;}
      if (image) {
        const result = await decode(image);
        if (!live(job)) {if (current === job) stop(); return;}
        if (result?.ok === true && typeof result.value?.ynxAccount === "string" &&
            result.value.chainId === "ynx_6423-1" && result.value.asset === "YNXT") {
          const address = result.value.ynxAccount;
          stop();
          // Original recipient parser remains the authority for checksum/network.
          await apply(address);
          return;
        }
      }
    } catch {
      if (!live(job)) {if (current === job) stop(); return;}
      // A frame with no usable QR is normal; never dispatch overlapping decodes.
    } finally {
      frameInFlight = false;
      const waiter = frameWaiter; frameWaiter = null;
      if (waiter && live(waiter)) void frame(waiter);
      else if (waiter && current === waiter) stop();
      else if (live(job)) job.timer = schedule(() => void frame(job), 500);
      else if (current === job) stop();
    }
  }
  async function start() {
    stop();
    const before = getContext();
    if (!before.open || before.locked || !before.focused || !before.account) return;
    const job = {before: {...before}, generation, deadline: now() + 60_000}; current = job;
    job.expiry = schedule(() => {
      if (current !== job) return;
      const after = getContext(), unchanged = after.open && after.account === before.account && after.keyRevision === before.keyRevision && after.draftRevision === before.draftRevision;
      stop(); if (unchanged) report("Camera unavailable. Use a QR image or paste a receiving link.");
    }, 60_000);
    report("Opening camera…");
    try {
      const permit = await begin();
      if (permit?.ok !== true || typeof permit.value?.id !== "string") throw new Error("Camera unavailable");
      if (!live(job)) {void Promise.resolve().then(() => end(permit.value.id)).catch(() => {}); if (current === job) stop(); return;}
      job.permit = permit.value.id;
      const stream = await openStream();
      if (!live(job)) {stopTracks(stream); if (current === job) stop(); return;}
      job.stream = stream;
      for (const track of stream.getTracks()) track.addEventListener?.("ended", () => {
        if (current !== job) return;
        const active = live(job); stop();
        if (active) report("Camera unavailable. Use a QR image or paste a receiving link.");
      }, {once: true});
      await attach(stream);
      if (!live(job)) {if (current === job) stop(); return;}
      report("Point the camera at a YNX receiving code.");
      void frame(job);
    } catch {
      if (live(job)) {stop(); report("Camera unavailable. Use a QR image or paste a receiving link.");}
      else if (current === job) stop();
    }
  }
  return Object.freeze({start, stop});
}

/** Encode bounded local camera pixels through the existing PNG/IPC decoder. */
export async function captureRecipientFrame(video, canvas) {
  const width = video.videoWidth, height = video.videoHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || video.readyState < 2) return null;
  const scale = Math.min(1, 720 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d"); if (!context) throw new Error("Camera unavailable");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob || blob.type !== "image/png" || blob.size < 1 || blob.size > 10 * 1024 * 1024) throw new Error("Invalid camera frame");
  const bytes = await blob.arrayBuffer();
  if (bytes.byteLength !== blob.size) throw new Error("Invalid camera frame");
  return {bytes, mimeType: "image/png"};
}

import {setWalletCopy} from './wallet-locale.mjs';
let activeStop=null;
/** A camera owns public frames and one Send input intent, never key access. */
export function createRecipientCameraUI({getContext, begin, end, openStream, attach, detach,
  capture, decode, apply, report, schedule = (fn, delay = 500) => setTimeout(fn, delay), cancel = clearTimeout,
  now = Date.now,target='ynx',aimMessage='Point the camera at a YNX receiving code.',unavailableMessage='Camera unavailable. Use a QR image or paste a receiving link.'}) {
  let generation = 0, current = null, frameInFlight = false, frameWaiter = null;
  const stopTracks = stream => {for (const track of stream?.getTracks?.() ?? []) {try {track.stop();} catch {}}};
  function stop() {
    if(activeStop===stop)activeStop=null;
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
      after.keyRevision === job.before.keyRevision && after.draftRevision === job.before.draftRevision &&
      after.networkId===job.before.networkId && after.configRevision===job.before.configRevision;
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
        if(result?.ok===false&&['FAMILY_CUSTODY_CONFLICT','FAMILY_RECIPIENT_CHANGED','EVM_RECIPIENT_CHANGED'].includes(result.error?.code)){
          stop();report(result.error.code);return;
        }
        const value=result?.ok===true?result.value:null,c=getContext();
        const address=target==='ynx'?value?.chainId==='ynx_6423-1'&&value.asset==='YNXT'&&typeof value.ynxAccount==='string'&&value.ynxAccount
          :target==='evm'?value?.family==='evm'&&value.networkId===c.networkId&&value.configRevision===c.configRevision&&value.networkVerified===false&&/^0x[a-f0-9]{40}$/.test(value.account??'')&&!/^0x0{40}$/.test(value.account)&&value.account
          :['bitcoin','tron'].includes(target)?value?.family===target&&value.network===c.networkId&&value.networkVerified===false&&(target==='bitcoin'?/^(bc1|tb1)[a-z0-9]+$/.test(value.account??''):/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value.account??''))&&value.account:false;
        if (address) {
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
    if(activeStop&&activeStop!==stop)activeStop();
    stop();
    const before = getContext();
    if (!before.open || before.locked || !before.focused || !before.account) return;
    activeStop=stop;
    const job = {before: {...before}, generation, deadline: now() + 60_000}; current = job;
    job.expiry = schedule(() => {
      if (current !== job) return;
      const after = getContext(), unchanged = after.open && after.account === before.account && after.keyRevision === before.keyRevision && after.draftRevision === before.draftRevision && after.networkId===before.networkId && after.configRevision===before.configRevision;
      stop(); if (unchanged) report(unavailableMessage);
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
        if (active) report(unavailableMessage);
      }, {once: true});
      await attach(stream);
      if (!live(job)) {if (current === job) stop(); return;}
      report(aimMessage);
      void frame(job);
    } catch {
      if (live(job)) {stop(); report(unavailableMessage);}
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

/** Existing camera controller/permit/capture wired to one ordinary Send region.
 * Construction never opens a device; only an explicit click may request video. */
export function createRecipientCameraControls({document:doc,parent,api,target,getContext,onStart,decode,apply,report}){
  const make=(tag,key)=>{const n=doc.createElement(tag);if(key)setWalletCopy(n,key);return n};
  const start=make('button','Start camera'),stop=make('button','Stop camera'),video=make('video'),canvas=make('canvas'),hint=make('p','Camera frames stay on this device. Scanning fills only the recipient.');
  start.type=stop.type='button';start.setAttribute('id',target+'-send-camera-start');stop.setAttribute('id',target+'-send-camera-stop');
  video.hidden=true;video.muted=true;video.playsInline=true;video.setAttribute('aria-label',target.toUpperCase()+' QR');parent.append(start,stop,video,hint);
  const view=doc.defaultView,context=()=>({...getContext(),focused:doc.hasFocus?.()===true&&doc.visibilityState==='visible'});
  const message=key=>report(key,{family:target==='bitcoin'?'BTC':target.toUpperCase()});
  const controller=createRecipientCameraUI({target,getContext:context,begin:()=>api.beginRecipientCamera(),end:id=>api.endRecipientCamera(id),
    openStream:()=>view.navigator.mediaDevices.getUserMedia({video:{width:{ideal:720},height:{ideal:720}},audio:false}),
    attach:async stream=>{video.srcObject=stream;video.hidden=false;await video.play()},
    detach:()=>{video.pause();video.srcObject=null;video.hidden=true;canvas.width=canvas.height=1},
    capture:()=>captureRecipientFrame(video,canvas),decode,apply,report:message,
    aimMessage:'Point the camera at a {family} receiving code. Verify the selected network.',
    unavailableMessage:'Camera unavailable. Use a QR image or enter the address.'});
  function update(){const c=context();start.disabled=!c.open||c.locked||!c.focused||!c.account||typeof api.paymentQR!=='function'||typeof api.beginRecipientCamera!=='function'||typeof api.endRecipientCamera!=='function'||typeof view?.navigator?.mediaDevices?.getUserMedia!=='function';stop.disabled=start.disabled;if(start.disabled)controller.stop()}
  start.addEventListener('click',()=>{update();if(start.disabled)return;onStart();return controller.start()});
  stop.addEventListener('click',()=>{controller.stop();message('Camera stopped.')});
  view?.addEventListener?.('blur',controller.stop);view?.addEventListener?.('pagehide',controller.stop);
  doc.addEventListener?.('visibilitychange',()=>{if(doc.visibilityState!=='visible')controller.stop()});
  update();return Object.freeze({stop:controller.stop,update});
}

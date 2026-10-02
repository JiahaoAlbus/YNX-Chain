function release(stream){for(const track of stream?.getTracks()??[])track.stop()}

// Owns only a local camera stream. It never navigates, authorizes or submits.
export class CameraQRSession{
  constructor(options){this.options=options;this.epoch=0;this.stream=null;this.frameId=null}
  stop(){this.epoch++;if(this.frameId!==null)this.options.cancel(this.frameId);this.frameId=null;release(this.stream);this.stream=null;this.options.detach()}
  async start(){
    this.stop();const epoch=this.epoch;
    try{
      if(!this.options.isCurrent())return;
      const detector=await this.options.detector();
      if(epoch!==this.epoch||!this.options.isCurrent())return;
      this.options.status('Allow camera access to scan a personal Social QR.');
      const stream=await this.options.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
      if(epoch!==this.epoch||!this.options.isCurrent()){release(stream);return}
      this.stream=stream;await this.options.attach(stream);
      if(epoch!==this.epoch)return;
      if(!this.options.isCurrent()){this.stop();return}
      this.options.status('Point the camera at the personal Social QR.');
      this.queue(epoch,detector);
    }catch(error){
      if(epoch!==this.epoch)return;
      this.stop();
      this.options.status(error?.name==='NotAllowedError'?'Camera access was denied. Allow it in browser settings, then retry.':error?.name==='NotFoundError'?'No camera was found. Connect a camera or use QR content.':error?.name==='NotSupportedError'?'QR scanning is unavailable in this browser. Use QR content or an invitation link.':'Camera scanning could not start. Retry or cancel.');
    }
  }
  queue(epoch,detector){this.frameId=this.options.schedule(()=>this.frame(epoch,detector))}
  async frame(epoch,detector){
    if(epoch!==this.epoch)return;
    this.frameId=null;
    if(!this.options.isCurrent()){this.stop();return}
    try{
      const codes=await detector.detect(this.options.video);
      if(epoch!==this.epoch)return;
      if(!this.options.isCurrent()){this.stop();return}
      const value=codes.find(code=>typeof code.rawValue==='string'&&code.rawValue.length>0&&code.rawValue.length<=2048)?.rawValue;
      if(value){this.stop();this.options.result(value);return}
      this.queue(epoch,detector);
    }catch{
      if(epoch!==this.epoch)return;
      this.stop();this.options.status('The QR could not be read. Retry or use QR content.');
    }
  }
}

// Called only by the explicit Scan QR button; camera permission is not probed.
export function scanContactQR(document,environment,isCurrent){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog'),heading=document.createElement('h3'),video=document.createElement('video'),status=document.createElement('p'),retry=document.createElement('button'),cancel=document.createElement('button');
    dialog.className='contact-camera';heading.textContent='Scan a personal Social QR';video.muted=true;video.playsInline=true;video.style.width='100%';video.style.maxWidth='32rem';video.style.maxHeight='50vh';video.setAttribute('aria-label','Local camera preview');status.setAttribute('role','status');retry.type='button';retry.textContent='Retry camera';cancel.type='button';cancel.textContent='Cancel';cancel.autofocus=true;
    let settled=false;
    const scanner=new CameraQRSession({
      mediaDevices:environment.navigator.mediaDevices,video,isCurrent:()=>!settled&&isCurrent(),
      detector:async()=>{if(!environment.isSecureContext||!environment.navigator.mediaDevices?.getUserMedia||!environment.BarcodeDetector)throw new DOMException('QR scanning unavailable','NotSupportedError');return new environment.BarcodeDetector({formats:['qr_code']})},
      attach:async stream=>{video.srcObject=stream;await video.play()},detach:()=>{video.pause();video.srcObject=null},
      schedule:callback=>environment.requestAnimationFrame(callback),cancel:id=>environment.cancelAnimationFrame(id),status:text=>{status.textContent=text},result:value=>finish(value)
    });
    function finish(value){if(settled)return;const current=isCurrent();settled=true;scanner.stop();document.removeEventListener('visibilitychange',hidden);environment.removeEventListener('pagehide',leave);dialog.close();dialog.remove();resolve(current?value:null)}
    function hidden(){if(document.visibilityState==='hidden')finish(null)}
    function leave(){finish(null)}
    retry.addEventListener('click',()=>void scanner.start());cancel.addEventListener('click',()=>finish(null));dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null)});dialog.addEventListener('close',()=>finish(null));document.addEventListener('visibilitychange',hidden);environment.addEventListener('pagehide',leave);
    dialog.append(heading,video,status,retry,cancel);document.body.append(dialog);
    if(!isCurrent()){finish(null);return}dialog.showModal();cancel.focus();void scanner.start();
  });
}

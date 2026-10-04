import {captureRecipientFrame} from "../src/recipient-camera-ui.mjs";
const preview=document.querySelector("#video"),canvas=document.querySelector("#frame");
try {
 for(const [mode,audio,video,expected] of [
  ["no-permit",false,true,false],["valid",false,true,true],
  ["valid",true,false,false],["valid",true,true,false],
  ["expired",false,true,false],["account",false,true,false],
  ["revision",false,true,false],["locked",false,true,false],
  ["unfocused",false,true,false],["authenticating",false,true,false],
  ["changing",false,true,false],["end",false,true,false],
  ["invalidate",false,true,false],["retired-end",false,true,true]]){
  const prepared=await window.permissionQA.prepare(mode);let stream,error=null,accepted=false,stopped=true,captured=false;
  try{stream=await navigator.mediaDevices.getUserMedia({audio,video});accepted=true;
   preview.srcObject=stream;await preview.play();let encoded;
   for(let attempt=0;attempt<50&&!encoded;attempt++){await new Promise(resolve=>setTimeout(resolve,20));encoded=await captureRecipientFrame(preview,canvas);}
   if(!encoded)throw Error("No software-device frame");
   const result=await window.permissionQA.frame(encoded);
   if(result.rejected!==true||result.code!=="QR_DECODE_FAILED")throw Error("Unexpected software-device decode");
   captured=true;
  }
  catch(caught){error=caught.name;}
  finally{for(const track of stream?.getTracks()??[]){track.stop();stopped&&=track.readyState==="ended";}preview.pause();preview.srcObject=null;}
  const kinds=stream?.getTracks().map(track=>track.kind)??[];
  const pass=accepted===expected&&stopped&&(!accepted||(captured&&kinds.length===1&&kinds[0]==="video"));
  window.permissionQA.row({mode,audio,video,expected,accepted,error,stopped,kinds,captured,callbackOffset:prepared.callbackOffset,pass});
  if(!pass)throw Error(`Unexpected media result ${mode} audio=${audio} video=${video}: ${accepted} ${error}`);
 }
 window.permissionQA.done({ok:true});
}catch(error){window.permissionQA.done({ok:false,error:error.message});}

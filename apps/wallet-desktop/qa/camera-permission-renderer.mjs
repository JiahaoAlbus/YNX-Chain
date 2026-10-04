try {
 for(const [mode,audio,video,expected] of [
  ["no-permit",false,true,false],["valid",false,true,true],
  ["valid",true,false,false],["valid",true,true,false],
  ["expired",false,true,false],["account",false,true,false],
  ["revision",false,true,false],["locked",false,true,false],
  ["unfocused",false,true,false],["authenticating",false,true,false],
  ["changing",false,true,false],["end",false,true,false],
  ["invalidate",false,true,false],["retired-end",false,true,true]]){
  const prepared=await window.permissionQA.prepare(mode);let stream,error=null,accepted=false,stopped=true;
  try{stream=await navigator.mediaDevices.getUserMedia({audio,video});accepted=true;}
  catch(caught){error=caught.name;}
  finally{for(const track of stream?.getTracks()??[]){track.stop();stopped&&=track.readyState==="ended";}}
  const kinds=stream?.getTracks().map(track=>track.kind)??[];
  const pass=accepted===expected&&stopped&&(!accepted||(kinds.length===1&&kinds[0]==="video"));
  window.permissionQA.row({mode,audio,video,expected,accepted,error,stopped,kinds,callbackOffset:prepared.callbackOffset,pass});
  if(!pass)throw Error(`Unexpected media result ${mode} audio=${audio} video=${video}: ${accepted} ${error}`);
 }
 window.permissionQA.done({ok:true});
}catch(error){window.permissionQA.done({ok:false,error:error.message});}

import {captureRecipientFrame} from "../src/recipient-camera-ui.mjs";
const video=document.querySelector("#video"),source=document.querySelector("#source"),frame=document.querySelector("#frame");
let stream,drawTimer;
try {
  window.frameQA.stage("renderer ready");
  const fixture=await window.frameQA.fixture();
  for (const [width,height,blank=false] of [[512,512],[1440,900],[512,512,true]]) {
    source.width=width;source.height=height;
    const context=source.getContext("2d"),scale=Math.floor(Math.min(width,height)/(fixture.size+8)),side=scale*(fixture.size+8);
    const left=Math.floor((width-side)/2),top=Math.floor((height-side)/2);
    const draw=()=>{context.fillStyle="#FFFFFF";context.fillRect(0,0,width,height);context.fillStyle="#002FA7";
      if(!blank)for(let y=0;y<fixture.size;y++)for(let x=0;x<fixture.size;x++)if(fixture.modules[y*fixture.size+x])context.fillRect(left+(x+4)*scale,top+(y+4)*scale,scale,scale);};
    draw();stream=source.captureStream(10);drawTimer=setInterval(draw,100);video.srcObject=stream;window.frameQA.stage(`stream ${width}x${height}`);await video.play();window.frameQA.stage("video playing");
    let encoded;for(let attempt=0;attempt<50&&!encoded;attempt++){await new Promise(resolve=>setTimeout(resolve,20));encoded=await captureRecipientFrame(video,frame);}
    if(!encoded)throw Error("No synthetic video frame");
    const result=await window.frameQA.decode({...encoded,expectedReject:blank});if(blank?!result.rejected:result.text!==fixture.uri)throw Error("Wrong original decode result");
    clearInterval(drawTimer);for(const track of stream.getTracks()){track.stop();if(track.readyState!=="ended")throw Error("Synthetic track did not stop");}video.pause();video.srcObject=null;stream=null;
  }
  window.frameQA.done({ok:true});
}catch(error){window.frameQA.done({ok:false,error:error.message});}
finally{clearInterval(drawTimer);for(const track of stream?.getTracks()??[])track.stop();video.pause();video.srcObject=null;}

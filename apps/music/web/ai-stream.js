// Decode Music's own token/done stream. A done frame is only a transport signal;
// the authenticated proposal readback remains the authority for completion.
export function createMusicAIStream(onText) {
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',bytes=0,event='',data=null,text='',done=false;
  const invalid=()=>new Error('The AI stream was interrupted or invalid. Check the saved result.');
  function frame(){
    if(!event&&data===null)return;
    if(done||data===null)throw invalid();
    const value=JSON.parse(data);
    if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
    if(event==='token'){
      if(Object.keys(value).length!==1||typeof value.text!=='string')throw invalid();
      text+=value.text;if(new TextEncoder().encode(text).length>12000)throw invalid();
      onText(text);
    }else if(event==='done'&&Object.keys(value).length===0)done=true;
    else throw invalid();
    event='';data=null;
  }
  function line(raw){
    const value=raw.endsWith('\r')?raw.slice(0,-1):raw;
    if(!value){frame();return;}
    if(value.startsWith(':'))return;
    const at=value.indexOf(':');if(at<0)throw invalid();
    const field=value.slice(0,at),content=value.slice(at+1).replace(/^ /,'');
    if(field==='event'&&!event)event=content;
    else if(field==='data'&&data===null)data=content;
    else throw invalid();
  }
  function consume(){let at;while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at));buffer=buffer.slice(at+1);}}
  return {
    push(chunk){bytes+=chunk.byteLength;if(bytes>128*1024)throw invalid();buffer+=decoder.decode(chunk,{stream:true});consume();},
    finish(){buffer+=decoder.decode();consume();if(buffer)line(buffer);buffer='';frame();if(!done)throw invalid();return text;}
  };
}

// Native WebKit transport only. Status is DATA, never an identity/session grant.
(()=>{
  if(location.pathname!=='/')return;
  const jobs=new Map(),document=crypto.randomUUID();
  Object.defineProperty(window,'__ynxIdentityDocument',{value:document});
  const send=(action,id)=>window.webkit.messageHandlers.ynxLocalWallet.postMessage({action,id,document});
  const cancel=id=>{try{send('native-identity-cancel',id);}catch{}};
  const finish=(id,error,value)=>{
    const job=jobs.get(id);if(!job)return;
    jobs.delete(id);clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);
    // Retire this request's retained backend result/owner after status delivery.
    cancel(id);error?job.reject(error):job.resolve(value);
  };
  Object.defineProperty(window,'__ynxIdentityReply',{value:event=>{
    if(event?.document!==document||!jobs.has(event.id))return;
    if(event.error){
      // Only the exact Native failure after original correlation/current checks
      // means user cancellation. Other failures keep their original error path.
      finish(event.id,event.error==='AUTH_IDENTITY_PEER_USER_CANCELLED'
        ?new DOMException('Cancelled by Wallet user','AbortError')
        :new Error('Native identity request failed: '+event.error));return;
    }
    if(event.phase!=='response-received'||event.authorized!==false||event.dataOnly!==true)return;
    finish(event.id,null,Object.freeze({phase:'response-received',authorized:false,dataOnly:true}));
  }});
  const run=(kind,options={})=>new Promise((resolve,reject)=>{
    if(options.signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
    if(jobs.size){reject(new Error('A native identity request is already active'));return;}
    const id=crypto.randomUUID(),signal=options.signal;
    const abort=()=>finish(id,new DOMException('Cancelled','AbortError'));
    const timer=setTimeout(()=>finish(id,new Error('Native identity request timed out; no automatic retry')),60000);
    jobs.set(id,{resolve,reject,signal,abort,timer});signal?.addEventListener('abort',abort,{once:true});
    try{send('native-identity-'+kind,id);}catch(error){finish(id,error);}
  });
  Object.defineProperty(window,'ynxDesktopIdentity',{value:Object.freeze({receive:options=>run('receive',options),recover:options=>run('recover',options)})});
  addEventListener('pagehide',()=>{for(const id of [...jobs.keys()])finish(id,new Error('Native identity document retired'));},{once:true});
})();

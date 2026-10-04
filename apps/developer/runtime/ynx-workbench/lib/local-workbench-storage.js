const {uiKey} = require('./local-workbench-storage-keys');
class LocalWorkbenchStorage {
  constructor(fallback,api,messages,target=window){this.fallback=fallback;this.api=api;this.messages=messages;this.target=target;this.pending=new Set();this.failure=undefined;this.reported=false;}
  isLocal(){return Boolean(this.target.webkit?.messageHandlers?.ynxLocalWorkbench);}
  report(error){this.failure=error;if(!this.reported){this.reported=true;try{Promise.resolve(this.messages.error('Your local workspace layout could not be saved or restored. Existing saved data was kept. '+(error.message||error))).catch(()=>{});}catch{}}throw error;}
  track(job){this.pending.add(job);job.then(()=>this.pending.delete(job),()=>this.pending.delete(job));return job;}
  setData(key,data){if(!this.isLocal()||!uiKey(key))return this.fallback.setData(key,data);const job=this.api.setData(key,data===undefined?null:data,data===undefined).catch(error=>this.report(error));return this.track(job);}
  async getData(key,defaultValue){if(!this.isLocal()||!uiKey(key))return this.fallback.getData(key,defaultValue);try{const row=await this.api.getData(key);return row.found?row.value:defaultValue;}catch(error){return this.report(error);}}
  async flush(){await Promise.all([...this.pending]);if(this.failure)throw this.failure;if(this.isLocal())try{await this.api.flush();}catch(error){return this.report(error);}}
}
module.exports={LocalWorkbenchStorage};

const fs = require('node:fs/promises');
const {join,resolve,isAbsolute} = require('node:path');
const {pathToFileURL} = require('node:url');
const {createHash,randomUUID} = require('node:crypto');
const {uiKey,UI_KEYS} = require('./local-workbench-storage-keys');
const MAX_FILE=4*1024*1024, MAX_VALUE=1024*1024, MAX_KEYS=256;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => Error(message + ' Existing local layout data was retained.');
class LocalWorkbenchStorageStore {
  constructor(environment=process.env) { this.mode=environment.YNX_WORKSPACE_MODE; this.workspace=environment.YNX_LOCAL_WORKSPACE; this.profile=environment.YNX_LOCAL_PROFILE; this.projectId=environment.YNX_LOCAL_PROJECT_ID; this.theiaProfile=environment.THEIA_CONFIG_DIR; this.serial=Promise.resolve(); }
  async scope() {
    if(this.mode!=='local'||this.theiaProfile!==this.profile||!this.projectId?.match(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/))throw fail('Local layout profile is not bound.');
    for(const path of [this.workspace,this.profile]) {if(!path||!isAbsolute(path)||resolve(path)!==path||await fs.realpath(path)!==path)throw fail('Local layout path changed.');const s=await fs.lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw fail('Invalid local layout directory.');if(path===this.profile&&(s.uid!==process.getuid()||(s.mode&0o077)))throw fail('Local layout profile is not private.');}
    const binding=join(this.profile,'ynx-local-project.json');await this.regular(binding,16384,true);
    const value=JSON.parse(await fs.readFile(binding,'utf8'));
    if(value.schemaVersion!==1||value.projectId!==this.projectId||value.workspace!==this.workspace||value.profile!==this.profile)throw fail('Local layout project binding changed.');
    return join(this.profile,'ynx-workbench-ui-v1.json');
  }
  async regular(path,limit=MAX_FILE,allowBindingLinks=false) {const s=await fs.lstat(path);if(!s.isFile()||s.isSymbolicLink()||(!allowBindingLinks&&s.nlink!==1)||s.uid!==process.getuid()||(s.mode&0o077)||s.size>limit||await fs.realpath(path)!==path)throw fail('Local layout file changed or exceeds its limit.');return s;}
  key(key) {
    if(!uiKey(key)||!UI_KEYS.has(key)&&!['_global_:',pathToFileURL(this.workspace).href+':'].some(prefix=>key.startsWith(prefix)))throw fail('Only this project’s workbench presentation state can be stored.');
  }
  async load(path) {
    let bytes;try{await this.regular(path);bytes=await fs.readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return {entries:Object.create(null),previous:null};throw e;}
    let envelope;try{envelope=JSON.parse(bytes);}catch{throw fail('Saved local layout is damaged.');}
    const data=envelope?.data;
    if(data?.schemaVersion!==1||data.projectId!==this.projectId||data.workspace!==this.workspace||!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries)||sha(JSON.stringify(data))!==envelope.sha256||Object.keys(data.entries).length>MAX_KEYS)throw fail('Saved local layout is damaged or belongs to another project.');
    for(const [key,value] of Object.entries(data.entries)){this.key(key);if(Buffer.byteLength(JSON.stringify(value))>MAX_VALUE)throw fail('Saved local layout exceeds its limit.');}
    return {entries:data.entries,previous:sha(bytes)};
  }
  operation(task){const result=this.serial.then(task);this.serial=result.catch(()=>{});return result;}
  getData(key){return this.operation(async()=>{const path=await this.scope();this.key(key);const {entries}=await this.load(path);return Object.hasOwn(entries,key)?{found:true,value:entries[key]}:{found:false};});}
  setData(key,value,remove=false){return this.operation(async()=>{
    if(typeof remove!=='boolean')throw fail('Local layout removal flag is invalid.');
    const path=await this.scope();this.key(key);const state=await this.load(path), entries=Object.assign(Object.create(null),state.entries);
    if(remove)delete entries[key];else{const serialized=JSON.stringify(value);if(serialized===undefined||Buffer.byteLength(serialized)>MAX_VALUE)throw fail('Local layout value exceeds its limit.');entries[key]=JSON.parse(serialized);}
    if(Object.keys(entries).length>MAX_KEYS)throw fail('Local layout contains too many entries.');
    const data={schemaVersion:1,projectId:this.projectId,workspace:this.workspace,entries};const bytes=JSON.stringify({data,sha256:sha(JSON.stringify(data))});if(Buffer.byteLength(bytes)>MAX_FILE)throw fail('Local layout archive exceeds its limit.');
    const pending=join(this.profile,`.ynx-ui-pending-${randomUUID()}`);const handle=await fs.open(pending,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    await this.scope();let current=null;try{await this.regular(path);current=sha(await fs.readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(current!==state.previous)throw fail('Local layout changed during saving.');
    await fs.rename(pending,path);const directory=await fs.open(this.profile,'r');try{await directory.sync();}catch(e){if(!['EINVAL','ENOTSUP','EISDIR','EPERM'].includes(e.code))throw e;}finally{await directory.close();}
  });}
  flush(){return this.operation(async()=>{await this.load(await this.scope());});}
}
module.exports={LocalWorkbenchStorageStore,MAX_FILE,MAX_VALUE,MAX_KEYS};

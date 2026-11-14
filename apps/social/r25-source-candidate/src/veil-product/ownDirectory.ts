/** Device-directory DATA presentation only; never authorizes device/session actions. */
export type OwnDirectoryAction = 'read' | 'observe' | 'close';
export type DirectoryRow = Readonly<{device:string;generation:string;registrationSHA256:string;state:'committed'|'revoked'}>;
export type DirectoryData = Readonly<{realm:string;epoch:string;sequence:string;headSHA256:string;rootSHA256:string;devices:readonly DirectoryRow[]}>;
export type DirectoryResult = Readonly<{version:1;state:'NOT_REQUESTED'|'OBSERVED'|'RETAINED'|'CLOSING'|'CLOSED'|'CLOSED_ERROR'|'UNAVAILABLE';accountViewRef:string|null;data:DirectoryData|null;firstFailureRetained:boolean}>;
export type OwnDirectoryModule = {observeOwnDeviceDirectory(action:OwnDirectoryAction):Promise<unknown>};
function exact(raw:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![null,Object.prototype].includes(Object.getPrototypeOf(raw)))throw Error('DIRECTORY_SHAPE');
 const d=Object.getOwnPropertyDescriptors(raw),actual=Reflect.ownKeys(d);
 if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)))throw Error('DIRECTORY_KEYS');
 const out:Record<string,unknown>={};for(const k of keys){const v=d[k];if(!v?.enumerable||!Object.hasOwn(v,'value'))throw Error('DIRECTORY_ACCESSOR');out[k]=v.value;}return out;
}
const counter=(v:unknown,positive=false):string=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n||(positive&&v==='0'))throw Error('DIRECTORY_COUNTER');return v;};
const hex=(v:unknown):string=>{if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))throw Error('DIRECTORY_DIGEST');return v;};
export function decodeDirectory(raw:string):DirectoryData{
 if(raw.length<1||raw.length>4*1024*1024)throw Error('DIRECTORY_BYTES');
 const v=exact(JSON.parse(raw),['realm','epoch','sequence','headSHA256','rootSHA256','devices']);
 if(typeof v.realm!=='string'||!v.realm||v.realm.length>4096||!Array.isArray(v.devices)||v.devices.length<1||v.devices.length>4096)throw Error('DIRECTORY_BOUND');
 const rows:DirectoryRow[]=[];
 for(const item of v.devices){const r=exact(item,['device','generation','registrationSHA256','state']);if(typeof r.device!=='string'||!/^[!-~]{1,128}$/.test(r.device)||(r.state!=='committed'&&r.state!=='revoked'))throw Error('DIRECTORY_ROW');
 const row=Object.freeze({device:r.device,generation:counter(r.generation,true),registrationSHA256:hex(r.registrationSHA256),state:r.state});const previous=rows.at(-1);
 if(previous&&(previous.device>row.device||(previous.device===row.device&&BigInt(previous.generation)>=BigInt(row.generation))))throw Error('DIRECTORY_ORDER');rows.push(row);}
 return Object.freeze({realm:v.realm,epoch:counter(v.epoch),sequence:counter(v.sequence),headSHA256:hex(v.headSHA256),rootSHA256:hex(v.rootSHA256),devices:Object.freeze(rows)});
}
export function decodeDirectoryResult(raw:unknown):DirectoryResult{
 const r=exact(raw,['version','state','accountViewRef','data','firstFailureRetained']);
 const states=['NOT_REQUESTED','OBSERVED','RETAINED','CLOSING','CLOSED','CLOSED_ERROR','UNAVAILABLE'] as const;
 if(r.version!==1||!states.includes(r.state as typeof states[number])||typeof r.firstFailureRetained!=='boolean'||!(r.accountViewRef===null||(typeof r.accountViewRef==='string'&&r.accountViewRef.length>0&&r.accountViewRef.length<=512)))throw Error('DIRECTORY_RESULT');
 if(r.state==='OBSERVED'?(typeof r.data!=='string'||!r.accountViewRef||r.firstFailureRetained):r.data!==null)throw Error('DIRECTORY_PUBLICATION');
 return Object.freeze({version:1,state:r.state as DirectoryResult['state'],accountViewRef:r.accountViewRef as string|null,data:r.state==='OBSERVED'?decodeDirectory(r.data as string):null,firstFailureRetained:r.firstFailureRetained});
}
export class OwnDirectoryGate{
 private generation=0;private scope:string|null=null;private account:string|null=null;private listeners=new Set<()=>void>();private active:Promise<void>|null=null;
 private observationRequested = false;
 private snapshot:Readonly<{scope:string|null;pending:boolean;result:DirectoryResult|null}>=Object.freeze({scope:null,pending:false,result:null});
 constructor(private readonly load:()=>Promise<OwnDirectoryModule|null>){}
 readonly subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>{this.listeners.delete(f);};};
 readonly getSnapshot=()=>this.snapshot;
 private publish(result:DirectoryResult|null){this.snapshot=Object.freeze({scope:this.scope,pending:!!this.active,result});for(const f of this.listeners){try{f();}catch{/* A view observer cannot discard original work. */}}}
 select(scope:string|null,account:string|null){
  if(scope===this.scope&&account===this.account)return;
  this.scope=scope;this.account=account;++this.generation;this.observationRequested=false;this.publish(null);
 }
 observeCurrent():void {
  if(!this.scope||!this.account)return;
  if(this.active){this.observationRequested=true;return;}
  void this.run('observe');
 }
 async run(action:OwnDirectoryAction):Promise<void>{
 if(!this.scope||!this.account)return;
 if(this.active)return this.active; // no replacement call, even across scope changes
 const generation=this.generation,account=this.account;
 const operation=Promise.resolve().then(this.load).then(async m=>{
 // Loading may outlive navigation or account selection. Refuse stale actions
 // before the physical bridge call; publication fencing alone is too late.
 if(generation!==this.generation||account!==this.account||!this.scope)return null;
 if(!m)return Object.freeze({version:1 as const,state:'UNAVAILABLE' as const,accountViewRef:null,data:null,firstFailureRetained:false});return decodeDirectoryResult(await m.observeOwnDeviceDirectory(action));}).then(result=>{
 if(result===null||generation!==this.generation)return;if(result.accountViewRef!==null&&result.accountViewRef!==account)throw Error('DIRECTORY_ACCOUNT_CHANGED');this.publish(result);
 }).catch(()=>{if(generation===this.generation)this.publish(Object.freeze({version:1,state:'RETAINED',accountViewRef:account,data:null,firstFailureRetained:true}));});
 this.active=operation;this.publish(this.snapshot.result);
 try{await operation;}finally{
  if(this.active===operation){
   this.active=null;
   this.publish(generation===this.generation?this.snapshot.result:null);
   if(this.observationRequested){this.observationRequested=false;this.observeCurrent();}
  }
 }
 }
}
export const ownDirectoryGate=new OwnDirectoryGate(()=>import('./ownDirectoryModule').then(m=>m.loadOwnDirectoryModule()));

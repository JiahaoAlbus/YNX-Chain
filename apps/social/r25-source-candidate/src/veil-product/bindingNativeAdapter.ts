import {decodeAccountBindingText,type AccountBindingResult} from './accountBinding';
export type NativeBindingReply=Readonly<{epoch:string;handle:string;status:number;body:string|null;error:string|null}>;
export interface NativeBindingHttpModule {
  readBindingHttpEpoch():Promise<string>;
  reserveBindingHttp(epoch:string):Promise<string>;
  sendBindingHttp(handle:string,epoch:string,token:string):Promise<NativeBindingReply>;
  cancelBindingHttp(handle:string):Promise<boolean>;
  advanceBindingHttpContext():Promise<string>;
}
const errors=['INVALID_HTTP_REQUEST','HTTP_NO_RESPONSE','HTTP_TLS_FAILED','HTTP_TIMEOUT','HTTP_CANCELLED','HTTP_REDIRECT_REFUSED','HTTP_UNEXPECTED_ENCODING','HTTP_CONTENT_TYPE_REFUSED','HTTP_BODY_MISSING','HTTP_BODY_TOO_LARGE','HTTP_BODY_MALFORMED','HTTP_EMPTY_READ_LIMIT','HTTP_BODY_READ_FAILED','HTTP_CLEANUP_FAILED'];
const failure=(reason:Extract<AccountBindingResult,{kind:'unavailable'}>['reason']):AccountBindingResult=>Object.freeze({kind:'unavailable',reason});
export function bindingRequestId(raw:unknown):string {
  if(typeof raw!=='string'||! /^[1-9][0-9]{0,18}$/.test(raw)||(raw.length===19&&raw>'9223372036854775807'))throw Error('INVALID_NATIVE_REQUEST_ID');
  return raw;
}
export function decodeNativeBindingReply(raw:unknown,epoch:string,handle:string):NativeBindingReply {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||![null,Object.prototype].includes(Object.getPrototypeOf(raw)))throw Error('INVALID_NATIVE_REPLY');
  const descriptors=Object.getOwnPropertyDescriptors(raw),keys=Reflect.ownKeys(descriptors);
  if(keys.length!==5||keys.some(key=>typeof key!=='string'||!['epoch','handle','status','body','error'].includes(key)))throw Error('INVALID_NATIVE_REPLY');
  const own:Record<string,unknown>=Object.create(null);
  for(const key of keys){if(typeof key!=='string')throw Error('INVALID_NATIVE_REPLY');const descriptor=descriptors[key];if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw Error('INVALID_NATIVE_REPLY');own[key]=descriptor.value;}
  if(bindingRequestId(own.epoch)!==epoch||bindingRequestId(own.handle)!==handle||typeof own.status!=='number'||!Number.isInteger(own.status)||own.status<0||own.status>599)throw Error('INVALID_NATIVE_REPLY');
  if(own.error!==null){if(typeof own.error!=='string'||!errors.includes(own.error)||own.body!==null)throw Error('INVALID_NATIVE_REPLY');}
  else if(typeof own.body!=='string'||new TextEncoder().encode(own.body).length>8192)throw Error('INVALID_NATIVE_REPLY');
  return Object.freeze({epoch,handle,status:own.status,body:own.body as string|null,error:own.error as string|null});
}
type Attempt={context:number;module:NativeBindingHttpModule|null;epoch:string|null;handle:string|null;stopped:boolean;cancelled:boolean};
/** JS observation ownership only. Native tombstones retain physical capacity
 * independently; cancel false and send DTO settlement NEVER prove reaping. */
export class NativeBindingAdapter {
  private context=1;
  private loaded:Promise<NativeBindingHttpModule|null>|null=null;
  private barrier:Promise<void>=Promise.resolve();
  private active:Attempt|null=null;
  constructor(private readonly loader:()=>Promise<NativeBindingHttpModule|null>){}
  private load(){return this.loaded??=Promise.resolve().then(this.loader).catch(()=>null);}
  private current(a:Attempt){return this.active===a&&a.context===this.context&&!a.stopped;}
  private cancel(a:Attempt){
    if(a.cancelled||!a.module||!a.handle)return;a.cancelled=true;
    try{void a.module.cancelBindingHttp(a.handle).then(()=>{},()=>{});}catch{}
    // Boolean false is observation only, no physical release or auth effect.
  }
  advanceContext(timeoutMs=15000):Promise<void> {
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)return Promise.reject(Error('INVALID_NATIVE_OBSERVATION_LIMIT'));
    const context=++this.context;
    if(this.active){this.active.stopped=true;this.cancel(this.active);}
    const actual=this.barrier.catch(()=>{}).then(async()=>{
      const module=await this.load();
      if(context!==this.context)return;
      if(!module)throw Error('NATIVE_BINDING_MODULE_UNAVAILABLE');
      const epoch=await module.advanceBindingHttpContext();
      bindingRequestId(epoch); // Actual barrier; never a metadata generation.
    });
    this.barrier=actual;
    // Keep the actual barrier retained even if its UI observation times out.
    let timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(Error('NATIVE_BINDING_BARRIER_TIMEOUT')),timeoutMs);});
    return Promise.race([actual,deadline]).finally(()=>{if(timer!==undefined)clearTimeout(timer);});
  }
  async request(token:string,timeoutMs=15000):Promise<AccountBindingResult>{
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000||typeof token!=='string'||!token||token.length>8192||new TextEncoder().encode(JSON.stringify({grantToken:token})).length>8192)return failure('INVALID_INPUT');
    if(this.active)return failure('TRANSPORT_UNAVAILABLE');
    const a:Attempt={context:this.context,module:null,epoch:null,handle:null,stopped:false,cancelled:false};this.active=a;
    const now=()=>globalThis.performance?.now()??Date.now(),expires=now()+timeoutMs;
    let timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
    const alive=()=>this.current(a)&&now()<expires;
    const refuse=()=>failure(timedOut||now()>=expires?'TIMEOUT':'TRANSPORT_UNAVAILABLE');
    // Deadline is active before cached loader, lifecycle barrier or any export.
    const deadline=new Promise<AccountBindingResult>(resolve=>{timer=setTimeout(()=>{timedOut=true;a.stopped=true;token='';this.cancel(a);resolve(failure('TIMEOUT'));},timeoutMs);});
    const actual=(async():Promise<AccountBindingResult>=>{
      try{
        await this.barrier;if(!alive())return refuse();
        const module=await this.load();if(!alive())return refuse();if(!module)return failure('TRANSPORT_UNAVAILABLE');a.module=module;
        const epoch=bindingRequestId(await module.readBindingHttpEpoch());if(!alive())return refuse();a.epoch=epoch;
        const handle=bindingRequestId(await module.reserveBindingHttp(epoch));a.handle=handle;
        if(!alive()){this.cancel(a);return refuse();}
        const before=bindingRequestId(await module.readBindingHttpEpoch());
        if(!alive()||before!==epoch){this.cancel(a);return refuse();}
        const submitted=module.sendBindingHttp(handle,epoch,token);token='';
        const raw=await submitted;if(!alive()){this.cancel(a);return refuse();}
        const reply=decodeNativeBindingReply(raw,epoch,handle);
        const currentEpoch=bindingRequestId(await module.readBindingHttpEpoch());
        if(!alive()||currentEpoch!==epoch){this.cancel(a);return refuse();}
        if(reply.error!==null){this.cancel(a);return failure(reply.error==='HTTP_TIMEOUT'?'TIMEOUT':'TRANSPORT_UNAVAILABLE');}
        if(reply.status!==200){this.cancel(a);return failure('HTTP_NOT_VERIFIED');}
        const metadata=decodeAccountBindingText(reply.body!);
        if(!alive()){this.cancel(a);return refuse();}
        return Object.freeze({kind:'metadata',metadata});
      }catch{this.cancel(a);return alive()?failure('INVALID_RESPONSE'):refuse();}
      finally{token='';if(this.active===a)this.active=null;}
    })();
    try{return await Promise.race([actual,deadline]);}finally{token='';if(timer!==undefined)clearTimeout(timer);}
  }
}
export const nativeBindingAdapter=new NativeBindingAdapter(()=>import('./bindingNativeModule').then(module=>module.loadNativeBindingModule()));

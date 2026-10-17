import {BitcoinReadClient,validateBitcoinReadAddress,type BitcoinNetwork,type BitcoinBalanceRead} from '../chain/bitcoinRead';
import {createTronReader,tronPublicAddress,type TronReadConfig,type TronReadResult} from '../chain/tronRead';
import {WalletOperationLifecycle,type WalletOperationLease} from '../security/operationLifecycle';
import {ModalActionGate} from './modalActionGate';
import type {SecureStorageAdapter} from '../storage/walletRepository';

type PublicStorage=Pick<SecureStorageAdapter,'getItem'|'setItem'>;
export type PublicWatchAddress=Readonly<{family:'bitcoin'|'tron';network:string;address:string;rpcURL:string;label:string;genesisBlockId?:string;contract?:string;expectedDecimals?:number}>;
export type PublicWatchSnapshot=Readonly<{phase:'idle'|'loading'|'saving'|'querying'|'ready'|'failed'|'closed';entries:readonly PublicWatchAddress[];selected:PublicWatchAddress|null;result:BitcoinBalanceRead|TronReadResult|null;error:string|null}>;
export const PUBLIC_WATCH_PREFIX='ynx.wallet.public-watch.v1.';
const queues=new WeakMap<PublicStorage,Promise<unknown>>();
function fail(code:string):never{throw Object.assign(new Error(code),{code})}
function ownerKey(account:string){if(!/^ynx1[0-9a-z]{38}$/.test(account))fail('WATCH_OWNER_INVALID');return PUBLIC_WATCH_PREFIX+account}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('WATCH_RECORD_INVALID');return value as Record<string,unknown>}
function exact(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(key=>!keys.includes(key)))fail('WATCH_RECORD_INVALID')}
export function normalizePublicWatch(input:unknown):PublicWatchAddress{
  const v=object(input);exact(v,['family','network','address','rpcURL','label','genesisBlockId','contract','expectedDecimals']);
  if(typeof v.label!=='string'||v.label!==v.label.trim()||!v.label||v.label.length>64||/[\u0000-\u001f\u007f]/.test(v.label)||typeof v.address!=='string'||typeof v.rpcURL!=='string'||v.rpcURL.length>512)fail('WATCH_INPUT_INVALID');
  if(v.family==='bitcoin'){
    if(v.genesisBlockId!==undefined||v.contract!==undefined||v.expectedDecimals!==undefined)fail('WATCH_INPUT_INVALID');
    const reader=new BitcoinReadClient({network:v.network as BitcoinNetwork,baseURL:v.rpcURL});
    return Object.freeze({family:'bitcoin',network:reader.network,address:validateBitcoinReadAddress(v.address,reader.network),rpcURL:reader.baseURL,label:v.label});
  }
  if(v.family!=='tron')fail('WATCH_FAMILY_INVALID');
  // Construction validates explicit network, HTTPS endpoint and genesis pin.
  createTronReader({network:v.network as TronReadConfig['network'],genesisBlockId:v.genesisBlockId as string,rpcURL:v.rpcURL});
  if(v.expectedDecimals!==undefined&&(!Number.isInteger(v.expectedDecimals)||Number(v.expectedDecimals)<0||Number(v.expectedDecimals)>255))fail('WATCH_INPUT_INVALID');
  if(v.contract!==undefined&&typeof v.contract!=='string')fail('WATCH_INPUT_INVALID');
  const address=tronPublicAddress(v.address).address,contract=v.contract===undefined?undefined:tronPublicAddress(v.contract).address;
  if(contract===undefined&&v.expectedDecimals!==undefined)fail('WATCH_INPUT_INVALID');
  return Object.freeze({family:'tron',network:v.network as string,address,rpcURL:v.rpcURL.replace(/\/$/,''),label:v.label,genesisBlockId:v.genesisBlockId as string,...(contract?{contract}:{}),...(v.expectedDecimals===undefined?{}:{expectedDecimals:Number(v.expectedDecimals)})});
}
const identity=(entry:PublicWatchAddress)=>JSON.stringify([entry.family,entry.network,entry.address,entry.contract??null]);
function decode(raw:string|null,account:string):readonly PublicWatchAddress[]{
  if(raw===null)return Object.freeze([]);if(raw.length>16384)fail('WATCH_RECORD_INVALID');let parsed:unknown;try{parsed=JSON.parse(raw)}catch{return fail('WATCH_RECORD_INVALID')}
  const value=object(parsed);exact(value,['schemaVersion','walletAccount','entries']);if(value.schemaVersion!==1||value.walletAccount!==account||!Array.isArray(value.entries)||value.entries.length>12)fail('WATCH_RECORD_INVALID');
  const entries=value.entries.map(normalizePublicWatch),ids=entries.map(identity);if(new Set(ids).size!==ids.length)fail('WATCH_RECORD_INVALID');return Object.freeze(entries);
}
/** Public metadata only. Never accesses authenticatedSecrets, manifests or keys.
 * Started storage writes cannot be revoked; cancellation fences UI, and reopen
 * reads the original account key. No rollback or blind retry is attempted. */
export class PublicWatchStore{
  constructor(private readonly storage:PublicStorage){}
  async load(account:string,guard:()=>void){guard();const raw=await this.storage.getItem(ownerKey(account));guard();return decode(raw,account)}
  async save(account:string,input:PublicWatchAddress,guard:()=>void){
    const entry=normalizePublicWatch(input),key=ownerKey(account);
    const work=(queues.get(this.storage)??Promise.resolve()).catch(()=>{}).then(async()=>{
      guard();const entries=[...await this.load(account,guard)],at=entries.findIndex(item=>identity(item)===identity(entry));
      if(at<0){if(entries.length>=12)fail('WATCH_LIMIT');entries.push(entry)}else entries[at]=entry;
      const raw=JSON.stringify({schemaVersion:1,walletAccount:account,entries});if(raw.length>16384)fail('WATCH_LIMIT');guard();try{await this.storage.setItem(key,raw)}catch{fail('WATCH_SAVE_FAILED_OR_UNCERTAIN')}guard();return Object.freeze(entries);
    });queues.set(this.storage,work);try{return await work}finally{if(queues.get(this.storage)===work)queues.delete(this.storage)}
  }
}
/** A caller for public watch addresses, not a transaction or custody engine. */
export class PublicChainWatchController{
  private readonly scope;private readonly gate=new ModalActionGate();private abort:AbortController|null=null;
  private readonly listeners=new Set<(snapshot:PublicWatchSnapshot)=>void>();private readonly unsubscribe:()=>void;
  private state:PublicWatchSnapshot=Object.freeze({phase:'idle',entries:Object.freeze([]),selected:null,result:null,error:null});
  constructor(private readonly operations:WalletOperationLifecycle,readonly walletAccount:string,private readonly store:PublicWatchStore,private readonly fetchImpl:typeof fetch=globalThis.fetch){
    ownerKey(walletAccount);this.scope=operations.scope();this.unsubscribe=operations.subscribe(()=>this.close());
  }
  snapshot(){return this.state}
  subscribe(listener:(snapshot:PublicWatchSnapshot)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private publish(patch:Partial<PublicWatchSnapshot>){this.state=Object.freeze({...this.state,...patch});for(const listener of this.listeners)listener(this.state)}
  close(){if(this.state.phase==='closed')return false;this.gate.close();this.abort?.abort();this.scope.cancel();this.unsubscribe();this.publish({phase:'closed',entries:Object.freeze([]),selected:null,result:null,error:null});return true}
  cancel(){if(this.state.phase==='closed')return;this.gate.close();this.abort?.abort();this.abort=null;this.scope.cancel();this.gate.open();this.publish({phase:'idle',result:null,error:null})}
  edit(){this.cancel();if(this.state.phase!=='closed')this.publish({selected:null})}
  select(index:number){if(this.state.phase==='closed')return;const entry=this.state.entries[index];if(!Number.isInteger(index)||!entry)fail('WATCH_SELECTION_INVALID');this.cancel();this.publish({selected:entry})}
  private async run(phase:'loading'|'saving'|'querying',work:(lease:WalletOperationLease,signal:AbortSignal)=>Promise<Partial<PublicWatchSnapshot>>){
    if(this.state.phase==='closed')return;const action=this.gate.acquire();if(!action)return;let lease:WalletOperationLease|undefined;const abort=new AbortController();this.abort=abort;
    this.publish({phase,result:null,error:null});try{
      if(!action.isCurrent())return;lease=this.scope.begin({account:this.walletAccount});lease.assert();const result=await work(lease,abort.signal);lease.assert();if(action.isCurrent())this.publish({phase:phase==='querying'?'ready':'idle',...result});
    }catch(error){if(action.isCurrent()&&(!lease||lease.ownsScope()))this.publish({phase:'failed',result:null,error:error instanceof Error&&'code'in error?String(error.code):phase==='saving'?'WATCH_SAVE_UNAVAILABLE':'WATCH_READ_UNAVAILABLE'})}
    finally{if(this.abort===abort)this.abort=null;lease?.finish();action.finish()}
  }
  load(){return this.run('loading',async lease=>({entries:await this.store.load(this.walletAccount,lease.assert),selected:null}))}
  save(input:unknown){return this.run('saving',async lease=>{const entry=normalizePublicWatch(input),entries=await this.store.save(this.walletAccount,entry,lease.assert);return {entries,selected:entries.find(item=>identity(item)===identity(entry))!}})}
  query(){const selected=this.state.selected;if(!selected||this.state.phase==='closed')return Promise.resolve();return this.run('querying',async(lease,signal)=>{
    const result=selected.family==='bitcoin'?await new BitcoinReadClient({network:selected.network as BitcoinNetwork,baseURL:selected.rpcURL,fetchImpl:this.fetchImpl}).readAddress(selected.address,{signal,guard:lease.assert}):await createTronReader({network:selected.network as TronReadConfig['network'],genesisBlockId:selected.genesisBlockId!,rpcURL:selected.rpcURL},{fetchImpl:this.fetchImpl,assertCurrent:lease.assert}).read({address:selected.address,...(selected.contract?{contract:selected.contract}:{}),...(selected.expectedDecimals===undefined?{}:{expectedDecimals:selected.expectedDecimals})},{signal});
    lease.assert();return {result};
  })}
}

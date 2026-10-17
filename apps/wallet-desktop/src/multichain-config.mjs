import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,rename,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';

export function multiError(code,message){return Object.assign(new Error(message),{code,data:{code}})}
export function exactObject(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))throw multiError('MULTICHAIN_INVALID_INPUT','Invalid network or asset input.');
}
export function publicAddress(address){
  const version=isIP(address);
  if(version===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)}
  // Only global-unicast IPv6; no mapped IPv4, loopback, link-local or ULA.
  if(version===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:db8|0):/i.test(address);
  return false;
}
export function rpcURL(value){
  let url;try{url=new URL(value)}catch{throw multiError('MULTICHAIN_INVALID_RPC','Enter a public HTTPS RPC URL.')}
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(typeof value!=='string'||value.length>2048||url.protocol!=='https:'||url.username||url.password||url.hash||url.search||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!isIP(host)&&!host.includes('.')||isIP(host)&&!publicAddress(host))throw multiError('MULTICHAIN_INVALID_RPC','Use a public HTTPS RPC without credentials, query parameters or redirects.');
  return url.href;
}
export function chainQuantity(value){try{if(typeof value!=='string'||! /^(?:[1-9][0-9]*|0x[0-9a-f]+)$/i.test(value))throw Error();const n=BigInt(value);if(n<=0n||n>=(1n<<256n)||n===6423n)throw Error();return '0x'+n.toString(16)}catch{throw multiError('MULTICHAIN_INVALID_CHAIN','Enter another EVM chain ID. YNX Testnet stays in its original view.')}}
export function boundedText(value,max=80){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))throw multiError('MULTICHAIN_INVALID_TEXT','Enter a valid display name.');return value.trim()}
export function validateNetwork(input){
  exactObject(input,['name','rpcUrl','chainId','symbol','decimals','genesis']);
  const chainId=chainQuantity(input.chainId),genesis=input.genesis;
  if(typeof genesis!=='string'||!/^0x[0-9a-f]{64}$/.test(genesis)||genesis==='0x'+'0'.repeat(64)||input.decimals!==18)throw multiError('MULTICHAIN_INVALID_NETWORK','Verify the network identity and its native asset units.');
  const id=createHash('sha256').update('evm:'+chainId+':'+genesis).digest('hex');
  return Object.freeze({id,family:'evm',name:boundedText(input.name),rpcUrl:rpcURL(input.rpcUrl),chainId,genesis,symbol:boundedText(input.symbol,16),decimals:18});
}
export function validateToken(input){
  exactObject(input,['networkId','address','symbol','name','decimals']);
  if(typeof input.networkId!=='string'||! /^[0-9a-f]{64}$/.test(input.networkId)||typeof input.address!=='string'||! /^0x[0-9a-f]{40}$/.test(input.address)||input.address==='0x'+'0'.repeat(40)||!Number.isInteger(input.decimals)||input.decimals<0||input.decimals>255)throw multiError('MULTICHAIN_INVALID_TOKEN','Check the token contract and its decimals.');
  return Object.freeze({networkId:input.networkId,address:input.address,symbol:boundedText(input.symbol,24),name:boundedText(input.name,120),decimals:input.decimals});
}
/** Serialized, atomic new-profile files only. Invalid existing data is never reset. */
export class AtomicMultiFile{
  #tail=Promise.resolve();
  constructor({filePath,initial,validate,maxBytes=2_000_000}){this.filePath=filePath;this.initial=initial;this.validate=validate;this.maxBytes=maxBytes}
  async read(){let text;try{text=await readFile(this.filePath,'utf8')}catch(e){if(e.code==='ENOENT')return this.validate(structuredClone(this.initial));throw e}if(Buffer.byteLength(text)>this.maxBytes)throw multiError('MULTICHAIN_STORE_INVALID','The network data file is too large. Keep the original file.');try{return this.validate(JSON.parse(text))}catch{throw multiError('MULTICHAIN_STORE_INVALID','The network data could not be verified. Keep the original file.')}}
  mutate(fn){const task=this.#tail.then(async()=>{const before=await this.read(),next=await fn(structuredClone(before));const checked=this.validate(next);await this.write(checked);return structuredClone(checked)});this.#tail=task.catch(()=>{});return task}
  async write(value){const text=JSON.stringify(value);if(Buffer.byteLength(text)>this.maxBytes)throw multiError('MULTICHAIN_STORE_FULL','The network data file is full.');const dir=path.dirname(this.filePath);await mkdir(dir,{recursive:true,mode:0o700});const temp=this.filePath+'.'+randomUUID()+'.tmp';let file,created=false;try{file=await open(temp,'wx',0o600);created=true;await file.writeFile(text);await file.sync();await file.close();file=null;await rename(temp,this.filePath);const directory=await open(dir,'r');try{await directory.sync()}finally{await directory.close()}}finally{await file?.close();if(created)await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}}
}
export function validateConfig(value){
  exactObject(value,['version','revision','selected','networks','tokens']);
  if(value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.networks)||value.networks.length>32||!Array.isArray(value.tokens)||value.tokens.length>256)throw Error('Invalid config');
  const networks=value.networks.map(n=>{exactObject(n,['id','family','name','rpcUrl','chainId','symbol','decimals','genesis']);const {id,family,...input}=n;const checked=validateNetwork(input);if(id!==checked.id||family!=='evm')throw Error('Network identity changed');return checked});
  const tokens=value.tokens.map(validateToken);if(new Set(networks.map(n=>n.id)).size!==networks.length||new Set(tokens.map(t=>t.networkId+':'+t.address)).size!==tokens.length||tokens.some(t=>!networks.some(n=>n.id===t.networkId))||value.selected!==null&&!networks.some(n=>n.id===value.selected))throw Error('Invalid selection');
  return {version:1,revision:value.revision,selected:value.selected,networks,tokens};
}
export class MultiConfigStore{
  constructor({filePath,file}={}){this.file=file??new AtomicMultiFile({filePath,initial:{version:1,revision:0,selected:null,networks:[],tokens:[]},validate:validateConfig})}
  read(){return this.file.read()}
  async update(fn){return this.file.mutate(value=>{const next=fn(value);next.revision++;return next})}
  async putNetwork(network){return this.update(value=>{const n=validateNetwork(network);const old=value.networks.findIndex(x=>x.id===n.id);if(old<0)value.networks.push(n);else value.networks[old]=n;value.selected=n.id;return value})}
  async select(id){return this.update(value=>{if(!value.networks.some(n=>n.id===id))throw multiError('MULTICHAIN_UNKNOWN_NETWORK','Select a saved network.');value.selected=id;return value})}
  async remove(id){return this.update(value=>{value.networks=value.networks.filter(n=>n.id!==id);value.tokens=value.tokens.filter(t=>t.networkId!==id);if(value.selected===id)value.selected=null;return value})}
  async putToken(token){return this.update(value=>{const checked=validateToken(token);const old=value.tokens.findIndex(t=>t.networkId===checked.networkId&&t.address===checked.address);if(old<0)value.tokens.push(checked);else value.tokens[old]=checked;return value})}
  async removeToken(networkId,address){return this.update(value=>{value.tokens=value.tokens.filter(t=>t.networkId!==networkId||t.address!==address);return value})}
}

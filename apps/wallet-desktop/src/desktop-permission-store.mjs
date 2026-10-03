import * as fs from "node:fs/promises";
import {constants} from "node:fs";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {PrivateFilePolicy} from "./platform-private-file.mjs";
import {readBoundedPrivateFile,PRIVATE_FILE_MAX_BYTES} from "./bounded-private-file-read.mjs";

const mutations=new Map();
const empty=()=>({schemaVersion:1,origins:{}});
const refusal=()=>Object.assign(Error("Wallet account permissions cannot be verified. Existing records were retained; account access and signing are blocked."),{code:4100,data:{code:"PERMISSION_STORE_INVALID"}});
function origin(value){
  try{const parsed=new URL(value);if(typeof value!=="string"||value.length>2048||parsed.protocol!=="https:"||parsed.origin!==value||parsed.username||parsed.password)throw Error();return value}catch{throw refusal()}
}
function account(value){if(typeof value!=="string"||!/^0x[0-9a-f]{40}$/.test(value))throw refusal();return value}
function approvalTime(value){if(typeof value!=="string"||value.length>64||!Number.isFinite(Date.parse(value)))throw refusal();return value}
function validate(state){
  if(!state||Object.keys(state).sort().join()!=="origins,schemaVersion"||state.schemaVersion!==1||!state.origins||typeof state.origins!=="object"||Array.isArray(state.origins)||Object.keys(state.origins).length>1024)throw refusal();
  for(const [key,record] of Object.entries(state.origins)){
    origin(key);
    if(!record||Object.keys(record).sort().join()!=="accounts,approvedAt,parentCapability"||record.parentCapability!=="eth_accounts"||!Array.isArray(record.accounts)||record.accounts.length!==1)throw refusal();
    account(record.accounts[0]);approvalTime(record.approvedAt);
  }
  return state;
}
// Same-process instances of this exact existing file share mutation ordering.
// No claim of a cross-process compare-and-swap or authenticated permission file.
function serialize(filePath,action){
  const current=(mutations.get(filePath)??Promise.resolve()).catch(()=>{}).then(action);
  mutations.set(filePath,current);
  const release=()=>{if(mutations.get(filePath)===current)mutations.delete(filePath)};
  current.then(release,release);return current;
}
export class FilePermissionStore {
  constructor(filePath,{io=fs,filePolicy=new PrivateFilePolicy({io})}={}){
    if(!path.isAbsolute(filePath??""))throw refusal();
    this.filePath=path.resolve(filePath);this.io=io;this.filePolicy=filePolicy;
  }
  async grantAccount(originInput,accountInput,approvedAt){
    const key=origin(originInput),selected=account(accountInput),time=approvalTime(approvedAt);
    return serialize(this.filePath,async()=>{const state=await this.#read();state.origins[key]={parentCapability:"eth_accounts",accounts:[selected],approvedAt:time};await this.#write(state)});
  }
  async revoke(originInput){const key=origin(originInput);return serialize(this.filePath,async()=>{const state=await this.#read();delete state.origins[key];await this.#write(state)})}
  async revokeAll(){return serialize(this.filePath,async()=>{await this.#read();await this.#write(empty())})}
  async hasAccount(originInput,accountInput){const key=origin(originInput),selected=account(accountInput);return (await this.#read()).origins[key]?.accounts.includes(selected)??false}
  async list(originInput){const record=(await this.#read()).origins[origin(originInput)];return record?[Object.freeze({...record,accounts:Object.freeze([...record.accounts])})]:[]}
  async #read(filePath=this.filePath){
    let handle,failed=false,stage="probe";
    try{
      await this.filePolicy.available(filePath);stage="open";
      handle=await this.io.open(filePath,constants.O_RDONLY|(constants.O_NOFOLLOW??0));stage="inspect";
      const stat=await handle.stat();if(!stat.isFile()||stat.size>PRIVATE_FILE_MAX_BYTES)throw refusal();
      await this.filePolicy.assertPrivate(filePath,stat);
      const text=await readBoundedPrivateFile(handle);if(Buffer.byteLength(text)>PRIVATE_FILE_MAX_BYTES)throw refusal();
      return validate(JSON.parse(text));
    }catch(error){failed=true;if(stage==="open"&&!handle&&error?.code==="ENOENT")return empty();throw refusal()}
    finally{try{await handle?.close()}catch{if(!failed)throw refusal()}}
  }
  async #write(state){
    validate(state);const text=JSON.stringify(state,null,2)+"\n";if(Buffer.byteLength(text)>PRIVATE_FILE_MAX_BYTES)throw refusal();
    const temporary=`${this.filePath}.${randomUUID()}.tmp`;let handle,created=false;
    try{
      await this.filePolicy.directory(path.dirname(this.filePath));
      handle=await this.io.open(temporary,"wx",0o600);created=true;await this.filePolicy.protect(temporary);
      await handle.writeFile(text,"utf8");await handle.sync();await handle.close();handle=null;
      if(JSON.stringify(await this.#read(temporary))!==JSON.stringify(state))throw refusal();
      await this.filePolicy.replace(temporary,this.filePath);
      if(JSON.stringify(await this.#read())!==JSON.stringify(state))throw refusal();
    }catch{throw refusal()}
    finally{await handle?.close().catch(()=>{});if(created)await this.io.unlink(temporary).catch(()=>{})}
  }
}

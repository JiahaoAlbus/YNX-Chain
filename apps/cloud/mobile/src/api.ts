export type CloudObject={id:string;name:string;kind:"file"|"folder"|"doc";size:number;version:number;starred:boolean;trashedAt?:string;updatedAt:string};
export type DataErasureReceipt={schemaVersion:1;id:string;ownerHash:string;product:"cloud";status:string;pendingBlobs:number;completedBlobs:number;requestedAt:string;updatedAt:string;deleted:Record<string,number>;retained:Record<string,string>;coverage:string};
export class API{
  constructor(readonly base:string,readonly token:string){}
  async call(path:string,init:RequestInit={}){const r=await fetch(this.base+path,{...init,headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.token}`,...init.headers}});const type=r.headers.get("content-type")||"";const b=r.status===204?null:type.includes("json")?await r.json():await r.text();if(!r.ok)throw Error(b?.error||`HTTP ${r.status}`);return b}
  async list(view="files"):Promise<CloudObject[]>{const q=new URLSearchParams({limit:"200"});if(view!=="files")q.set("view",view);const page=await this.call(`/objects?${q}`);return page.items}
  create(body:unknown){return this.call("/objects",{method:"POST",body:JSON.stringify(body)})}
  mutate(id:string,action:string,body?:unknown){return this.call(`/objects/${id}/${action}`,{method:"POST",body:body?JSON.stringify(body):undefined})}
  versions(id:string){return this.call(`/objects/${id}/versions`)}
  quota(){return this.call("/quota")}
  audit(){return this.call("/audit")}
  export(){return fetch(this.base+"/export",{headers:{Authorization:`Bearer ${this.token}`}})}
  erase():Promise<DataErasureReceipt>{return this.call("/account-data",{method:"DELETE",body:JSON.stringify({confirm:"DELETE CLOUD DATA"})})}
  erasureReceipts():Promise<DataErasureReceipt[]>{return this.call("/account-data/erasures")}
}

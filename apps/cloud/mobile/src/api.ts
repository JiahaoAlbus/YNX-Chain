export type CloudObject={id:string;name:string;kind:"file"|"folder"|"doc";size:number;version:number;starred:boolean;trashedAt?:string;updatedAt:string};
export class API{
  constructor(readonly base:string,readonly token:string){}
  async call(path:string,init:RequestInit={}){const r=await fetch(this.base+path,{...init,headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.token}`,...init.headers}});const type=r.headers.get("content-type")||"";const b=r.status===204?null:type.includes("json")?await r.json():await r.text();if(!r.ok)throw Error(b?.error||`HTTP ${r.status}`);return b}
  list(view="files"):Promise<CloudObject[]>{return this.call(`/objects${view==="files"?"":`?view=${view}`}`)}
  create(body:unknown){return this.call("/objects",{method:"POST",body:JSON.stringify(body)})}
  mutate(id:string,action:string,body?:unknown){return this.call(`/objects/${id}/${action}`,{method:"POST",body:body?JSON.stringify(body):undefined})}
  versions(id:string){return this.call(`/objects/${id}/versions`)}
  quota(){return this.call("/quota")}
  audit(){return this.call("/audit")}
}

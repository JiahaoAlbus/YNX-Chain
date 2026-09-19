import {runInNewContext} from "node:vm";
import {webcrypto} from "node:crypto";

// Executes the production worker body with only browser I/O substituted. This
// proves lifecycle/cache behavior in Node, not browser registration or install.
export function memoryCacheStorage() { return {stores:new Map(),deletions:[]}; }
export async function loadPwaWorker({workerSource,policySource,assetIntegrity,storage=memoryCacheStorage(),network,scope="https://wallet.test/",clientUrls=[]}) {
  const policy=await import(`data:text/javascript;base64,${Buffer.from(policySource).toString("base64")}`);
  const handlers=new Map(), state={skipWaiting:0,claims:0,updates:0,unregisters:0,navigations:[]};
  const key=value=>new URL(typeof value==="string"?value:value.url,scope).href;
  const caches={
    async keys(){return [...storage.stores.keys()]},
    async delete(name){storage.deletions.push(name);return storage.stores.delete(name)},
    async open(name){
      if(!storage.stores.has(name))storage.stores.set(name,new Map());
      const entries=storage.stores.get(name);
      return {async match(request){return entries.get(key(request))?.clone()},async put(request,response){entries.set(key(request),response.clone())},async delete(request){return entries.delete(key(request))}};
    }
  };
  const self={
    registration:{scope,async update(){state.updates++},async unregister(){state.unregisters++;return true}},
    clients:{async claim(){state.claims++},async matchAll(){return clientUrls.map((url,index)=>({url,id:`client-${index}`,async navigate(target){state.navigations.push(target)}}))}},
    async skipWaiting(){state.skipWaiting++},addEventListener(name,handler){handlers.set(name,handler)}
  };
  const source=workerSource.replace(/^import \{ASSET_INTEGRITY\} from "\.\/asset-integrity\.js";\n/u,"").replace(/^import \{[^\n]+\} from "\.\/service-worker-policy\.js";\n/u,"");
  runInNewContext(source,{...policy,ASSET_INTEGRITY:assetIntegrity,self,caches,fetch:(request,options)=>network(key(request),options),Response,URL,crypto:webcrypto,console});
  async function event(name,request,clientId){
    const pending=[];let response;
    handlers.get(name)({request,clientId,waitUntil(promise){pending.push(promise)},respondWith(promise){response=Promise.resolve(promise)}});
    const result=response?await response:undefined;
    for(let index=0;index<pending.length;index++)await pending[index];
    return result;
  }
  async function message(type){const pending=[];let result;handlers.get("message")({data:{type},ports:[{postMessage(value){result=value}}],waitUntil(promise){pending.push(promise)}});await Promise.all(pending);return result}
  return {policy,storage,caches,state,message,install:()=>event("install"),activate:()=>event("activate"),request:(path,mode="cors",clientId)=>event("fetch",{url:key(path),method:"GET",mode},clientId)};
}

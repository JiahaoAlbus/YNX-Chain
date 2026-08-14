export type ExactAndroidCallbackBridge=(url:string,packageName:string)=>Promise<unknown>;
export type CallbackFallback=(url:string)=>Promise<unknown>;

export async function openRegisteredCallbackFailClosed(
  url:string,
  registeredCallback:string,
  bundleId:string,
  platform:string,
  exactAndroidBridge:ExactAndroidCallbackBridge|null,
  fallback:CallbackFallback,
):Promise<void>{
  let callback:URL,handoff:URL;
  try{callback=new URL(registeredCallback);handoff=new URL(url)}catch{throw new Error("Registered Wallet callback is invalid")}
  if(callback.toString()!==registeredCallback||callback.username||callback.password||callback.port||callback.search||callback.hash)throw new Error("Registered Wallet callback is not canonical");
  const keys=[...handoff.searchParams.keys()],response=keys.length===1&&keys[0]==="response"?handoff.searchParams.get("response"):null;
  if(!response||url!==`${registeredCallback}?response=${response}`)throw new Error("Wallet callback handoff does not match its registered route");
  if(callback.protocol==="http:")throw new Error("Insecure Wallet callback is prohibited");
  if(platform==="android"&&callback.protocol!=="https:"){
    if(!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(bundleId))throw new Error("Registered Android callback package is invalid");
    if(!exactAndroidBridge)throw new Error("Exact Android callback package bridge is unavailable");
    await exactAndroidBridge(url,bundleId);
    return;
  }
  await fallback(url);
}

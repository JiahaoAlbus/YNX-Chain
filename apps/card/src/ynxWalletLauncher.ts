export type YnxWalletLaunchResult="launched"|"unavailable";
type EventListener=(event:unknown)=>void;
type Frame={style:Record<string,string>;setAttribute:(name:string,value:string)=>void;remove:()=>void;src:string};
export type YnxWalletLaunchEnvironment=Readonly<{document?:Readonly<{visibilityState?:string;body?:Readonly<{appendChild:(node:Frame)=>void}>;createElement:(name:string)=>Frame;addEventListener:(name:string,listener:EventListener)=>void;removeEventListener:(name:string,listener:EventListener)=>void}>;setTimeout?:(listener:()=>void,delay:number)=>unknown;clearTimeout?:(handle:unknown)=>void}>;

let activeCleanup:(()=>void)|null=null;

function canonicalRequest(url:string):boolean{try{const parsed=new URL(url);return parsed.protocol==="ynxwallet:"&&parsed.hostname==="authorize"&&parsed.pathname===""&&Boolean(parsed.searchParams.get("request"));}catch{return false}}
function browserEnvironment():YnxWalletLaunchEnvironment{return{document:typeof document==="undefined"?undefined:document as unknown as YnxWalletLaunchEnvironment["document"],setTimeout:(listener,delay)=>setTimeout(listener,delay),clearTimeout:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)}}

export function launchYNXWalletRequest(url:string,environment: YnxWalletLaunchEnvironment=browserEnvironment(),timeoutMs=900):Promise<YnxWalletLaunchResult>{
  if(!canonicalRequest(url))return Promise.reject(new Error("YNX Wallet launcher requires a complete canonical request"));
  activeCleanup?.();
  const documentRef=environment.document,body=documentRef?.body;
  if(!documentRef||!body)return Promise.resolve("unavailable");
  return new Promise(resolve=>{
    let settled=false,timer:unknown;
    const frame=documentRef.createElement("iframe");
    frame.setAttribute("aria-hidden","true");frame.setAttribute("tabindex","-1");
    frame.style.display="none";
    const finish=(result:YnxWalletLaunchResult)=>{if(settled)return;settled=true;environment.clearTimeout?.(timer);documentRef.removeEventListener("visibilitychange",onVisibility);documentRef.removeEventListener("pagehide",onPageHide);frame.remove();if(activeCleanup===cancel)activeCleanup=null;resolve(result);};
    const onVisibility=()=>{if(documentRef.visibilityState==="hidden")finish("launched");};
    const onPageHide=()=>finish("launched");
    const cancel=()=>finish("unavailable");
    activeCleanup=cancel;
    documentRef.addEventListener("visibilitychange",onVisibility);documentRef.addEventListener("pagehide",onPageHide);
    body.appendChild(frame);
    frame.src=url;
    timer=environment.setTimeout?.(()=>finish(documentRef.visibilityState==="hidden"?"launched":"unavailable"),timeoutMs);
  });
}

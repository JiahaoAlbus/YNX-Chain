import {parseMarketDocument} from './market-data.js?v=77e901697a7c3e24fb181a4069d88c20a6c06000d1cf91ba0539e51840be4ec7';
const invalid=()=>Object.assign(new Error('The venue configuration is unavailable or invalid.'),{code:'API_UNAVAILABLE'});
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const boolean=n=>typeof n==='boolean';
export function validateVenueConfig(value){
  if(!value||value.chainId!=='ynx_6423-1'||value.evmChainId!==6423||value.nativeAsset!=='YNXT'||typeof value.custodyAddress!=='string'||value.custodyAddress.length>128||!Array.isArray(value.networks)||value.networks.length>16)throw invalid();
  const seen=new Set();
  for(const row of value.networks){
    if(!row||typeof row.asset!=='string'||typeof row.network!=='string'||row.asset.length>40||row.network.length>128||typeof row.chainId!=='string'||!boolean(row.depositEnabled)||!boolean(row.withdrawalEnabled)||!boolean(row.withdrawalReviewEnabled)||!boolean(row.withdrawalBroadcastEnabled)||!boolean(row.crossChain)||!integer(row.confirmations)||row.withdrawalFeeMicro!==undefined&&!integer(row.withdrawalFeeMicro))throw invalid();
    const key=JSON.stringify([row.asset,row.network]);if(seen.has(key))throw invalid();seen.add(key);
    if(row.withdrawalEnabled||row.withdrawalBroadcastEnabled)throw invalid(); // Existing service has no broadcast adapter.
    if((row.asset==='YUSD_TEST'||row.crossChain)&&(row.depositEnabled||row.withdrawalReviewEnabled))throw invalid();
  }
  const native=value.networks.find(row=>row.asset==='YNXT'&&row.network==='YNX Testnet');
  if(!native||native.chainId!==value.chainId||native.evmChainId!==value.evmChainId||native.crossChain||native.depositEnabled&&(!value.custodyAddress||native.confirmations<1)||native.withdrawalReviewEnabled&&!value.custodyAddress)throw invalid();
  // Do not manufacture a zero fee for Go's optional/omitted fee field.
  return Object.freeze({chainId:value.chainId,evmChainId:value.evmChainId,nativeAsset:value.nativeAsset,custodyAddress:value.custodyAddress,
    networks:Object.freeze(value.networks.map(row=>Object.freeze({...row}))),writeAuthorized:false,nativeAddressVerified:false});
}

export function createVenueConfigReader({fetchImpl=globalThis.fetch,onState=()=>{},timeoutMs=5000,maxAgeMs=120000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  let epoch=0,active=null,freshness=null,closed=false,current={phase:'unavailable',config:null};
  const publish=(phase,config=null)=>{current=Object.freeze({phase,config});onState(current)};
  const retire=()=>{epoch++;active?.abort();active=null;clearTimer(freshness);freshness=null};
  async function refresh(){
    if(closed)return;retire();const token=epoch,controller=new AbortController();active=controller;publish('loading');
    let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimer(()=>{controller.abort();reject(invalid())},timeoutMs)});
    try{
      const config=await Promise.race([deadline,(async()=>{
        const response=await fetchImpl('/api/v1/config',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
        if(controller.signal.aborted||!response.ok||(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')throw invalid();
        const length=response.headers.get('content-length'),encoding=response.headers.get('content-encoding');
        if(length!==null&&(!/^\d+$/.test(length)||Number(length)>262144))throw invalid();
        const reader=response.body?.getReader();if(!reader)throw invalid();
        const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{})}catch{}};
        controller.signal.addEventListener('abort',cancel,{once:true});
        const decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0;
        try{while(true){const part=await reader.read();if(controller.signal.aborted)throw invalid();if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.byteLength>262144-size)throw invalid();size+=part.value.byteLength;text+=decoder.decode(part.value,{stream:true})}text+=decoder.decode();if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&size!==Number(length))throw invalid();return validateVenueConfig(parseMarketDocument(text));}
        finally{controller.signal.removeEventListener('abort',cancel);cancel();try{reader.releaseLock()}catch{}}
      })()]);
      if(closed||token!==epoch||controller.signal.aborted)return;
      publish('live',config);freshness=setTimer(()=>{if(token===epoch){retire();publish('stale')}},maxAgeMs);
    }catch{if(!closed&&token===epoch)publish('unavailable')}
    finally{clearTimer(timer);if(token===epoch)active=null}
  }
  return Object.freeze({refresh,state:()=>current,offline(){if(!closed){retire();publish('offline')}},stop(){retire();closed=true;publish('closed')}});
}

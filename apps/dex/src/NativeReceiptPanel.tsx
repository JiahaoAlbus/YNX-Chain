import { useEffect, useState } from 'react';
import { loadNativeReceipt, type NativeReceipt } from './native-receipt';
import { receiptCopy } from './receipt-i18n';
import type { Locale } from './types';
import './receipt-panel.css';

export function NativeReceiptPanel({locale}:{locale:Locale}) {
  const t=receiptCopy[locale];
  const [hash,setHash]=useState(''),[lookup,setLookup]=useState<{hash:string;revision:number}|null>(null);
  const [result,setResult]=useState<{key:object;data?:NativeReceipt;error?:boolean}|null>(null);
  useEffect(()=>{
    if(!lookup)return;
    const abort=new AbortController();let active=true;
    const timeout=setTimeout(()=>abort.abort(),8000);
    void loadNativeReceipt(lookup.hash,abort.signal).then(data=>{if(active&&!abort.signal.aborted)setResult({key:lookup,data});}).catch(()=>{if(active)setResult({key:lookup,error:true});}).finally(()=>clearTimeout(timeout));
    const online=()=>setLookup(old=>old?{hash:old.hash,revision:old.revision+1}:null);
    window.addEventListener('online',online);
    return()=>{active=false;clearTimeout(timeout);abort.abort();window.removeEventListener('online',online);};
  },[lookup]);
  const value=result?.key===lookup?result:undefined;
  const receipt=value?.data;
  return <section className="portfolio-panel receipt-panel" aria-label={t[0]}>
    <h2>{t[0]}</h2>
    <form onSubmit={event=>{event.preventDefault();setLookup(old=>({hash:hash.trim(),revision:(old?.revision??0)+1}));}}>
      <label>{t[2]}<input aria-label={t[2]} value={hash} spellCheck={false} autoComplete="off" maxLength={66} onChange={event=>setHash(event.target.value)} placeholder="0x…"/></label>
      <button className="secondary" type="submit">{t[1]}</button>
    </form>
    {lookup&&!value&&<p role="status">{t[1]}…</p>}
    {value?.error&&<p role="alert">{t[3]}</p>}
    {receipt&&<>
      <p role="status"><code>{receipt.status}</code></p>
      <a href={`https://explorer.ynxweb4.com/tx/${receipt.hash}`}><code className="portfolio-address">{receipt.hash}</code></a>
      {receipt.status==='not_found'?<p>{t[4]}</p>:receipt.transaction&&<dl>
        {Object.entries(receipt.transaction).map(([key,value])=><div key={key}><dt>{key}</dt><dd><code className="portfolio-address">{value}</code></dd></div>)}
        {receipt.durability&&Object.entries(receipt.durability).map(([key,value])=><div key={key}><dt>{key}</dt><dd><code className="portfolio-address">{value}</code></dd></div>)}
      </dl>}
    </>}
    <p className="portfolio-boundary">{t[5]}</p>
  </section>;
}

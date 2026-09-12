import { useEffect, useState } from 'react';
import { ynxAddressFromEVM } from '@ynx-chain/wallet-auth/src/crypto.js';
import { createNativeActionJournal, openNativeActionStore, type NativeDraft } from './native-action-journal';
import { nativeLedgerAddress } from './native-snapshot';
import { nativeDraftCopy } from './native-draft-i18n';
import type { Locale } from './types';
import './receipt-panel.css';

export const draftAccount=(selected:string)=>selected.startsWith('ynx1')?selected:ynxAddressFromEVM(nativeLedgerAddress(selected));

/** Reads only this selected account's local intent. No automatic callback or
 * Wallet launch; an installed native handler has not been attested by Web. */
export function NativeDraftPanel({account,locale,revision}:{account:string;locale:Locale;revision:number}){
  const t=nativeDraftCopy[locale];
  const [refresh,setRefresh]=useState(0),[result,setResult]=useState<{account:string;draft:Readonly<NativeDraft>|null;error:boolean}|null>(null);
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!account){setResult(null);return;}
    let active=true;
    void (async()=>{let store:Awaited<ReturnType<typeof openNativeActionStore>>|undefined;
      try{store=await openNativeActionStore();const draft=await createNativeActionJournal(store).read(draftAccount(account));if(active)setResult({account,draft,error:false});}
      catch{if(active)setResult({account,draft:null,error:true});}
      finally{store?.close();}
    })();
    return()=>{active=false;};
  },[account,revision,refresh]);
  if(!account)return null;
  const current=result?.account===account?result:null,draft=current?.draft;
  const discard=async()=>{if(!draft)return;let store:Awaited<ReturnType<typeof openNativeActionStore>>|undefined;
    try{store=await openNativeActionStore();await createNativeActionJournal(store).discardUnsigned(draftAccount(account),draft.digest);setRefresh(n=>n+1);}
    catch{setResult({account,draft,error:true});}finally{store?.close();}
  };
  return <section className="portfolio-panel receipt-panel" aria-label={t[0]}>
    <h2>{t[0]}</h2><p className="portfolio-boundary">{t[5]}</p>
    <button className="secondary" onClick={()=>setRefresh(n=>n+1)}>{t[3]}</button>
    <a href="https://www.ynxweb4.com/dapp/download">{t[6]}</a>
    {current?.error&&<p role="alert">{t[7]}</p>}
    {draft&&<>
      <p role="status"><code>{draft.status}</code></p>
      <dl>{Object.entries({account:draft.request.account,action:draft.request.action,nonce:draft.request.nonce,expiresAt:draft.request.expiresAt,snapshotId:draft.snapshotId,requestDigest:draft.digest,...draft.request.payload}).map(([name,value])=><div key={name}><dt>{name}</dt><dd><code className="portfolio-address">{value}</code></dd></div>)}</dl>
      <p>{t[9]}</p>
      {Date.parse(draft.request.expiresAt)<=clock&&draft.status!=='approved'&&<p role="status">{t[8]}</p>}
      {draft.transactionHash?<code className="portfolio-address">{draft.transactionHash}</code>:<button className="secondary" onClick={()=>void discard()}>{t[4]}</button>}
    </>}
  </section>;
}

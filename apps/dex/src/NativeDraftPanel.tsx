import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ynxAddressFromEVM } from '@ynx-chain/wallet-auth/src/crypto.js';
import { createNativeActionJournal, openNativeActionStore, subscribeNativeActionCommits, type NativeDraft, type NativeJournalStore } from './native-action-journal';
import { getNativeSubmissionStatus, submitNativeAction, refreshNativeSubmission, type NativeSubmission } from './native-submission';
import { nativeLedgerAddress } from './native-snapshot';
import { nativeDraftCopy } from './native-draft-i18n';
import { nativeSubmitCopy, nativeLaunchCopy, type NativeSubmitMessage } from './native-submit-i18n';
import { createApplicationActionLauncher, type ApplicationActionLauncher, type ApplicationActionLaunchTarget } from './vendor/application-actions-browser.mjs';
import launcherRegistry from './vendor/native-runtime-registry.json';
import type { Locale } from './types';
import './receipt-panel.css';

export const draftAccount=(selected:string)=>selected.startsWith('ynx1')?selected:ynxAddressFromEVM(nativeLedgerAddress(selected));
type View={key:string;draft:Readonly<NativeDraft>|null;submission:NativeSubmission|null;error:NativeSubmitMessage|null;verified:boolean};

/** Restoring only reads local intent. Launch, callback verification and
 * submission require separate explicit actions; this panel never signs. */
export function NativeDraftPanel({account,locale,revision}:{account:string;locale:Locale;revision:number}){
  const t=nativeDraftCopy[locale],s=nativeSubmitCopy[locale],l=nativeLaunchCopy[locale];
  const key=`${account}:${revision}`,selection=useRef(key),sequence=useRef(0),mounted=useRef(true);
  selection.current=key;
  const lock=useRef<{key:string;id:number}|null>(null);
  const [refresh,setRefresh]=useState(0),[view,setView]=useState<View|null>(null),[checked,setChecked]=useState('');
  const [busy,setBusy]=useState<{key:string;id:number}|null>(null),[clock,setClock]=useState(Date.now());
  const launcher=useRef<{key:string;api:ApplicationActionLauncher}|null>(null);
  const [prepared,setPrepared]=useState<{key:string;target:ApplicationActionLaunchTarget}|null>(null);
  const [launchStage,setLaunchStage]=useState<{key:string;index:number}|null>(null);
  useEffect(()=>{mounted.current=true;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>{mounted.current=false;sequence.current++;clearInterval(timer);};},[]);
  function start(force=false){
    if(!account||(!force&&lock.current?.key===key))return null;
    const id=++sequence.current,operation={key,id};lock.current=operation;setBusy(operation);setChecked('');
    return {isCurrent:()=>mounted.current&&selection.current===key&&sequence.current===id,finish:()=>{if(lock.current?.id===id){lock.current=null;if(mounted.current)setBusy(null);}}};
  }
  function fencedStore(store:NativeJournalStore,isCurrent:()=>boolean):NativeJournalStore{
    return {update:(entry,change)=>{if(!isCurrent())return Promise.reject(Error('NATIVE_CONTEXT_CHANGED'));return store.update(entry,value=>{if(!isCurrent())throw Error('NATIVE_CONTEXT_CHANGED');return change(value);});}};
  }
  useEffect(()=>{
    if(!account)return;
    const isCurrent=()=>mounted.current&&selection.current===key;
    let api:ApplicationActionLauncher|undefined,unsubscribe:(()=>void)|undefined;
    const invalidate=()=>{api?.invalidate();setPrepared(null);setChecked('');};
    const visibility=()=>{if(document.visibilityState==='hidden')invalidate();};
    try{
      api=createApplicationActionLauncher(launcherRegistry,{productId:'dex',getActiveAccount:()=>isCurrent()?draftAccount(account):null,loadPendingRequest:async()=>{
        let store:Awaited<ReturnType<typeof openNativeActionStore>>|undefined;
        try{store=await openNativeActionStore();if(!isCurrent())throw Error('NATIVE_CONTEXT_CHANGED');const draft=await createNativeActionJournal(fencedStore(store,isCurrent)).read(draftAccount(account));if(!isCurrent())throw Error('NATIVE_CONTEXT_CHANGED');return draft?.status==='pending'?draft.request:null;}
        finally{store?.close();}
      }});
      // Commit notices invalidate only transient launch/review state. They must
      // not cancel a submit after its own durable claim, or change its epoch.
      unsubscribe=subscribeNativeActionCommits(invalidate);launcher.current={key,api};
      window.addEventListener('pagehide',invalidate);document.addEventListener('visibilitychange',visibility);
    }catch{api?.dispose();launcher.current=null;setLaunchStage({key,index:4});}
    return()=>{unsubscribe?.();api?.dispose();if(launcher.current?.key===key)launcher.current=null;window.removeEventListener('pagehide',invalidate);document.removeEventListener('visibilitychange',visibility);};
  },[account,revision]);
  useEffect(()=>{
    if(!account){setView(null);setChecked('');return;}
    const op=start(true)!;
    void (async()=>{let store:Awaited<ReturnType<typeof openNativeActionStore>>|undefined;
      try{store=await openNativeActionStore();if(!op.isCurrent())return;const journal=createNativeActionJournal(fencedStore(store,op.isCurrent)),native=draftAccount(account),draft=await journal.read(native);if(!op.isCurrent())return;
        const submission=draft?.status==='approved'?await getNativeSubmissionStatus(store,native,draft.digest):null;
        if(op.isCurrent())setView({key,draft,submission,error:null,verified:false});
      }catch{if(op.isCurrent())setView({key,draft:null,submission:null,error:'readError',verified:false});}
      finally{store?.close();op.finish();}
    })();
    return()=>{if(selection.current===key)sequence.current++;};
  },[account,revision,refresh]);
  if(!account)return null;
  const current=view?.key===key?view:null,draft=current?.draft,attempt=current?.submission;
  const working=busy?.key===key,approved=draft?.status==='approved'&&!!draft.signed&&!!draft.transactionHash;
  const deadline=draft?.request.payload.deadlineUnix;
  const expired=!Number.isSafeInteger(deadline)||Number(deadline)*1000<=clock;
  const confirmation=`${key}:${draft?.digest}:${draft?.transactionHash}`;
  const canSubmit=!!approved&&!attempt&&!expired&&!working&&!current?.error;
  const hasReturn=new URLSearchParams(location.search).has('applicationActionResult');
  const reload=()=>{sequence.current++;setChecked('');launcher.current?.api.invalidate();setPrepared(null);setRefresh(n=>n+1);};
  const prepareLaunch=async()=>{
    if(!draft||draft.status!=='pending'||working||launcher.current?.key!==key)return;
    const op=start();if(!op)return;setPrepared(null);setLaunchStage(null);
    try{const target=await launcher.current.api.prepare();if(!op.isCurrent())return;if(target.status!=='ready'||target.requestDigest!==draft.digest)throw Error('NATIVE_DRAFT_CHANGED');setPrepared({key,target});setLaunchStage({key,index:2});}
    catch{if(op.isCurrent())setLaunchStage({key,index:4});}
    finally{op.finish();}
  };
  const openLaunch=(event:ReactMouseEvent<HTMLButtonElement>)=>{
    if(working||prepared?.key!==key||prepared.target.requestDigest!==draft?.digest||launcher.current?.key!==key)return;
    try{launcher.current.api.open(event.nativeEvent,prepared.target.requestDigest);setLaunchStage({key,index:3});}
    catch{setLaunchStage({key,index:4});}
    finally{launcher.current?.api.invalidate();setPrepared(null);}
  };
  const run=async(action:'verify'|'discard'|'submit'|'check')=>{
    if(!draft||working)return;
    if(action==='verify'&&!new URLSearchParams(location.search).has('applicationActionResult'))return;
    if(action==='submit'&&(!canSubmit||checked!==confirmation))return;
    if(action==='check'&&!approved)return;
    const op=start();if(!op)return;
    const error:NativeSubmitMessage=action==='verify'?'returnError':action==='submit'?'submitError':action==='check'?'checkError':'readError';
    let store:Awaited<ReturnType<typeof openNativeActionStore>>|undefined;
    try{
      store=await openNativeActionStore();if(!op.isCurrent())return;
      const native=draftAccount(account),journal=createNativeActionJournal(fencedStore(store,op.isCurrent));
      if(action==='verify'){
        const callbackURL=location.href;
        const next=await journal.acceptReturn(native,callbackURL);if(!op.isCurrent())return;
        // Only a committed and verified callback may be removed from the URL.
        // This is not navigation and is never a prerequisite to journal binding.
        if(location.href===callbackURL)history.replaceState(history.state,'','/');
        const submission=next.status==='approved'?await getNativeSubmissionStatus(store,native,next.digest):null;
        if(op.isCurrent())setView({key,draft:next,submission,error:null,verified:true});
      }else if(action==='discard'){
        await journal.discardUnsigned(native,draft.digest);if(op.isCurrent())setView({key,draft:null,submission:null,error:null,verified:false});
      }else{
        const input={store,account:native,digest:draft.digest,hash:draft.transactionHash!,isCurrent:op.isCurrent};
        const submission=action==='submit'?await submitNativeAction({...input,confirmed:true}):await refreshNativeSubmission(input);
        if(op.isCurrent())setView({key,draft,submission,error:null,verified:false});
      }
    }catch{
      // A lost POST response may have a durable attempt. Never offer an
      // automatic second POST, even when the readback also fails.
      if(op.isCurrent()){
        let submission=attempt??null;
        if(store&&approved){try{submission=await getNativeSubmissionStatus(store,draftAccount(account),draft.digest);}catch{/* error keeps submission disabled */}}
        if(op.isCurrent())setView({key,draft,submission,error,verified:false});
      }
    }finally{store?.close();op.finish();}
  };
  return <section className="portfolio-panel receipt-panel" aria-label={t[0]}>
    <h2>{t[0]}</h2><p className="portfolio-boundary">{s.boundary}</p>
    <button className="secondary" disabled={!!working} onClick={reload}>{t[3]}</button>{' '}
    <a href="https://www.ynxweb4.com/dapp/download">{t[6]}</a>
    {working&&<p role="status">{s.busy}</p>}
    {current?.error&&<p role="alert">{s[current.error]}</p>}
    {current?.verified&&<p role="status">{s.verified}</p>}
    {launchStage?.key===key&&<p role={launchStage.index===4?'alert':'status'}>{l[launchStage.index]}</p>}
    {draft&&<>
      <p role="status"><code>{draft.status}</code></p>
      <dl>{Object.entries({account:draft.request.account,action:draft.request.action,nonce:draft.request.nonce,expiresAt:draft.request.expiresAt,snapshotId:draft.snapshotId,requestDigest:draft.digest,...draft.request.payload}).map(([name,value])=><div key={name}><dt>{name}</dt><dd><code className="portfolio-address">{value}</code></dd></div>)}</dl>
      <p>{t[9]}</p>
      {draft.status==='pending'&&<><p>{l[5]}</p><button className="secondary" disabled={!!working||launcher.current?.key!==key||Date.parse(draft.request.expiresAt)<=clock} onClick={()=>void prepareLaunch()}>{l[0]}</button><button className="secondary" disabled={!!working||prepared?.key!==key||prepared.target.requestDigest!==draft.digest||Date.parse(draft.request.expiresAt)<=clock} onClick={openLaunch}>{l[1]}</button></>}
      <p>{s.verifyOnly}</p>{hasReturn&&<button className="secondary" disabled={!!working} onClick={()=>void run('verify')}>{s.verifyReturn}</button>}
      {!approved&&<button className="secondary" disabled={!!working} onClick={()=>void run('discard')}>{t[4]}</button>}
      {!approved&&Date.parse(draft.request.expiresAt)<=clock&&<p role="status">{t[8]}</p>}
      {approved&&<>
        <h3>{s.review}</h3>
        <dl><div><dt>{s.hash}</dt><dd><code className="portfolio-address">{draft.transactionHash}</code></dd></div><div><dt>{s.network}</dt><dd><code>{draft.request.chainId}</code></dd></div><div><dt>{s.slippage}</dt><dd><code>{JSON.stringify(Object.fromEntries(Object.entries(draft.request.payload).filter(([name])=>/^(min|max)/.test(name))))}</code></dd></div><div><dt>{s.deadline}</dt><dd><code>{deadline}</code></dd></div></dl>
        <p>{s.slippageNote}</p>
        <h4>{s.signedJSON}</h4><pre data-testid="native-signed-json" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{draft.signed}</pre>
        {expired&&<p role="status">{s.expired}</p>}
        {attempt?<p role="status">{s.attempted} <code>{attempt.status}</code></p>:<>
          <label style={{display:'flex',alignItems:'center',gap:8}}><input style={{width:18,height:18}} type="checkbox" checked={checked===confirmation} disabled={!canSubmit} onChange={event=>setChecked(event.target.checked?confirmation:'')}/>{s.confirm}</label>
          <button className="primary" disabled={!canSubmit||checked!==confirmation} onClick={()=>void run('submit')}>{s.submit}</button>
        </>}
        {attempt&&<button className="secondary" disabled={!!working} onClick={()=>void run('check')}>{s.check}</button>}
        {attempt?.status==='not_found'&&<p>{s.notFound}</p>}
        <p className="portfolio-boundary">{s.observationBoundary}</p>
      </>}
    </>}
  </section>;
}

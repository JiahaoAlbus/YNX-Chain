import { useEffect, useState } from 'react';
import { formatAtomic, loadNativePortfolio, PortfolioError, type NativePortfolio } from './portfolio';
import { portfolioCopy } from './portfolio-i18n';
import type { Locale } from './types';

export function PortfolioPanel({account,locale,onConnect}:{account:string;locale:Locale;onConnect:()=>void}) {
  const t=portfolioCopy[locale];
  const [revision,setRevision]=useState(0);
  const [result,setResult]=useState<{account:string;data?:NativePortfolio;error?:string}>({account});
  useEffect(()=>{
    if(!account)return;
    const controller=new AbortController();let current=true,timedOut=false;
    setResult({account});
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},8000);
    void loadNativePortfolio(account,controller.signal).then(data=>{if(current&&!controller.signal.aborted)setResult({account,data});}).catch(error=>{
      if(current&&(timedOut||!controller.signal.aborted))setResult({account,error:error instanceof PortfolioError?error.code:'UNAVAILABLE'});
    }).finally(()=>clearTimeout(timeout));
    const refresh=()=>setRevision(value=>value+1);
    window.addEventListener('online',refresh);
    return()=>{current=false;clearTimeout(timeout);controller.abort();window.removeEventListener('online',refresh);};
  },[account,revision]);
  const data=result.account===account?result.data:undefined;
  const error=result.account===account?result.error:undefined;
  return <section className="portfolio-panel" aria-label={t.title}>
    <header><h1>{t.title}</h1>{account&&<button className="secondary" onClick={()=>setRevision(value=>value+1)}>{t.retry}</button>}</header>
    {!account?<><p>{t.connectHint}</p><button className="primary" onClick={onConnect}>{t.connect}</button></>:<>
      <code className="portfolio-address">{account}</code>
      {error?<p role="alert">{error==='UNAVAILABLE'||error==='STALE'?t.unavailable:t.invalid}</p>:!data?<p role="status">{t.loading}</p>:<>
        <div className="metrics"><div><span>{t.staked}</span><strong>{data.stakedAtomic}</strong></div><div><span>{t.nonce}</span><strong>{data.nonce}</strong></div></div>
        <div className="portfolio-table"><table><thead><tr><th>{t.asset}</th><th>{t.balance}</th></tr></thead><tbody>{data.assets.map(asset=><tr key={asset.assetId}><td><strong>{asset.symbol}</strong><code>{asset.assetId}</code></td><td>{formatAtomic(asset.amountAtomic,asset.decimals)}</td></tr>)}</tbody></table></div>
        <h2>{t.positions}</h2>
        {data.positions.length===0?<p>{t.noPositions}</p>:data.positions.map(position=><article className="portfolio-position" key={position.poolId}><h3>{position.poolId}</h3><p>{t.shares}: {position.shares} / {position.totalShares}</p><p>{t.claim}</p>{([['asset0','claim0Atomic'],['asset1','claim1Atomic']] as const).map(([id,claim])=>{const asset=data.assets.find(a=>a.assetId===position[id])!;return <p key={id}>{formatAtomic(position[claim],asset.decimals)} {asset.symbol} <code>{asset.assetId}</code></p>;})}<small>#{position.blockHeight}</small></article>)}
        <p className="portfolio-provenance">{t.source}: {data.source} · {data.version}<br/><code>{data.snapshotId}</code><br/>{t.readAt}: <time dateTime={data.readAt}>{new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'medium'}).format(new Date(data.readAt))}</time></p>
      </>}
    </>}
    <p className="portfolio-boundary">{t.boundary}</p>
  </section>;
}

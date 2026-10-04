import {nativePaperHistory,nativeEquityCurve,nativeHistoryPage,nativeSavedDetail} from './paper-history-model.js';
import {paperHistoryCopy} from './paper-history-copy.js';

export function mountNativePaperHistory(host,{session,snapshot,request,language}){
 let busy=false;
 const root=document.createElement('section');root.id='paper-native-history';root.style.overflowWrap='anywhere';host.after(root);
 const node=(tag,value)=>{const element=document.createElement(tag);if(value!==undefined)element.textContent=value;return element;};
 const exact=(parent,row,copy)=>{const details=node('details'),summary=node('summary',copy.record),pre=node('pre',JSON.stringify(row,null,2));pre.style.whiteSpace='pre-wrap';details.append(summary,pre);parent.append(details);};
 function curve(parent,row,copy){
  const value=nativeEquityCurve(row);if(!value){parent.append(node('p',copy.invalid));return;}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 760 200');svg.setAttribute('role','img');svg.setAttribute('aria-label',copy.curve+' / '+copy.benchmark);svg.style.width='100%';svg.style.maxHeight='220px';
  for(const [points,color] of [[value.benchmark,'#8895aa'],[value.equity,'#16b89c']]){const line=document.createElementNS(ns,'polyline');line.setAttribute('points',points);line.setAttribute('fill','none');line.setAttribute('stroke',color);line.setAttribute('stroke-width','2');svg.append(line);}
  parent.append(node('h4',copy.curve+' / '+copy.benchmark),svg,node('p',value.first+' — '+value.last+` (${value.displayed}/${value.total})`));
 }
 return function render(){
  const current=session(),source=snapshot(),model=nativePaperHistory(current,source),copy=paperHistoryCopy(language());root.replaceChildren(node('h3',copy.title),node('p',copy.boundary));
  if(model.status!=='ready'){root.append(node('p',model.status==='invalid'?copy.invalid:copy.unavailable));return;}
  if(model.invalid)root.append(node('p',copy.invalid+` (${model.invalid})`));
  const page=nativeHistoryPage(source),same=()=>{const now=session();return now.account===current.account&&now.epoch===current.epoch&&now.ready&&snapshot()===source;};
  if(page){
   if(page.version==='bounded_v2')root.append(node('p',copy.catalog+' · '+copy.counts+` (${Object.keys(source.strategies).length}/${page.counts.strategies}) · ${page.offset}`));
   const navigation=node('nav');navigation.setAttribute('aria-label',copy.title);root.append(navigation);
   for(const [key,offset,disabled] of [['previous',page.offset-20,page.offset===0],['next',page.offset+20,!page.hasNext]]){
    const button=node('button',copy[key]);button.type='button';button.dataset.nativeHistoryPage=key;button.disabled=disabled||busy;navigation.append(button);
    button.addEventListener('click',async()=>{if(busy||!same())return;busy=true;button.disabled=true;button.textContent=copy.loading;try{await request('/v1/wallet/paper/snapshot?history='+page.version+'&offset='+offset+'&revision='+encodeURIComponent(page.revision));}catch{}finally{busy=false;render();}});
   }
  }
  for(const [kind,label] of [['orders',copy.orders],['experiments',copy.research],['audit',copy.audit]]){
   const section=node('section');section.dataset.nativeHistory=kind;section.append(node('h4',label+` (${model[kind].length}${page?'/'+page.counts[kind]:''})`));if(page)section.append(node('p',copy.counts+` · ${page.offset}`));root.append(section);
   if(!model[kind].length){section.append(node('p',model.invalid?copy.invalid:copy.empty));continue;}
   for(const row of model[kind]){
    const article=node('article');section.append(article);
    if(kind==='orders'){article.append(node('h5',`${row.ID} · ${row.Side} · ${row.Status}`),node('p',`${row.CreatedAt} · ${row.Filled}/${row.Amount} · ${row.MarketSource||row.Source}`));exact(article,row,copy);}
    else if(kind==='audit'){article.append(node('p',`${row.Sequence} · ${row.CreatedAt} · ${row.Action} · ${row.ObjectID}`));exact(article,row,copy);}
    else{
     article.append(node('h5',`${row.strategy.Name||row.strategy.ID} · ${row.id}`),node('p',row.createdAt));const button=node('button',copy.view);button.type='button';button.dataset.nativeExperiment=row.id;article.append(button);
     button.addEventListener('click',async()=>{
      // A retired/replaced snapshot or owner never opens old native data.
      if(busy||!same()){if(!same())render();return;}
      busy=true;button.disabled=true;let saved=row;
      try{
       if(page){button.textContent=copy.loading;const reply=await request('/v1/wallet/paper/experiment?id='+encodeURIComponent(row.id)+'&revision='+encodeURIComponent(page.revision));if(!same())return;saved=nativeSavedDetail(reply,row.id,page.revision);if(!saved)throw new Error('PAPER_BINDING_MISMATCH');}
       if(!same())return;button.remove();const m=saved.metrics;article.append(node('p',`${copy.metrics}: ${m.ReturnBPS} / ${m.BuyHoldBPS} / ${m.MaxDrawdownBPS}; ${m.SharpeMilli}`));curve(article,saved,copy);const definitions=node('dl');article.append(node('h4',copy.formulas),definitions);for(const [key,value] of Object.entries(saved.metricDefinitions)){definitions.append(node('dt',key),node('dd',value));}exact(article,saved,copy);
      }catch{if(same()){article.append(node('p',copy.invalid));button.disabled=false;button.textContent=copy.view;}}
      finally{busy=false;}
     });
    }
   }
  }
 };
}

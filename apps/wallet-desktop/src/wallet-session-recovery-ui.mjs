/** Local summaries and explicit original-outcome reads only. No automatic
 * polling, publication, signing, callback launch or request replacement. */
export function createSessionRecoveryUI({api,getKeyState,document:doc=document}){
 const section=doc.createElement('section'),title=doc.createElement('h3'),help=doc.createElement('p'),refresh=doc.createElement('button'),rows=doc.createElement('div'),output=doc.createElement('p');
 section.id='session-original-recovery';title.textContent='登录原件恢复 / Sign-in original recovery';
 help.textContent='保留原签名与未知结果。查询只读取原发布结果，不重新签名、发布或回跳；过期记录也不会恢复为新授权。 / Read original outcomes only; no new signature, publication, callback or grant.';
 refresh.type='button';refresh.disabled=true;refresh.textContent='查看本地记录 / Show local records';output.setAttribute('role','status');section.append(title,help,refresh,rows,output);doc.querySelector('#backup-section').append(section);
 let generation=0,stamp='',busy=false,buttons=[];
 const stateKey=s=>JSON.stringify([s.account,s.revision,s.locked,s.authenticating]);
 const render=()=>{const s=getKeyState(),next=stateKey(s);if(next!==stamp){stamp=next;generation++;rows.replaceChildren();buttons=[];output.textContent='';}refresh.disabled=busy||s.locked||s.authenticating;for(const button of buttons)button.disabled=busy||s.locked||s.authenticating||button.unavailable;};
 const start=()=>{render();if(busy||refresh.disabled)return null;busy=true;const token=generation,security=stamp;render();return ()=>{render();return token===generation&&security===stamp;};};
 const finish=()=>{busy=false;render();};
 refresh.addEventListener('click',async()=>{
  const live=start();if(!live)return;
  try{
   const response=await api.sessionPublicationRecords();if(!live())return;
   if(response?.ok!==true||!Array.isArray(response.value)||response.value.length>8)throw Error('LOCAL_RECORDS_UNAVAILABLE');
   rows.replaceChildren();buttons=[];
   for(const row of response.value){
    if(typeof row?.requestDigest!=='string'||row.requestDigest.length>128||typeof row.signed!=='boolean'||typeof row.productId!=='string'||!/^[a-z][a-z0-9-]{1,31}$/.test(row.productId)||!['publish-unknown','reference-ready','not-published'].includes(row.publicationStatus))throw Error('LOCAL_RECORDS_INVALID');
    const line=doc.createElement('p'),label=doc.createElement('span'),check=doc.createElement('button');
    label.textContent=`${row.productId} · ${row.publicationStatus} `;check.type='button';check.textContent='只读查询 / Read outcome';check.unavailable=!row.signed||row.publicationStatus==='not-published';
    check.addEventListener('click',async()=>{
     const current=start();if(!current)return;
     try{
      const reply=await api.sessionPublicationOutcome(row.requestDigest);if(!current())return;const value=reply?.value;
      if(reply?.ok!==true||!['pending','completed','not_found'].includes(value?.state)||value.retryAuthorized!==false||value.callbackEmitted!==false||value.productSessionCreated!==false)throw Error('ORIGINAL_OUTCOME_UNAVAILABLE');
      output.textContent=value.state==='not_found'?'原服务当前未找到匹配记录；仍保留未知结果，不会重新发布。 / Not found is only an observation; original remains UNKNOWN, no republish.':`${value.state==='completed'?'原服务记录已完成 / Original service record completed':'原服务记录仍待处理 / Original service record pending'}${value.expired?' · 请求已过期 / Request expired':''}。只读查询，未产生新授权或回跳。 / Read only; no new grant or callback.`;
     }catch{if(current())output.textContent='无法确认原结果；保留记录，不会重新签名、发布或回跳。 / Original outcome unavailable; retained, no automatic retry.';}
     finally{finish();}
    });
    buttons.push(check);line.append(label,check);rows.append(line);
   }
   output.textContent=response.value.length?'请选择原记录，只读查询。 / Select an original record for a read-only query.':'当前账户没有原记录。 / No originals for this account.';
  }catch{if(live()){rows.replaceChildren();buttons=[];output.textContent='本地记录无法验证；请保留钱包数据。 / Local records unavailable; preserve this Wallet.';}}
  finally{finish();}
 });
 return Object.freeze({render});
}

// The release owner's canonical request adapter supplies authentication and
// exact action proofs. This controller never obtains authority from EVM connect,
// browser storage, a caller-supplied account, or an old Music bearer token.
export function createMusicBusiness({document:doc, audio, tell}) {
  const $=s=>doc.querySelector(s), $$=s=>[...doc.querySelectorAll(s)];
  let view='home', aiCancel=null;
  let epoch=0, transport=null, snapshot=null, current=null, detail=null, mediaURL='', playback='', lastSave=0, playRevision=0, searchRevision=0, libraryTail=Promise.resolve();
  const pending=new Set(), urls=new Set(), dialogs=new Set();
  const stale=()=>new DOMException('Music account changed','AbortError');
  const capture=()=>{if(!transport||!snapshot)throw new Error('Private Music service is unavailable. Canonical Wallet sign-in is required.');return {epoch,transport}};
  const check=t=>{if(t.epoch!==epoch||t.transport!==transport)throw stale()};
  const validID=(id,prefix)=>typeof id==='string'&&new RegExp(`^${prefix}_[0-9a-f]{24}$`).test(id);
  const path=(id,prefix)=>{if(!validID(id,prefix))throw new Error('Invalid record ID');return encodeURIComponent(id)};
  const fmt=ms=>{const s=Math.max(0,Math.floor((Number(ms)||0)/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
  const tracks=()=>snapshot?.catalog||[];
  const allTracks=()=>[...tracks(),...(snapshot?.creatorTracks||[])];
  const trackName=id=>allTracks().find(t=>t.id===id)?.title||id;
  function node(tag,text,className){const n=doc.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n}
  function button(label,action){const owner={epoch,transport};const b=node('button',label,'secondary');b.type='button';b.onclick=()=>run(t=>{check(owner);return action(t)});return b}
  async function response(t,url,options={}) {
    check(t);if(!/^api\//.test(url)||url.split(/[?#]/,1)[0].includes('..'))throw new Error('Invalid Music route');
    const controller=new AbortController();pending.add(controller);
    const timer=setTimeout(()=>controller.abort(new DOMException('Music request timed out','TimeoutError')),30000);
    const finish=()=>{clearTimeout(timer);pending.delete(controller)};
    const read=async promise=>{
      if(controller.signal.aborted){Promise.resolve(promise).catch(()=>{});throw controller.signal.reason;}
      let abort;const cancelled=new Promise((_,reject)=>{abort=()=>reject(controller.signal.reason||stale());controller.signal.addEventListener('abort',abort,{once:true})});
      try{const value=await Promise.race([promise,cancelled]);check(t);return value}finally{controller.signal.removeEventListener('abort',abort)}
    };
    try {
      const result=await read(Promise.resolve().then(()=>t.transport(url,{...options,signal:controller.signal})));check(t);
      if(!(result instanceof Response)||result.redirected||(result.url&&new URL(result.url).origin!==new URL(doc.baseURI).origin))throw new Error('Invalid Music response');
      if(!result.ok){let message=`Music request failed (${result.status})`;try{message=(await read(result.json())).error||message}catch{}check(t);throw new Error(message)}
      return {result,finish,read,cancel:()=>controller.abort(new DOMException('AI request cancelled','AbortError')),signal:controller.signal};
    }catch(error){finish();throw error}
  }
  async function json(t,url,method='GET',body,idempotency) {
    const options={method,headers:{Accept:'application/json'}};
    if(body!==undefined){options.body=JSON.stringify(body);options.headers['Content-Type']='application/json'}
    if(idempotency)options.headers['Idempotency-Key']=idempotency;
    const r=await response(t,url,options);
    try{const value=await r.read(r.result.json());check(t);return value}finally{r.finish()}
  }
  async function run(action) {
    let ticket;try{ticket=capture();await action(ticket);check(ticket)}catch(error){if(error.name!=='AbortError'&&(!ticket||ticket.epoch===epoch))tell(error.message,true)}
  }
  function releaseURL(url){if(url){URL.revokeObjectURL(url);urls.delete(url)}}
  function reset(){
    epoch++;$('#musicIdentity').hidden=true;$('#musicIdentity').textContent='';$('#musicDisconnect').hidden=true;aiCancel?.();aiCancel=null;$('#aiCancel').disabled=true;transport=null;snapshot=null;current=null;detail=null;playback='';playRevision++;searchRevision++;
    for(const p of pending)p.abort();pending.clear();for(const d of dialogs){d.close();d.remove()}dialogs.clear();
    audio.pause();audio.removeAttribute('src');audio.load();for(const u of urls)URL.revokeObjectURL(u);urls.clear();mediaURL='';libraryTail=Promise.resolve();
    for(const id of ['trackGrid','favorites','queue','history','playlists','creatorRecords','settlementRecords','aiRecords','aiOutput'])$('#'+id)?.replaceChildren();
    $('#profileName').value='';$('#profileBio').value='';$('#explicitAllowed').checked=false;$('#privateHistory').checked=true;
    $('#allocationSelect').replaceChildren();$$('.usage-choice').forEach(n=>n.remove());$('#uploadForm').reset();$('#uploadForm').hidden=true;$('#creatorGate').hidden=false;
    if($('#trackDialog').open)$('#trackDialog').close();$('#nowTitle').textContent='Nothing playing';$('#nowArtist').textContent='Choose an authorized track';$('#elapsed').textContent='0:00';$('#duration').textContent='0:00';$('#seek').value=0;$('#playPause').textContent='▶';$('#trackGrid').classList.add('hidden');
  }
  async function load(t=capture()) {
    const next=await json(t,'api/me');check(t);
    if(!next?.profile?.account||!next.listener||!Array.isArray(next.catalog)||!Array.isArray(next.playlists))throw new Error('Verified Music business snapshot missing');
    if(snapshot&&snapshot.profile.account!==next.profile.account){reset();throw stale()}
    snapshot=next;$('#musicIdentity').hidden=false;$('#musicIdentity').textContent=next.profile.displayName||next.profile.account;$('#musicDisconnect').hidden=false;render();return next;
  }
  async function activate(request) {
    reset();if(typeof request!=='function')throw new Error('Canonical Music request adapter missing');transport=request;
    const t={epoch,transport};
    try{await load(t);check(t);tell('Your Music library is ready.');return snapshot.profile.account}catch(error){if(t.epoch===epoch)reset();throw error}
  }
  function showView(nextView){
    view=nextView;
    $$('nav a[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===view));$('#libraryPanel').classList.toggle('hidden',view!=='library');$('#creatorPanel').classList.toggle('hidden',view!=='creator');$('.hero').classList.toggle('hidden',view!=='home');$('#trackGrid').classList.toggle('hidden',view==='library'||view==='creator'||!snapshot);$('#empty').classList.toggle('hidden',view==='library'||view==='creator'||tracks().length>0);if(view==='search')$('#searchInput').focus();
  }
  function records(target,ids,action){const container=$(target);container.replaceChildren();for(const id of ids||[]){const row=node('div',null,'record');row.append(button(trackName(id),t=>action(t,id)));container.append(row)}if(!container.childNodes.length)container.append(node('p','None yet.','muted'))}
  function renderCatalog(list=tracks()) {
    const grid=$('#trackGrid');grid.replaceChildren();
    for(const track of list){const card=node('article',null,'track-card'),art=button('',t=>details(t,track)),artist=button(track.artistName,()=>filterBy('artistName',track.artistName)),playButton=button('▶',t=>play(t,track));art.className='track-art';art.setAttribute('aria-label',`Open details for ${track.title}`);art.append(node('span',track.title?.slice(0,1)||'♪','letter'));artist.className='artist-link';playButton.className='track-play';playButton.setAttribute('aria-label',`Play ${track.title}`);card.append(art,node('h3',track.title),artist,node('p',fmt(track.durationMillis)),playButton);grid.append(card)}
    $('#empty').classList.toggle('hidden',list.length>0);$('#trackGrid').classList.remove('hidden');
  }
  function filterBy(field,value){$('#searchInput').value=value;showView('search');renderCatalog(tracks().filter(track=>track[field]===value))}
  function render(){
    renderCatalog();const p=snapshot.profile,l=snapshot.listener;
    $('#profileName').value=p.displayName||'';$('#profileBio').value=p.bio||'';$('#explicitAllowed').checked=!!p.explicitAllowed;$('#privateHistory').checked=!!p.privateHistory;
    records('#favorites',l.favorites,(t,id)=>details(t,allTracks().find(x=>x.id===id)));records('#queue',l.queue,(t,id)=>play(t,allTracks().find(x=>x.id===id)));
    $('#history').replaceChildren(...(l.history||[]).map(h=>node('div',`${trackName(h.trackId)} · ${fmt(h.positionMillis)}`,'record')));
    $('#playlists').replaceChildren(...snapshot.playlists.map(p=>button(p.name,t=>editPlaylist(t,p.id))));
    $('#creatorGate').hidden=p.creatorStatus==='active';$('#uploadForm').hidden=p.creatorStatus!=='active';
    $('#creatorRecords').replaceChildren(...(snapshot.creatorTracks||[]).map(track=>{const row=node('div',null,'record');row.append(node('span',`${track.title} · ${track.releaseState} · ${track.rights.basis}`));if(track.releaseState==='draft')row.append(button('Publish',async t=>{if(await confirmAction(t,'Publish this rights-declared track?')){await json(t,`api/creator/tracks/${path(track.id,'trk')}/release`,'POST',{state:'published',reason:''});await load(t)}}));row.append(button('Dispute',t=>openCase(t,track.id,'dispute')));return row}));
    $$('.usage-choice').forEach(n=>n.remove());for(const u of snapshot.usage||[]){const label=node('label',null,'usage-choice'),input=node('input');input.type='checkbox';input.name='usage';input.value=u.id;label.append(input,doc.createTextNode(` ${trackName(u.trackId)} · ${fmt(u.listenedMillis)}`));$('#allocationForm').insertBefore(label,$('#allocationForm button'))}
    $('#allocationSelect').replaceChildren(...(snapshot.allocations||[]).map(a=>{const option=node('option',`${a.id} · ${a.amountMicros} micros`);option.value=a.id;return option}));
    $('#settlementRecords').replaceChildren(...(snapshot.settlements||[]).map(s=>{const row=node('div',null,'record');row.append(node('span',`${s.amountMicros} YNXT micros · ${s.status}`));try{const uri=new URL(s.reviewUri);if(s.centralIntentId&&uri.protocol==='ynxpay:'&&uri.hostname==='settlement'&&uri.pathname==='/review'&&!uri.username&&!uri.password&&!uri.hash){const link=node('a','Review in YNX Pay');link.href=s.reviewUri;row.append(link)}}catch{}return row}));
    $('#aiRecords').replaceChildren(...(snapshot.aiProposals||[]).map(p=>{const row=node('div',null,'record');row.append(node('span',`${p.kind} · ${p.provider}/${p.model} · ${p.estimatedUnits} estimated units · ${p.status}`),node('small',`Intent: ${p.intent||''} · Context: ${(p.contextTrackIds||[]).map(trackName).join(', ')}`));if(['awaiting_gateway','provider_failed'].includes(p.status))row.append(button('Stream',t=>streamAI(t,p.id)));if(p.status==='completed'){row.append(button('Apply',t=>reviewAI(t,p.id,'apply')),button('Reject',t=>reviewAI(t,p.id,'reject')))}return row}));
    showView(view);
  }
  function dialog(t,title,build){
    check(t);const d=node('dialog');d.className='business-dialog';d.append(node('h2',title));const body=node('div');d.append(body);build(d,body);doc.body.append(d);dialogs.add(d);d.addEventListener('close',()=>{dialogs.delete(d);d.remove()},{once:true});d.showModal();return d;
  }
  function ask(t,title,initial=''){
    return new Promise(resolve=>{let result=null;const d=dialog(t,title,(d,body)=>{const input=node('input');input.value=initial;input.setAttribute('aria-label',title);body.append(input,button('Cancel',()=>d.close()),button('Continue',()=>{check(t);result=input.value;d.close()}))});d.addEventListener('close',()=>resolve(result),{once:true})})
  }
  function confirmAction(t,title){return new Promise(resolve=>{let confirmed=false;const d=dialog(t,title,(d,body)=>body.append(button('Cancel',()=>d.close()),button('Publish',()=>{check(t);confirmed=true;d.close()})));d.addEventListener('close',()=>resolve(confirmed),{once:true})})}
  async function editPlaylist(t,id){
    const record=await json(t,`api/playlists/${path(id,'pl')}`);check(t);const draft={name:record.name,description:record.description||'',trackIDs:[...(record.trackIds||[])]};
    dialog(t,'Edit playlist',(d,body)=>{
      const name=node('input'),description=node('textarea'),rows=node('div'),error=node('p',null,'error');name.value=draft.name;description.value=draft.description;name.setAttribute('aria-label','Playlist name');description.setAttribute('aria-label','Description');
      const draw=()=>{rows.replaceChildren();draft.trackIDs.forEach((id,index)=>{const row=node('div',null,'record');row.append(node('span',trackName(id)));const up=button('Move up',()=>{if(index>0){[draft.trackIDs[index-1],draft.trackIDs[index]]=[id,draft.trackIDs[index-1]];draw()}}),down=button('Move down',()=>{if(index+1<draft.trackIDs.length){[draft.trackIDs[index+1],draft.trackIDs[index]]=[id,draft.trackIDs[index+1]];draw()}});up.disabled=index===0;down.disabled=index===draft.trackIDs.length-1;row.append(up,down,button('Remove',()=>{draft.trackIDs.splice(index,1);draw()}));rows.append(row)});for(const track of tracks().filter(x=>!draft.trackIDs.includes(x.id)))rows.append(button(`Add ${track.title}`,()=>{draft.trackIDs.push(track.id);draw()}))};
      const cancel=button('Cancel',()=>d.close()),save=button('Save',async()=>{
        check(t);const submitted={name:name.value,description:description.value,trackIDs:[...draft.trackIDs]};const controls=[...body.querySelectorAll('input,textarea,button')];controls.forEach(n=>n.disabled=true);error.textContent='';const preventCancel=e=>e.preventDefault();d.addEventListener('cancel',preventCancel);
        try{await json(t,`api/playlists/${path(id,'pl')}`,'PUT',submitted);const readback=await json(t,`api/playlists/${path(id,'pl')}`);if(readback.name!==submitted.name||(readback.description||'')!==submitted.description||JSON.stringify(readback.trackIds)!==JSON.stringify(submitted.trackIDs))throw new Error('Playlist readback differs');await load(t);check(t);d.close()}
        catch(e){if(t.epoch===epoch&&d.isConnected){error.textContent='Save not confirmed. Your changes are retained; retry.';controls.forEach(n=>n.disabled=false);draw()}if(e.name==='AbortError')throw e}
        finally{d.removeEventListener('cancel',preventCancel)}
      });body.append(name,description,rows,error,cancel,save);draw();
    });
  }
  async function details(t,track){check(t);if(!track)return;detail=track;$('#detailTitle').textContent=track.title;$('#detailArtist').replaceChildren(button(track.artistName,()=>{ $('#trackDialog').close();filterBy('artistName',track.artistName)}));if(track.album)$('#detailArtist').append(button(track.album,()=>{ $('#trackDialog').close();filterBy('album',track.album)}));const evidence=$('#detailEvidence');evidence.replaceChildren();for(const [label,value]of Object.entries({Provenance:track.provenance?.audio,Rights:track.rights?.basis,Evidence:track.rights?.evidenceRef,Territories:track.rights?.territories?.join(', '),Integrity:track.audioSha256,Release:track.releaseState})){evidence.append(node('dt',label),node('dd',value||''))}$('#detailFavorite').textContent=snapshot.listener.favorites?.includes(track.id)?'Remove favorite':'Favorite';if(!$('#trackDialog').open)$('#trackDialog').showModal()}
  async function saveLibrary(t,change){
    const task=libraryTail.catch(()=>{}).then(async()=>{check(t);const l=snapshot.listener;const next=change(l);await json(t,'api/library','PUT',{favorites:next.favorites??l.favorites??[],queue:next.queue??l.queue??[],downloads:next.downloads??l.downloads??{}});await load(t)});libraryTail=task;return task;
  }
  async function savePosition(t,track,session,position,completed=false){if(!track)return;const value=await json(t,`api/playback/${path(track.id,'trk')}/position`,'POST',{sessionRef:session,positionMillis:Math.max(0,Math.round(position*1000)),completed});check(t);if(value.listener)snapshot.listener=value.listener}
  async function mediaBytes(r){
    const reader=r.result.body.getReader(),chunks=[];let length=0;
    try{for(;;){const {done,value}=await r.read(reader.read());if(done)break;length+=value.byteLength;if(length>64*1024*1024)throw new Error('Track exceeds media limit');chunks.push(value)}const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}return result}
    finally{reader.cancel().catch(()=>{});reader.releaseLock()}
  }
  async function play(t,track){
    if(!track)return;check(t);const revision=++playRevision;
    if(current){try{await savePosition(t,current,playback,audio.currentTime)}catch(e){if(e.name==='AbortError')throw e;tell(`Previous position save failed: ${e.message}`,true)}}
    check(t);const r=await response(t,`api/tracks/${path(track.id,'trk')}/media`);let blob;try{blob=new Blob([await mediaBytes(r)],{type:'audio/wav'});check(t)}finally{r.finish()}
    if(revision!==playRevision)return;const url=URL.createObjectURL(blob);urls.add(url);releaseURL(mediaURL);mediaURL=url;audio.pause();current=track;playback=crypto.randomUUID();lastSave=Date.now();audio.src=url;audio.currentTime=(snapshot.listener.positions?.[track.id]||0)/1000;audio.volume=Number($('#volume').value);await audio.play();check(t);if(revision!==playRevision)return;$('#nowTitle').textContent=track.title;$('#nowArtist').textContent=track.artistName;tell(`Playing ${track.title}`);
  }
  async function adjacent(t,direction){const ids=snapshot.listener.queue?.length?snapshot.listener.queue:tracks().map(t=>t.id);if(!ids.length)return;const at=ids.indexOf(current?.id),index=at<0?(direction>0?0:ids.length-1):(at+direction+ids.length)%ids.length;await play(t,allTracks().find(t=>t.id===ids[index]))}
  async function openCase(t,id,kind='report'){const reason=await ask(t,'Reason and evidence context');check(t);if(!reason)return;const c=await json(t,'api/cases','POST',{kind,trackID:id,reason,evidenceRef:''},`music-trust-${crypto.randomUUID()}`);await load(t);tell(`Trust case ${c.id} opened`)}
  async function streamAI(t,id){
    aiCancel?.();$('#aiOutput').textContent='Connecting to YNX AI Gateway…';const r=await response(t,`api/ai/proposals/${path(id,'ai')}/stream`);
    aiCancel=r.cancel;$('#aiCancel').disabled=false;
    const reader=r.result.body.getReader();
    try{const decoder=new TextDecoder();let text='';for(;;){const {done,value}=await r.read(reader.read());check(t);if(done)break;text+=decoder.decode(value,{stream:true});if(text.length>1024*1024){await reader.cancel();throw new Error('AI result exceeds the supported limit')}$('#aiOutput').textContent=text}await load(t);const final=await json(t,`api/ai/proposals/${path(id,'ai')}`);if(final.status!=='completed')throw new Error('AI result is not complete');$('#aiOutput').textContent=final.result||'';tell('Review the provider result before applying.')}finally{reader.cancel().catch(()=>{});reader.releaseLock();r.cancel();r.finish();if(aiCancel===r.cancel){aiCancel=null;$('#aiCancel').disabled=true}}
  }
  async function reviewAI(t,id,action){const name=action==='apply'?await ask(t,'Playlist name','AI library proposal'):'';check(t);if(action==='apply'&&!name)return;await json(t,`api/ai/proposals/${path(id,'ai')}/review`,'POST',{action,name});await load(t)}
  $('#musicDisconnect').onclick=()=>{reset();tell('Music disconnected on this page. Private account data is preserved on the service.')};
  $('#aiCancel').onclick=()=>aiCancel?.();
  const click=(id,action)=>$('#'+id).onclick=()=>run(action);
  click('savePrivacy',async t=>{const profile={displayName:$('#profileName').value,bio:$('#profileBio').value,explicitAllowed:$('#explicitAllowed').checked,privateHistory:$('#privateHistory').checked};await json(t,'api/profile','PUT',profile);await load(t);tell('Profile and privacy saved.')});
  click('onboard',async t=>{await json(t,'api/creator/onboarding','POST',{displayName:snapshot.profile.displayName,bio:snapshot.profile.bio||''});await load(t)});
  click('playlistFromFavorites',async t=>{const ids=[...(snapshot.listener.favorites||[])];if(!ids.length)throw new Error('Favorite tracks before creating a playlist.');const name=await ask(t,'Playlist name');check(t);if(!name)return;await json(t,'api/playlists','POST',{name,description:'Created from selected real library records',trackIDs:ids});await load(t)});
  click('playLibrary',t=>play(t,allTracks().find(x=>x.id===snapshot.listener.favorites?.[0])||tracks()[0]));click('playPause',async t=>{if(!current)return play(t,tracks()[0]);if(audio.paused){await audio.play();check(t)}else audio.pause()});click('next',t=>adjacent(t,1));click('previous',t=>adjacent(t,-1));
  click('detailPlay',t=>{const track=detail;$('#trackDialog').close();return play(t,track)});
  const favorite=async(t,id)=>saveLibrary(t,l=>{const ids=new Set(l.favorites||[]);ids.has(id)?ids.delete(id):ids.add(id);return {favorites:[...ids]}});
  click('detailFavorite',t=>favorite(t,detail?.id));click('favorite',t=>current&&favorite(t,current.id));click('detailQueue',t=>{const id=detail?.id;return saveLibrary(t,l=>({queue:[...new Set([...(l.queue||[]),id])]}))});click('detailReport',t=>openCase(t,detail?.id));
  click('detailDownload',async t=>{const track=detail;const r=await response(t,`api/tracks/${path(track.id,'trk')}/media`);let bytes;try{bytes=await mediaBytes(r);check(t)}finally{r.finish()}if(bytes.byteLength>64*1024*1024)throw new Error('Track exceeds download limit');const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');check(t);if(digest!==track.audioSha256)throw new Error('Media checksum mismatch');const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));urls.add(url);const link=node('a');link.href=url;link.download=`${track.id}.wav`;link.click();setTimeout(()=>releaseURL(url),60000);tell('Verified audio passed to the browser download manager. Saving the file is controlled by your browser.');});
  click('aiDraft',async t=>{const kind=$('#aiKind').value,owned=(snapshot.creatorTracks||[]).map(t=>t.id),ids=['metadata','creator_description'].includes(kind)?owned:[...new Set([...owned,...(snapshot.listener.favorites||[])])];if(!ids.length)throw new Error('Select real owned or favorite tracks first.');await json(t,'api/ai/proposals','POST',{kind,intent:$('#aiIntent').value,provider:'ynx-ai-gateway',model:'operator-selected',trackIDs:ids,permission:true,outputLanguage:doc.documentElement.lang||'en',explanationRequired:true});await load(t)});
  function submit(id,action){$('#'+id).onsubmit=e=>{e.preventDefault();const form=e.currentTarget;run(t=>action(t,form))}}
  submit('uploadForm',async(t,form)=>{const data=new FormData(form);data.set('explicit',String(data.get('explicit')==='on'));const r=await response(t,'api/creator/tracks',{method:'POST',body:data});try{const record=await r.result.json();check(t);if(!validID(record.id,'trk'))throw new Error('Upload record missing');form.reset();await load(t);tell(`${record.title} uploaded as a private draft.`)}finally{r.finish()}});
  submit('allocationForm',async(t,form)=>{const data=new FormData(form),amountMicros=Number(data.get('amountMicros'));if(!Number.isSafeInteger(amountMicros)||amountMicros<1)throw new Error('Enter a positive whole revenue amount.');await json(t,'api/creator/allocations','POST',{sourceRecord:data.get('sourceRecord'),amountMicros,usageRecordIDs:[...form.querySelectorAll('[name=usage]:checked')].map(x=>x.value)});await load(t)});
  submit('settlementForm',async(t,form)=>{const data=new FormData(form),allocationID=data.get('allocationID');const settlement=await json(t,'api/creator/settlements','POST',{allocationID,payTo:data.get('payTo')},`music-pay-${allocationID}`);await load(t);tell(`Settlement ${settlement.id} requires explicit Wallet review; it is not paid.`)});
  $('#searchInput').oninput=()=>run(async t=>{const revision=++searchRevision;const found=await json(t,`api/catalog?q=${encodeURIComponent($('#searchInput').value)}`);if(revision===searchRevision)renderCatalog(found.tracks||[])});
  audio.addEventListener('timeupdate',()=>{if(!current||!snapshot)return;$('#elapsed').textContent=fmt(audio.currentTime*1000);$('#duration').textContent=fmt(audio.duration*1000||current.durationMillis);$('#seek').value=Number.isFinite(audio.duration)&&audio.duration?audio.currentTime/audio.duration*100:0;if(Date.now()-lastSave>10000){lastSave=Date.now();const track=current,session=playback,position=audio.currentTime;run(t=>savePosition(t,track,session,position))}});
  audio.addEventListener('pause',()=>{if(current&&snapshot){const track=current,session=playback,position=audio.currentTime;run(t=>savePosition(t,track,session,position))}$('#playPause').textContent='▶'});audio.addEventListener('play',()=>$('#playPause').textContent='Ⅱ');audio.addEventListener('ended',()=>{if(current&&snapshot){const track=current,session=playback,position=audio.currentTime;run(t=>savePosition(t,track,session,position,true))}});
  return {activate,dispose:reset,load:()=>run(t=>load(t)),showView,isActive:()=>!!snapshot};
}

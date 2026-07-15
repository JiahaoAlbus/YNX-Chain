const API=localStorage.getItem("ynx.video.api")||"http://127.0.0.1:8423";
const $=selector=>document.querySelector(selector);
let current=null,lastWatchPosition=0;
const session=()=>sessionStorage.getItem("ynx.video.session")||new URLSearchParams(location.hash.slice(1)).get("session");

export async function api(path,options={}){
  const headers={...(options.headers||{})};if(session())headers.Authorization=`Bearer ${session()}`;
  const response=await fetch(API+path,{...options,headers});const data=await response.json().catch(()=>({error:"Invalid service response"}));
  if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;
}
const json=(body)=>({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
function notice(message,bad=false){$("#notice").textContent=message;$("#notice").style.color=bad?"#8b1e2d":"#344054"}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function empty(title,detail="No placeholder records are shown."){$("#content").innerHTML=`<div class="empty"><h2>${esc(title)}</h2><p>${esc(detail)}</p></div>`}
function activate(button){document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x===button))}

function videoCard(video){
  const article=document.createElement("article");article.className="card";
  const thumb=video.thumbnail_key?`<img class="thumb image" src="${API}/media/${encodeURI(video.thumbnail_key)}" alt="">`:`<div class="thumb">▶</div>`;
  const state=video.takedown?.state?`Takedown: ${video.takedown.state}`:`${video.status} · ${video.visibility}`;
  article.innerHTML=`<button class="card-open" aria-label="Play ${esc(video.title)}">${thumb}</button><h2>${esc(video.title)}</h2><p class="meta">${esc(state)}</p><p>${esc(video.description||"No description")}</p>`;
  article.querySelector("button").onclick=()=>openVideo(video);return article;
}
function renderVideos(videos,title){const box=$("#content");box.replaceChildren();if(!videos.length){empty(title);return}box.append(...videos.map(videoCard))}
async function loadVideos(query=""){try{const videos=await api(`/v1/videos?q=${encodeURIComponent(query)}`);renderVideos(videos,query?"No matching published videos":"No published videos yet");notice(`${videos.length} persisted video record${videos.length===1?"":"s"}`)}catch(error){empty("Video service unavailable","Connect a Wallet-authorized product session and retry.");notice(error.message,true)}finally{$("#content").setAttribute("aria-busy","false")}}

async function openVideo(video){
  current=video;lastWatchPosition=0;$("#player-title").textContent=video.title;$("#player-state").textContent=video.takedown?`Unavailable: ${video.takedown.reason}`:`${video.captions?.length||0} caption track(s) · ${video.status}`;
  const media=$("#video");media.replaceChildren();const hls=video.variants?.find(v=>v.mime==="application/vnd.apple.mpegurl"),fallback=video.variants?.find(v=>v.name==="original-fallback");
  const chosen=hls&&media.canPlayType(hls.mime)?hls:fallback||hls;if(chosen)media.src=`${API}/media/${chosen.object_key}`;else media.removeAttribute("src");
  for(const caption of video.captions||[]){if(!caption.human_approved)continue;const track=document.createElement("track");track.kind="captions";track.label=caption.label;track.srclang=caption.language;track.src=`${API}/media/${caption.object_key}`;media.append(track)}
  await loadComments();$("#player").showModal();
}
async function loadComments(){if(!current)return;try{const comments=await api(`/v1/videos/${current.id}/comments`);$("#comments").innerHTML=comments.length?comments.map(c=>`<article><b>${esc(c.Author||c.author)}</b><p>${esc(c.Body||c.body)}</p></article>`).join(""):"<p class=\"meta\">No comments yet.</p>"}catch(error){$("#comments").textContent=error.message}}
async function flushWatch(completed=false){if(!current||!session())return;const position=Math.floor($("#video").currentTime||0),seconds=Math.max(0,position-lastWatchPosition);if(seconds<1)return;lastWatchPosition=position;try{await api(`/v1/videos/${current.id}/watch`,json({seconds,completed}))}catch(error){notice(`Watch history not saved: ${error.message}`,true)}}

async function showSubscriptions(button){activate(button);try{const channels=await api("/v1/subscriptions");const box=$("#content");box.replaceChildren();if(!channels.length){empty("Subscriptions are empty");return}for(const channel of channels){const article=document.createElement("article");article.className="card";article.innerHTML=`<div class="thumb">@</div><h2>${esc(channel.Name||channel.name)}</h2><p class="meta">@${esc(channel.Handle||channel.handle)}</p><button>Open channel</button>`;article.querySelector("button").onclick=()=>showChannel(channel.ID||channel.id);box.append(article)}}catch(error){notice(error.message,true)}}
async function showChannel(channelID){try{const view=await api(`/v1/channels/${channelID}`),channel=view.channel;renderVideos(view.videos||[],`@${channel.Handle||channel.handle} has no published videos`);notice(`${channel.Name||channel.name} · ${view.subscribers} persisted subscriber(s)`);$("#player").open&&$("#player").close()}catch(error){notice(error.message,true)}}
async function showPlaylists(button){activate(button);try{const lists=await api("/v1/playlists");const box=$("#content");box.replaceChildren();if(!lists.length){empty("Playlists are empty");return}for(const list of lists){const ids=list.VideoIDs||list.video_ids||[];const article=document.createElement("article");article.className="card";article.innerHTML=`<div class="thumb">≡</div><h2>${esc(list.Name||list.name)}</h2><p class="meta">${ids.length} saved video(s)</p>`;box.append(article)}}catch(error){notice(error.message,true)}}
async function showHistory(button){activate(button);try{const events=await api("/v1/history");const box=$("#content");box.replaceChildren();if(!events.length){empty("History is empty");return}for(const event of events){const article=document.createElement("article");article.className="card";article.innerHTML=`<h2>${esc(event.VideoID||event.video_id)}</h2><p>${event.Seconds||event.seconds} watched second(s)</p><p class="meta">${esc(event.CreatedAt||event.created_at)}</p>`;box.append(article)}}catch(error){notice(error.message,true)}}

$("#signin").onclick=()=>{const callback=encodeURIComponent(location.origin+location.pathname);location.href=`ynxwallet://authorize?client=ynx.video.web&chain_id=6423&scopes=video.read%20video.interact&callback=${callback}`};
if(session()){sessionStorage.setItem("ynx.video.session",session());history.replaceState(null,"",location.pathname);$("#session").textContent="Wallet-authorized product session active. No account secret is stored here.";$("#signin").textContent="Wallet connected"}
$("#search").onsubmit=event=>{event.preventDefault();loadVideos($("#query").value)};
$("#close").onclick=async()=>{await flushWatch(false);$("#video").pause();$("#player").close()};
$("#video").addEventListener("pause",()=>flushWatch(false));$("#video").addEventListener("ended",()=>flushWatch(true));
$("#channel").onclick=()=>current&&showChannel(current.channel_id);$("#subscribe").onclick=async()=>{try{await api(`/v1/channels/${current.channel_id}/subscription`,{method:"POST"});notice("Subscription state persisted.")}catch(error){notice(error.message,true)}};
$("#playlist").onclick=async()=>{if(!current)return;try{let lists=await api("/v1/playlists");let selected;if(!lists.length){const name=prompt("Create a playlist");if(!name)return;selected=await api("/v1/playlists",json({name}))}else{const choice=prompt(lists.map((p,i)=>`${i+1}. ${p.Name||p.name}`).join("\n"),"1");if(!choice)return;selected=lists[Number(choice)-1]}const id=selected.ID||selected.id;if(!id)throw new Error("Invalid playlist selection");await api(`/v1/playlists/${id}/videos`,json({video_id:current.id}));notice("Video added to the persisted playlist.")}catch(error){notice(error.message,true)}};
$("#report").onclick=async()=>{const reason=prompt("Reason for human review");if(!reason)return;try{await api(`/v1/videos/${current.id}/reports`,json({reason,details:"Submitted from YNX Video viewer"}));notice("Report submitted for human review. No automatic takedown occurred.")}catch(error){notice(error.message,true)}};
$("#comment").onsubmit=async event=>{event.preventDefault();try{await api(`/v1/videos/${current.id}/comments`,json({body:event.target.elements[0].value}));event.target.reset();await loadComments();notice("Comment persisted.")}catch(error){notice(error.message,true)}};
const nav=[...document.querySelectorAll("nav button")];nav.find(b=>b.dataset.view==="discover").onclick=event=>{activate(event.currentTarget);loadVideos()};nav.find(b=>b.dataset.view==="subscriptions").onclick=event=>showSubscriptions(event.currentTarget);nav.find(b=>b.dataset.view==="playlists").onclick=event=>showPlaylists(event.currentTarget);nav.find(b=>b.dataset.view==="history").onclick=event=>showHistory(event.currentTarget);
const linkedVideo=new URLSearchParams(location.search).get("video");if(linkedVideo){api(`/v1/videos/${encodeURIComponent(linkedVideo)}`).then(openVideo).catch(error=>{notice(error.message,true);loadVideos()})}else loadVideos();

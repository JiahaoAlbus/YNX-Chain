const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const status=$('#status');
const audio=$('#audio');

function tell(message,error=false){status.textContent=message;status.classList.toggle('error',error)}
function showView(view){
  $$('nav a').forEach(link=>link.classList.toggle('active',link.dataset.view===view));
  $('#libraryPanel').classList.toggle('hidden',view!=='library');
  $('#creatorPanel').classList.toggle('hidden',view!=='creator');
  $('.hero').classList.toggle('hidden',view!=='home');
  $('#trackGrid').classList.add('hidden');
  $('#empty').classList.toggle('hidden',view==='library'||view==='creator');
  if(view==='search'){$('#searchInput').focus();tell('Search becomes available after canonical sign-in in an installed app.')}
}

$$('[data-view]').forEach(control=>control.addEventListener('click',event=>{event.preventDefault();showView(control.dataset.view)}));
$('#searchInput').addEventListener('input',()=>tell('No public commercial catalog is bundled. Sign in on an installed app to search owned or licensed releases.'));
$('#playLibrary').onclick=()=>tell('Playback needs an installed app, a live canonical Wallet session, and an authorized track.',true);
$('#playPause').onclick=()=>tell('Nothing is playing. This public surface never invents catalog activity.',true);
$('#previous').onclick=$('#next').onclick=()=>tell('The queue is empty.');
$('#seek').oninput=event=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(event.target.value)/100};
$('#volume').oninput=event=>audio.volume=Number(event.target.value);
for(const form of $$('form'))form.addEventListener('submit',event=>{event.preventDefault();tell('Creator and settlement changes require the installed app and a canonical Wallet session.',true)});
for(const button of $$('#libraryPanel button, #creatorPanel button, #trackDialog button:not(.close)'))button.onclick=()=>tell('This action is available after canonical Wallet sign-in in the installed app.',true);
$('#trackDialog .close').onclick=()=>$('#trackDialog').close();
fetch('health').then(async response=>{const health=await response.json();if(!response.ok)throw new Error('service integrity check failed');const release=health.build?.release||'local';tell(`Service healthy · ${release} · central registry merge pending. No licensed public catalog or production streaming is claimed.`)}).catch(error=>tell(`Service unavailable · ${error.message}`,true));

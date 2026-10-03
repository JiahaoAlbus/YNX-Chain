// Shipped Music UI with an isolated, synthetic transport. No Wallet authority.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.YNX_PLAYWRIGHT_ROOT||'/Users/huangjiahao/.codex/worktrees/android-installed-gate-main-20261001/apps/finance']}));
const root=path.resolve(__dirname,'../web');
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end('{"build":{"release":"isolated-ai-fixture"}}');return}const f=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));if(!f.startsWith(root+path.sep)){res.writeHead(403).end();return}try{res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(f))}catch{res.writeHead(404).end()}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:320,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));const base=`http://127.0.0.1:${server.address().port}/`;await page.goto(base,{waitUntil:'networkidle'});
 async function setup(mode,status='awaiting_gateway'){
  await page.evaluate(async({mode,status})=>{
   window.mod=await import('./app.js');window.calls=[];window.streamMode=mode;window.streamController=null;window.finishTransport=null;
   window.proposal={id:'ai_'+'1'.repeat(24),kind:'playlist',intent:'Use my retained tracks',provider:'fixture',model:'fixture',estimatedUnits:12,contextTrackIds:[],status,result:''};
   window.snapshot={profile:{account:'actor-a',displayName:'A',creatorStatus:'active'},listener:{favorites:[],queue:[],history:[],positions:{}},catalog:[],creatorTracks:[],playlists:[],usage:[],allocations:[],settlements:[],aiProposals:[proposal]};
   window.transport=async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});const reply=x=>new Response(JSON.stringify(x));
    if(url==='api/me')return reply(snapshot);
    if(url.endsWith('/stream')){
     if(streamMode==='pending')return new Promise(resolve=>window.finishTransport=resolve);
     proposal.status='streaming';
     return new Response(new ReadableStream({start(c){window.streamController=c}}),{headers:{'Content-Type':'text/event-stream'}});
    }
    if(url==='api/ai/proposals/'+proposal.id)return reply(proposal);
    throw Error('Unexpected fixture request '+url);
   };
   await mod.activateMusicBusiness(transport);
  },{mode,status});
  await page.getByRole('link',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Publish owned audio',exact:true}).click();await page.locator('details').evaluate(n=>n.open=true);
 }
 async function start(){await page.getByRole('button',{name:'Stream',exact:true}).click();await page.waitForFunction(()=>streamController||finishTransport);}
 async function send(wire,complete=false){await page.evaluate(({wire,complete})=>{const b=new TextEncoder().encode(wire);for(let i=0;i<b.length;i++)streamController.enqueue(b.slice(i,i+1));if(complete)streamController.close()},{wire,complete});}
 await setup('stream');await start();await send('event: token\r\ndata: {"text":"你好 🎵"}\r\n\r\n');await page.waitForFunction(()=>document.querySelector('#aiOutput').textContent==='你好 🎵');assert.equal(await page.getByRole('button',{name:'Apply',exact:true}).count(),0);
 await page.evaluate(()=>{proposal.status='completed';proposal.result='Saved original result 你好 🎵'});await send('event: done\r\ndata: {}\r\n\r\n',true);await page.waitForFunction(()=>document.querySelector('#aiCancel').disabled);assert.equal(await page.locator('#aiOutput').innerText(),'Saved original result 你好 🎵');assert.match(await page.locator('#aiStreamStatus').innerText(),/Saved result ready/);assert.equal(await page.getByRole('button',{name:'Apply',exact:true}).count(),1);assert.equal(await page.evaluate(()=>calls.filter(c=>c.url.endsWith('/stream')).length),1);console.log('PASS split UTF-8/CRLF tokens show plain partial text; original authenticated GET readback supplies final result');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);await page.screenshot({path:path.resolve(__dirname,'../central/evidence/ai-web-recovery-20261003/completed-320.png'),fullPage:true});
 await setup('stream');await start();await send('event: token\ndata: {"text":"Preserved partial"}\n\n',true);await page.waitForFunction(()=>document.querySelector('#aiCancel').disabled);assert.equal(await page.getByRole('button',{name:'Apply',exact:true}).count(),0);assert.match(await page.locator('#aiStreamStatus').innerText(),/Completion is not confirmed/);assert.equal(await page.getByRole('button',{name:'Stream',exact:true}).count(),0);await page.getByRole('button',{name:'Check saved result',exact:true}).click();await page.waitForFunction(()=>calls.filter(c=>c.url==='api/ai/proposals/'+proposal.id).length===2);assert.equal(await page.evaluate(()=>calls.filter(c=>c.url.endsWith('/stream')).length),1);await page.screenshot({path:path.resolve(__dirname,'../central/evidence/ai-web-recovery-20261003/interrupted-320.png'),fullPage:true});console.log('PASS missing done preserves original streaming proposal; status check is GET-only and never resends or exposes Apply');
 await setup('stream');await start();await send('event: done\ndata: {}\n\n',true);await page.waitForFunction(()=>document.querySelector('#aiCancel').disabled);assert.equal(await page.getByRole('button',{name:'Apply',exact:true}).count(),0);assert.match(await page.locator('#aiStreamStatus').innerText(),/Completion is not confirmed/);console.log('PASS transport done without saved completion cannot enable Apply');
 await setup('pending');await start();await page.locator('#aiCancel').click();await page.waitForFunction(()=>document.querySelector('#aiCancel').disabled);assert.equal(await page.evaluate(()=>proposal.status),'awaiting_gateway');await page.evaluate(()=>finishTransport(new Response('event: token\ndata: {"text":"Late transport"}\n\nevent: done\ndata: {}\n\n')));assert.equal(await page.locator('#aiOutput').innerText(),'');console.log('PASS cancel settles pending transport before response; late body cannot overwrite retained proposal');
 await setup('stream');await start();await send('event: token\ndata: {"text":"Partial original"}\n\n');await page.waitForFunction(()=>document.querySelector('#aiOutput').textContent==='Partial original');await page.evaluate(()=>{proposal.status='completed';proposal.result='Saved despite lost terminal'});await page.locator('#aiCancel').click();await page.waitForFunction(()=>document.querySelector('#aiCancel').disabled);assert.equal(await page.locator('#aiOutput').innerText(),'Saved despite lost terminal');assert.equal(await page.evaluate(()=>calls.filter(c=>c.url.endsWith('/review')).length),0);console.log('PASS cancellation after durable completion recovers saved result without applying it');
 await setup('pending');await start();await page.evaluate(async()=>{snapshot={...snapshot,profile:{account:'actor-b',displayName:'B',creatorStatus:'active'},aiProposals:[]};await mod.activateMusicBusiness(transport)});await page.evaluate(()=>finishTransport(new Response('event: token\ndata: {"text":"Private A result"}\n\nevent: done\ndata: {}\n\n')));assert.equal(await page.locator('#aiOutput').innerText(),'');assert.equal(await page.locator('#aiRecords').innerText(),'');assert.equal(await page.locator('#profileName').inputValue(),'B');console.log('PASS account replacement discards late A tokens and proposals');
 await page.reload({waitUntil:'networkidle'});await setup('stream','streaming');await page.getByRole('button',{name:'Check saved result',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#aiStreamStatus').textContent.startsWith('Completion is not confirmed'));assert.equal(await page.evaluate(()=>calls.filter(c=>c.url.endsWith('/stream')).length),0);await page.evaluate(()=>{proposal.status='completed';proposal.result='Recovered original record'});await page.getByRole('button',{name:'Check saved result',exact:true}).click();await page.getByRole('button',{name:'View saved result',exact:true}).waitFor();await page.getByRole('button',{name:'View saved result',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#aiOutput').textContent==='Recovered original record');assert.equal(await page.evaluate(()=>calls.filter(c=>c.url.endsWith('/stream')).length),0);console.log('PASS fresh page reads existing streaming/completed records, shows saved result, zero generation redispatch');
 // Real pointer clicks at normal and enlarged text, with the bottom rows reserved.
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  await page.getByRole('button',{name:'View saved result',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
  assert.equal(await page.locator('#aiOutput').evaluate(n=>getComputedStyle(n).fontSize),'32px');
  const hit=await page.getByRole('button',{name:'View saved result',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))});assert.equal(hit,true);
  await page.screenshot({path:path.resolve(__dirname,`../central/evidence/ai-web-recovery-20261003/saved-large-${width}.png`),fullPage:true});
 }
 console.log('PASS 320/390 enlarged text: saved-result button receives actual pointer click, 32px result text, no horizontal overflow');
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1;server.close()});

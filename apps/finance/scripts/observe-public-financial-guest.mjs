import {chromium} from '../../quant-lab/node_modules/playwright/index.mjs';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';

// Non-sensitive public observation, not release acceptance. Fresh contexts,
// no credentials or provider injection, no clicks, and non-GET requests blocked.
const root=fileURLToPath(new URL('../../../',import.meta.url));
const targets=[{product:'finance',origin:'https://finance.ynxweb4.com',folder:'finance',probes:['/health','/version']},{product:'exchange',origin:'https://exchange.ynxweb4.com',folder:'exchange',probes:['/health','/version']},{product:'quant',origin:'https://quant.ynxweb4.com',folder:'quant-lab',probes:['/api/health','/api/version']}];
const sha=b=>createHash('sha256').update(b).digest('hex');
const output=await mkdtemp(path.join(os.tmpdir(),'ynx-financial-public-guest-'));
const report={classification:'DIRECT_PUBLIC_GUEST_READ_ONLY_NOT_COMPLETION',observedAt:new Date().toISOString(),ownerHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),browser:null,products:[],truth:{sourceBound:false,accountApproval:false,signatures:false,transactions:false,productSession:false,installed:false,computerControl:false,productComplete:false}};
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});report.browser=await browser.version();
  for(const target of targets){
    const result={product:target.product,origin:target.origin,expectedAppSha256:sha(await readFile(path.join(root,'apps',target.folder,'web/app.js'))),http:[],views:[]};
    for(const width of [1280,390]){
      const context=await browser.newContext({viewport:{width,height:844}}),blocked=[],errors=[],consoleClasses=[];
      try{
        await context.route('**/*',route=>{
          if(route.request().method()!=='GET'){blocked.push({method:route.request().method(),pathname:new URL(route.request().url()).pathname});return route.abort('blockedbyclient');}
          return route.continue();
        });
        const page=await context.newPage();page.on('pageerror',e=>errors.push(sha(Buffer.from(e.message))));page.on('console',m=>{if(['error','warning'].includes(m.type()))consoleClasses.push({type:m.type(),messageSha256:sha(Buffer.from(m.text()))});});
        const view={width,navigation:null};
        try{
          const response=await page.goto(target.origin,{waitUntil:'load',timeout:15000});
          if(response){const b=await response.body();view.navigation={status:response.status(),bytes:b.length,sha256:sha(b),mime:response.headers()['content-type']??null};}
          view.visible=await page.evaluate(()=>({url:location.origin+location.pathname,lang:document.documentElement.lang,dir:document.documentElement.dir,title:document.title,overflow:document.documentElement.scrollWidth>innerWidth,heading:[...document.querySelectorAll('h1,h2')].filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()).slice(0,12),walletButtons:[...document.querySelectorAll('button,a')].filter(e=>e.getClientRects().length&&/wallet|metamask/i.test(e.textContent)).map(e=>({tag:e.tagName,id:e.id,text:e.textContent.trim(),href:e.tagName==='A'?e.getAttribute('href'):null})).slice(0,16),scripts:[...document.scripts].filter(e=>e.src).map(e=>new URL(e.src).pathname+new URL(e.src).search)}));
          const screenshot=await page.screenshot({fullPage:false});const name=target.product+'-'+width+'.png';await writeFile(path.join(output,name),screenshot);view.screenshot={path:path.join(output,name),bytes:screenshot.length,sha256:sha(screenshot)};
          if(width===1280)for(const probe of [...target.probes,'/app.js']){
            try{
              const response=await context.request.get(target.origin+probe,{timeout:10000,maxRedirects:0});const b=await response.body();
              const receipt={path:probe,status:response.status(),bytes:b.length,sha256:sha(b),mime:response.headers()['content-type']??null};
              if(probe.endsWith('version')&&receipt.mime?.includes('application/json')){try{const v=JSON.parse(b);receipt.versionFields=Object.fromEntries(['commit','sourceCommit','version','release','build'].filter(k=>typeof v[k]==='string').map(k=>[k,v[k]]));}catch{receipt.invalidJSON=true;}}
              result.http.push(receipt);
            }catch(e){result.http.push({path:probe,errorClass:e.name});}
          }
        }catch(e){view.navigationErrorClass=e.name;}
        view.pages=context.pages().length;view.blockedNonGet=blocked;view.pageErrorDigests=errors;view.consoleClasses=consoleClasses;result.views.push(view);
      }finally{await context.close();}
    }
    result.appMatchesOwner=result.http.find(v=>v.path==='/app.js')?.sha256===result.expectedAppSha256;
    report.products.push(result);console.log(JSON.stringify({product:result.product,appMatchesOwner:result.appMatchesOwner,http:result.http,views:result.views.map(v=>({width:v.width,status:v.navigation?.status,error:v.navigationErrorClass,pages:v.pages,lang:v.visible?.lang,blockedNonGet:v.blockedNonGet.length}))}));
  }
}finally{await browser?.close();}
const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');const reportPath=path.join(output,'report.json');await writeFile(reportPath,bytes);
console.log(JSON.stringify({reportPath,bytes:bytes.length,sha256:sha(bytes),classification:report.classification}));

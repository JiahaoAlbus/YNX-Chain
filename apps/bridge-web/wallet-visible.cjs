const {createServer}=require('node:http');
const {readFile,mkdir}=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');

const root=__dirname,port=4380,base=`http://127.0.0.1:${port}/`,output=path.join(root,'evidence/p0-078/screenshots');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.json':'application/json'};
const server=createServer(async(request,response)=>{const pathname=new URL(request.url,base).pathname;const file=pathname==='/'?'index.html':pathname.slice(1);if(file.includes('..'))return response.writeHead(400).end();try{const bytes=await readFile(path.join(root,file));response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(bytes)}catch{response.writeHead(404).end()}});
const api={
  '/api/health':{liveBridge:false,startedAt:'2026-08-20T00:00:00Z',degraded:true,routeCount:1,availableProviderCount:0,providerCount:1,transferCount:0,finalizedLocalCount:0,providerStatus:'unavailable',contractStatus:'unverified',reconciliationStatus:'not-started',stateIntegrity:'verified-local',externalSubmissionEnabled:false},
  '/api/bridge/routes':{routes:[{source:{chain:'Ethereum Sepolia',symbol:'USDC'},destination:{chain:'Base Sepolia',symbol:'USDC'},provider:'Testnet candidate',failureStatus:'dependency-unavailable',executable:false}]},
  '/api/bridge/providers':{providers:[{product:'Testnet candidate',provider:'candidate',executable:false,availability:'review-only',sourceChain:'Ethereum Sepolia',destinationChain:'Base Sepolia',classification:'candidate',authentication:'not active'}]},
};
async function flow(browser,{name,reject}){
  const page=await browser.newPage({viewport:{width:1360,height:900}});
  const errors=[];
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.route('**/api/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(api[pathname])});
  });
  await page.addInitScript(({reject})=>{
    const provider={async request({method}){
      if(method==='eth_requestAccounts'){
        if(reject)throw Object.assign(new Error('User rejected the request'),{code:4001});
        return ['0x1111111111111111111111111111111111111111'];
      }
      if(method==='eth_chainId')return '0x1917';
      throw new Error(method);
    }};
    window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{
      info:{uuid:'00000000-0000-4000-8000-000000000078',name:'YNX Wallet',rdns:'com.ynx.wallet',icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"},
      provider,
    }})));
  },{reject});
  const response=await page.goto(base,{waitUntil:'networkidle'});
  if(!response?.ok())throw new Error(`${name}: navigation failed`);
  await page.getByRole('button',{name:'Connect Wallet'}).click();
  await page.getByRole('button',{name:'Connect YNX Wallet'}).click();
  if(reject){
    await page.getByText('No bridge transfer or private session was created.',{exact:false}).waitFor();
    if(await page.getByText(/0x1111/i).count())throw new Error('Rejected flow exposed account');
  }else{
    await page.getByRole('button',{name:/connected on YNX Testnet/i}).waitFor();
    await page.getByText('transfer stays unavailable',{exact:false}).waitFor();
  }
  if(!(await page.getByRole('button',{name:'Transfer unavailable'}).isDisabled()))throw new Error('Transfer became enabled');
  if(errors.length)throw new Error(errors.join(' | '));
  await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});
  await page.close();
}
(async()=>{await mkdir(output,{recursive:true});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});try{await flow(browser,{name:'bridge-wallet-approved',reject:false});await flow(browser,{name:'bridge-wallet-rejected',reject:true})}finally{await browser.close();server.close()}console.log('Bridge visible proof passed: approve/reject, guest evidence, transfer disabled, zero console errors')})().catch(error=>{console.error(error);server.close();process.exitCode=1});

const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const port=4274;
const base=`http://127.0.0.1:${port}/`;
const output=path.resolve(__dirname,'release/evidence/p0-077/screenshots');
mkdirSync(output,{recursive:true});

const server=spawn(process.execPath,[path.join(__dirname,'server.mjs')],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForServer(){
  for(let attempt=0;attempt<40;attempt++){
    try{const response=await fetch(base);if(response.ok)return}catch{}
    await delay(100);
  }
  throw new Error('Video server did not become ready');
}

async function runFlow(browser,{name,reject}){
  const page=await browser.newPage({viewport:{width:1280,height:820},colorScheme:'light'});
  const errors=[];
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.route('http://127.0.0.1:8423/**',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.addInitScript(({reject})=>{
    const account='0x1111111111111111111111111111111111111111';
    const provider={
      async request({method}){
        if(method==='eth_requestAccounts'){
          if(reject)throw Object.assign(new Error('User rejected the request'),{code:4001});
          return [account];
        }
        if(method==='eth_chainId')return '0x1917';
        throw new Error(`Unexpected method ${method}`);
      },
      on(){},
      removeListener(){},
    };
    window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{
      info:{uuid:'00000000-0000-4000-8000-000000000077',name:'YNX Wallet',rdns:'com.ynx.wallet',icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"},
      provider,
    }})));
  },{reject});
  const response=await page.goto(base,{waitUntil:'networkidle'});
  if(!response?.ok())throw new Error(`${name}: navigation failed`);
  await page.getByRole('button',{name:'Connect Wallet'}).click();
  if(reject){
    await page.getByText('Wallet approval was rejected.',{exact:false}).waitFor();
    if(await page.getByText(/0x1111/i).count())throw new Error('Rejected Wallet request exposed an account');
    if(await page.locator('#signin').textContent()!=='Connect Wallet')throw new Error('Rejected Wallet request changed connection state');
  }else{
    await page.getByRole('button',{name:/YNX Wallet · 0x1111/i}).waitFor();
    await page.getByText('Standard Wallet connected on YNX Testnet (0x1917).',{exact:false}).waitFor();
    await page.getByText('no private Product Session was fabricated.',{exact:false}).waitFor();
  }
  await page.getByText('No published videos',{exact:false}).waitFor();
  if(errors.length)throw new Error(`${name}: console errors: ${errors.join(' | ')}`);
  await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});
  await page.close();
}

(async()=>{
  await waitForServer();
  const browser=await chromium.launch({headless:true});
  try{
    await runFlow(browser,{name:'video-wallet-approved',reject:false});
    await runFlow(browser,{name:'video-wallet-rejected',reject:true});
  }finally{await browser.close()}
  console.log('Video Wallet visible proof passed: approve/reject, guest catalog, zero console errors');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>server.kill('SIGTERM'));

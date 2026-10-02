const {chromium}=require("playwright");
const path=require("node:path");

(async()=>{
  const base=process.env.YNX_MUSIC_WEB_URL||"http://127.0.0.1:17436/";
  const output=path.resolve(__dirname,"../evidence/screenshots/web");
  const browser=await chromium.launch({headless:true});
  for(const sample of [
    {name:"desktop-light-1440x900",width:1440,height:900,colorScheme:"light"},
    {name:"desktop-dark-1440x900",width:1440,height:900,colorScheme:"dark"},
    {name:"mobile-light-390x844",width:390,height:844,colorScheme:"light"},
  ]){
    const page=await browser.newPage({viewport:{width:sample.width,height:sample.height},colorScheme:sample.colorScheme});
    const errors=[];page.on("console",msg=>{if(msg.type()==="error")errors.push(msg.text())});
    const response=await page.goto(base,{waitUntil:"networkidle"});
    if(!response||!response.ok())throw new Error(`${sample.name}: navigation failed`);
    if(await page.title()!=="YNX Music")throw new Error(`${sample.name}: wrong product surface`);
    if(await page.locator("text=No published tracks yet").count()!==1)throw new Error(`${sample.name}: truthful empty state missing`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
    if(overflow)throw new Error(`${sample.name}: horizontal overflow`);
    if(errors.length)throw new Error(`${sample.name}: console errors: ${errors.join(" | ")}`);
    await page.screenshot({path:path.join(output,`${sample.name}.png`)});
    await page.close();
  }
  for(const sample of [{name:"wallet-approved",reject:false},{name:"wallet-rejected",reject:true}]){
    const page=await browser.newPage({viewport:{width:1280,height:820},colorScheme:"light"});
    const errors=[];page.on("console",msg=>{if(msg.type()==="error")errors.push(msg.text())});
    await page.addInitScript(({reject})=>{
      const account="0x1111111111111111111111111111111111111111";
      const provider={
        async request({method}){
          if(method==="eth_requestAccounts"){
            if(reject)throw Object.assign(new Error("User rejected the request"),{code:4001});
            return [account];
          }
          if(method==="eth_chainId")return "0x1917";
          throw new Error(`Unexpected method ${method}`);
        },
      };
      window.addEventListener("eip6963:requestProvider",()=>{
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{
          info:{uuid:"00000000-0000-4000-8000-000000000001",name:"YNX Wallet",rdns:"com.ynx.wallet",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"},
          provider,
        }}));
      });
    },{reject:sample.reject});
    const response=await page.goto(base,{waitUntil:"networkidle"});
    if(!response||!response.ok())throw new Error(`${sample.name}: navigation failed`);
    await page.getByRole("button",{name:"Connect Wallet"}).click();
    await page.getByRole("button",{name:"Connect YNX Wallet"}).click();
    if(sample.reject){
      await page.getByText("No Music account or private session was created.",{exact:false}).waitFor();
      if(await page.getByRole("button",{name:/account .* connected/i}).count())throw new Error("Rejected request produced a connected account");
    }else{
      await page.getByRole("button",{name:/connected on YNX Testnet/i}).waitFor();
      await page.getByText("Private library, upload, royalties and settlement remain unavailable.",{exact:false}).waitFor();
    }
    if(errors.length)throw new Error(`${sample.name}: console errors: ${errors.join(" | ")}`);
    await page.screenshot({path:path.join(output,`${sample.name}.png`),fullPage:true});
    await page.close();
  }
  await browser.close();
  console.log("Playwright passed: desktop light/dark, mobile, wallet approve and reject truth boundaries");
})().catch(error=>{console.error(error);process.exit(1)});

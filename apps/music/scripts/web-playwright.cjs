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
  await browser.close();
  console.log("Playwright passed: desktop light/dark 1440x900 and mobile 390x844");
})().catch(error=>{console.error(error);process.exit(1)});

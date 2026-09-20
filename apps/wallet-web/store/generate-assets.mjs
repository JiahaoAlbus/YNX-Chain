import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createServer} from "node:https";
import {copyFile,mkdir,mkdtemp,readFile,rm,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import sharp from "sharp";

const store=resolve(dirname(fileURLToPath(import.meta.url)));
const root=resolve(store,"..");
const extensionPath=join(root,"dist","chromium");
const assets=join(store,"assets");
const screenshots=join(assets,"screenshots");
const logoPath=join(root,"public","ynx-logo.png");
const iconPath=join(assets,"icon-128.png");
const edgeLogoPath=join(assets,"logo-300.png");
const promoPath=join(assets,"promo-small-440x280.png");

const repository=resolve(root,"..","..");
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:repository,encoding:"utf8"}).trim();
execFileSync(process.execPath,["scripts/build.mjs"],{cwd:root,stdio:"inherit",env:{...process.env,YNX_WALLET_WEB_SOURCE_COMMIT:sourceCommit}});
await rm(assets,{recursive:true,force:true});
await mkdir(screenshots,{recursive:true});
await copyFile(join(extensionPath,"ynx-icon-128.png"),iconPath);
const logo=await sharp(logoPath).trim().toBuffer();
const edgeArtwork=await sharp(logo).resize(240,240,{fit:"contain",kernel:"lanczos3"}).png({compressionLevel:9,adaptiveFiltering:false,palette:false}).toBuffer();
await sharp({create:{width:300,height:300,channels:4,background:{r:255,g:255,b:255,alpha:1}}}).composite([{input:edgeArtwork,gravity:"center"}]).png({compressionLevel:9,adaptiveFiltering:false,palette:false}).toFile(edgeLogoPath);
const promoArtwork=await sharp(logo).resize(300,150,{fit:"contain",kernel:"lanczos3"}).png({compressionLevel:9,adaptiveFiltering:false,palette:false}).toBuffer();
await sharp({create:{width:440,height:280,channels:4,background:{r:245,g:246,b:248,alpha:1}}}).composite([{input:promoArtwork,gravity:"center"}]).png({compressionLevel:9,adaptiveFiltering:false,palette:false}).toFile(promoPath);

const profile=await mkdtemp(join(tmpdir(),"ynx-wallet-store-assets-"));
const extensionId=[...createHash("sha256").update(extensionPath).digest("hex").slice(0,32)].map(value=>String.fromCharCode(97+Number.parseInt(value,16))).join("");
const keyPath=join(profile,"fixture.key.pem"),certPath=join(profile,"fixture.cert.pem");
execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",keyPath,"-out",certPath,"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{stdio:"ignore"});
const server=createServer({key:await readFile(keyPath),cert:await readFile(certPath)},(_request,response)=>{response.setHeader("content-type","text/html; charset=utf-8");response.end("<!doctype html><title>Wallet store capture fixture</title>")});
await new Promise((accept,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",accept)});
const fixtureUrl=`https://127.0.0.1:${server.address().port}/`;
let context;
try{
  context=await chromium.launchPersistentContext(profile,{executablePath:"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",headless:true,ignoreHTTPSErrors:true,viewport:{width:1280,height:800},ignoreDefaultArgs:["--disable-extensions"],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,"--no-first-run","--no-default-browser-check"]});
  const activePage=context.pages()[0]||await context.newPage();
  await activePage.goto(fixtureUrl,{waitUntil:"domcontentloaded"});
  const session=await context.browser().newBrowserCDPSession();
  for(const [locale,name] of [["en","wallet-en-1280x800.png"],["zh-CN","wallet-zh-CN-1280x800.png"]]){
    const url=`chrome-extension://${extensionId}/index.html?lang=${encodeURIComponent(locale)}`;
    const pendingPage=context.waitForEvent("page",{predicate:page=>page.url().startsWith(`chrome-extension://${extensionId}/`)});
    await session.send("Target.createTarget",{url,background:true});
    const page=await pendingPage;
    await page.locator("#title").waitFor({state:"visible"});
    await page.waitForTimeout(500);
    await page.screenshot({path:join(screenshots,name),fullPage:false,animations:"disabled"});
    await page.close();
  }
}finally{
  await context?.close();
  await new Promise(resolveClose=>server.close(resolveClose));
  await rm(profile,{recursive:true,force:true});
}

const definitions=[
  ["icon-128.png",128,128,"Chrome Web Store package/listing icon"],
  ["logo-300.png",300,300,"Microsoft Edge Add-ons listing logo"],
  ["promo-small-440x280.png",440,280,"Chrome Web Store small promotional tile"],
  ["screenshots/wallet-en-1280x800.png",1280,800,"English extension UI screenshot"],
  ["screenshots/wallet-zh-CN-1280x800.png",1280,800,"Simplified Chinese extension UI screenshot"],
];
const records=[];
for(const [path,width,height,purpose] of definitions){
  const bytes=await readFile(join(assets,path));
  const metadata=await sharp(bytes).metadata();
  const info=await stat(join(assets,path));
  if(metadata.format!=="png"||metadata.width!==width||metadata.height!==height)throw new Error(`Invalid generated store asset: ${path}`);
  records.push({path:`assets/${path}`,purpose,format:"png",width,height,bytes:info.size,sha256:createHash("sha256").update(bytes).digest("hex")});
}
const manifest={schemaVersion:1,product:"YNX Wallet",manifestVersion:"0.1.1",generatedFrom:"public/ynx-logo.png + current built Chromium extension UI",screenshots:{browser:"Microsoft Edge controlled by Playwright",temporaryUnpackedExtension:true,accountCreated:false,credentialUsed:false,transactionSubmitted:false},assets:records};
await writeFile(join(store,"store-assets.json"),`${JSON.stringify(manifest,null,2)}\n`);
console.log(JSON.stringify(manifest,null,2));

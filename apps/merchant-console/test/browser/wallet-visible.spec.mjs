import {test, expect} from "@playwright/test";
import {createServer} from "node:http";
import {mkdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";

const origin="http://127.0.0.1:4315";
const evidence=resolve("evidence/visible");
const assets=new Map([
  ["/",["index.html","text/html; charset=utf-8"]],
  ["/index.html",["index.html","text/html; charset=utf-8"]],
  ["/app.js",["app.js","text/javascript; charset=utf-8"]],
  ["/runtime-config.js",["runtime-config.js","text/javascript; charset=utf-8"]],
  ["/styles.css",["styles.css","text/css; charset=utf-8"]],
  ["/manifest.webmanifest",["manifest.webmanifest","application/manifest+json"]]
]);
let server;

test.beforeAll(async()=>{
  await mkdir(evidence,{recursive:true});
  server=createServer(async(req,res)=>{
    const asset=assets.get(new URL(req.url,origin).pathname);
    if(!asset){res.writeHead(404,{"content-type":"text/plain"});res.end("not found");return}
    res.writeHead(200,{"content-type":asset[1],"cache-control":"no-store"});
    res.end(await readFile(resolve("dist",asset[0])));
  });
  await new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(4315,"127.0.0.1",resolveListen)});
});
test.afterAll(async()=>{if(server)await new Promise(resolveClose=>server.close(resolveClose))});

async function installProvider(page,{reject=false}={}){
  await page.addInitScript(({reject})=>{
    const provider={
      async request({method}){
        if(method==="eth_requestAccounts"){
          if(reject)throw Object.assign(new Error("User rejected the request."),{code:4001});
          return ["0x1111111111111111111111111111111111111111"];
        }
        if(method==="eth_chainId")return "0x1917";
        throw Object.assign(new Error(`Unsupported deterministic method: ${method}`),{code:4200});
      },
      on(){},
      removeListener(){}
    };
    const detail=Object.freeze({info:Object.freeze({uuid:reject?"merchant-reject":"merchant-approve",name:"YNX Test Wallet",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",rdns:"com.ynxweb4.wallet.test"}),provider});
    addEventListener("eip6963:requestProvider",()=>dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail})));
  },{reject});
}

test("approved deterministic YNX Wallet keeps public preview and private service separated",async({page})=>{
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
  await installProvider(page);
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Merchant Console"})).toBeVisible();
  await page.getByRole("button",{name:"Explore without signing in"}).click();
  await expect(page.getByText("Public capability preview")).toBeVisible();
  await page.getByRole("button",{name:"Connect Wallet"}).click();
  await expect(page.getByText(/Connected 0x11111111…11111111 · 0x1917 · YNX Test Wallet/)).toBeVisible();
  await expect(page.getByText(/Degraded — accepted Endpoint Manifest marks App Gateway unavailable/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Continue to private merchant session"})).toBeDisabled();
  await expect(page.getByText("Public capability preview")).toBeVisible();
  await page.screenshot({path:resolve(evidence,"merchant-wallet-approved-private-degraded-1440x900.png"),fullPage:true});
  expect(errors).toEqual([]);
});

test("rejected deterministic Wallet creates no account and public preview remains available",async({page})=>{
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
  await installProvider(page,{reject:true});
  await page.goto("/");
  await page.getByRole("button",{name:"Connect Wallet"}).click();
  await expect(page.getByText(/Not connected\. Public information remains available\./)).toBeVisible();
  await expect(page.getByText(/rejected/i)).toBeVisible();
  await expect(page.getByRole("button",{name:"Continue to private merchant session"})).toBeDisabled();
  await page.getByRole("button",{name:"Explore without signing in"}).click();
  await expect(page.getByText("Public capability preview")).toBeVisible();
  await page.screenshot({path:resolve(evidence,"merchant-wallet-rejected-public-preview-1440x900.png"),fullPage:true});
  expect(errors).toEqual([]);
});

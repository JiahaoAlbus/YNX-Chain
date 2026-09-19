import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {isIP} from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadEndpointMigration} from "./testnet-endpoint-migration-check.mjs";

const MARKER = "\n__YNX_CURL_METADATA__";
const MAX_BYTES = 2 * 1024 * 1024;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// An explicit origin probe is not a public-DNS result. No SSH, insecure TLS,
// DNS edits, redirects, POSTs, retries, or consumer activation are implemented.
export function validateOrigin(origin) {
  assert.equal(isIP(origin), 4, "origin must be a literal public IPv4 address");
  const [a,b,c] = origin.split(".").map(Number);
  assert.ok(a>0 && a<224 && a!==10 && a!==127 && !(a===100&&b>=64&&b<=127)
    && !(a===169&&b===254) && !(a===172&&b>=16&&b<=31) && !(a===192&&(b===168||b===0))
    && !(a===198&&(b===18||b===19||(b===51&&c===100))) && !(a===203&&b===0&&c===113), "origin must be public, not private/reserved/documentation space");
  return origin;
}

export function routesFor(config, origin = null) {
  if (origin!==null) validateOrigin(origin);
  const routes=[];
  for (const [role, endpoints] of [["legacy",config.testnet.legacyCompatibility],["candidate",config.testnet.canonicalTargets]]) {
    for (const kind of ["rpc","faucet"]) {
      routes.push({role,kind,url:endpoints[kind]+(kind==="rpc"?"/status":"/health"),origin:null});
      if (role==="candidate" && origin) routes.push({role:"candidate-origin",kind,url:endpoints[kind]+(kind==="rpc"?"/status":"/health"),origin});
    }
  }
  return routes;
}

export function curlArguments(route) {
  const url=new URL(route.url);
  assert.equal(url.protocol,"https:");
  assert.ok(["rpc.ynxweb4.com","faucet.ynxweb4.com","rpc-testnet.ynxweb4.com","faucet-testnet.ynxweb4.com"].includes(url.hostname));
  assert.equal(url.pathname,route.kind==="rpc"?"/status":"/health");
  assert.ok(!url.username && !url.password && !url.search && !url.hash && (!url.port || url.port==="443"));
  const args=["--disable","--silent","--show-error","--proto","=https","--request","GET","--connect-timeout","3","--max-time","8","--max-filesize",String(MAX_BYTES),"--write-out",MARKER+"%{json}"];
  if (route.origin) args.push("--resolve",`${url.hostname}:443:${validateOrigin(route.origin)}`);
  args.push(route.url);
  return args;
}

function runCurl(args) {
  return new Promise(resolve=>execFile("curl",args,{timeout:10000,maxBuffer:MAX_BYTES+128*1024,encoding:"utf8"},(error,stdout,stderr)=>resolve({exitCode:error?(Number.isInteger(error.code)?error.code:1):0,stdout,stderr})));
}

export function interpretProbe(route, raw, observedAt = new Date().toISOString()) {
  const result={...route,observedAt,transportVerified:false,identityVerified:false,ready:false};
  const cut=raw.stdout.lastIndexOf(MARKER);
  if (cut<0) return {...result,failure:"missing-curl-metadata",exitCode:raw.exitCode};
  let meta;
  try { meta=JSON.parse(raw.stdout.slice(cut+MARKER.length)); } catch { return {...result,failure:"invalid-curl-metadata",exitCode:raw.exitCode}; }
  const body=raw.stdout.slice(0,cut);
  result.exitCode=raw.exitCode;
  result.httpStatus=meta.http_code;
  result.remoteIP=meta.remote_ip;
  result.timingSeconds=Object.fromEntries(["time_namelookup","time_connect","time_appconnect","time_starttransfer","time_total"].map(k=>[k,meta[k]]));
  result.bodySHA256=createHash("sha256").update(body).digest("hex");
  if (raw.exitCode!==0 || meta.exitcode!==0) return {...result,failure:"transport-failed",curlError:String(meta.errormsg||"").slice(0,240)};
  if (Buffer.byteLength(body)>MAX_BYTES) return {...result,failure:"oversized-body"};
  if (meta.url_effective!==route.url || meta.num_redirects!==0 || meta.ssl_verify_result!==0 || !(meta.time_appconnect>0)) return {...result,failure:"TLS-or-route-unverified"};
  if (route.origin && (meta.remote_ip!==route.origin || meta.proxy_used!==0)) return {...result,failure:"origin-not-directly-observed"};
  result.transportVerified=true;
  if (meta.http_code!==200) return {...result,failure:`HTTP-${meta.http_code}`,deploymentNotFound:body.includes("DEPLOYMENT_NOT_FOUND")};
  let value;
  try { value=JSON.parse(body); } catch { return {...result,failure:"invalid-JSON"}; }
  if (!value || typeof value!=="object" || Array.isArray(value)) return {...result,failure:"invalid-identity"};
  result.identity={chainId:value.chainId,nativeSymbol:value.nativeSymbol??value.nativeCurrencySymbol,height:value.height,build:value.build};
  result.identityVerified=value.chainId===6423 && result.identity.nativeSymbol==="YNXT" && Number.isSafeInteger(value.height) && value.height>0 && /^[0-9a-f]{40}$/.test(value.build?.commit??"");
  if (!result.identityVerified) return {...result,failure:"wrong-or-missing-identity"};
  if (route.kind==="faucet") {
    result.faucet={service:value.service,ok:value.ok,upstreamOk:value.upstreamOk,fundingReady:value.fundingReady,idempotentRequests:value.idempotentRequests,rateLimitMax:value.rateLimitMax,ipRateLimitMax:value.ipRateLimitMax};
    if (value.service!=="ynx-faucetd" || value.ok!==true || value.upstreamOk!==true || value.fundingReady!==true || value.idempotentRequests!==true) return {...result,failure:"faucet-not-ready"};
  }
  return {...result,ready:true};
}

export async function preflight(config,{origin=null,exec=runCurl}={}) {
  const observations=[];
  // Sequential bounded probes are intentional: this is not an external load test.
  for (const route of routesFor(config,origin)) observations.push(interpretProbe(route,await exec(curlArguments(route))));
  const candidates=observations.filter(x=>x.role==="candidate");
  const originRoutes=observations.filter(x=>x.role==="candidate-origin");
  const legacy=observations.filter(x=>x.role==="legacy");
  const matchesLegacy=x=>x.ready && legacy.some(y=>y.kind===x.kind && y.ready && y.identity.build.commit===x.identity.build.commit);
  return {schema:"ynx-testnet-alias-preflight/v1",checkedAt:new Date().toISOString(),readOnly:true,
    candidateReachabilityVerified:candidates.every(matchesLegacy),
    originReachabilityVerified:originRoutes.length===2 && originRoutes.every(matchesLegacy),
    publicVerified:false,consumerActivationAllowed:false,dnsChangeAuthorized:false,
    remainingGates:["target loaded full-proxy config and certificate validation","same-height block/history/contract/state comparison","actual shared Faucet process/DB/quota identity","scoped consumer regressions and explicit activation authority"],observations};
}

export function parseArgs(argv) {
  let live=false,origin=null;
  for (let i=0;i<argv.length;i++) {
    if (argv[i]==="--live" && !live) live=true;
    else if (argv[i]==="--origin" && origin===null && argv[i+1]) origin=validateOrigin(argv[++i]);
    else throw new Error("Usage: testnet-alias-preflight.mjs [--live [--origin <approved-public-ipv4>]]");
  }
  assert.ok(live || origin===null,"--origin requires --live");
  return {live,origin};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options=parseArgs(process.argv.slice(2));
  const config=loadEndpointMigration(ROOT);
  if (!options.live) console.log(JSON.stringify({readOnly:true,networkRequests:0,publicVerified:false,consumerActivationAllowed:false,routes:routesFor(config)}));
  else {
    const report=await preflight(config,options);
    console.log(JSON.stringify(report,null,2));
    if (!report.candidateReachabilityVerified || (options.origin && !report.originReachabilityVerified)) process.exitCode=2;
  }
}

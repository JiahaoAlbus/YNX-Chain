// Branded Firefox uses Mozilla's WebDriver implementation, not Playwright's patched Firefox.
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createHttpsServer} from 'node:https';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bounded,assessFirefoxProviderEvidence} from './runtime-evidence.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const firefox=process.env.YNX_FIREFOX_BRANDED_BINARY,driver=process.env.YNX_GECKODRIVER_BINARY;
if(!firefox?.startsWith('/tmp/ynx-firefox-install.')||!driver?.startsWith('/tmp/ynx-geckodriver-'))throw new Error('Use explicit isolated Firefox and geckodriver binaries under /tmp');
const evidenceDir=resolve(process.env.YNX_WALLET_WEB_EVIDENCE_DIR??join(root,'evidence/runtime/firefox-provider'));
await mkdir(evidenceDir,{recursive:true});
const temporary=await mkdtemp(join(tmpdir(),'ynx-firefox-provider-')),profile=join(temporary,'profile');await mkdir(profile);
const artifact=await readFile(join(root,'artifacts/ynx-wallet-firefox-0.1.1.zip')),artifactPath=join(temporary,'wallet.zip');await writeFile(artifactPath,artifact);
const archiveIdentity=JSON.parse(execFileSync('unzip',['-p',artifactPath,'build-identity.json'],{encoding:'utf8'}));
const fixture=await readFile(join(root,'test/fixtures/dapp-eip6963-frozen.html'));
const key=join(temporary,'key.pem'),cert=join(temporary,'cert.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
const serve=(_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(fixture)};
const https=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},serve),http=createHttpServer(serve);
const listen=server=>new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>done(server.address().port))});
const secureUrl=`https://127.0.0.1:${await listen(https)}/`,plainUrl=`http://127.0.0.1:${await listen(http)}/`;
const portProbe=createTcpServer(),port=await listen(portProbe);await new Promise(done=>portProbe.close(done));
const endpoint=`http://127.0.0.1:${port}`,args=['--host','127.0.0.1','--port',String(port),'--log','debug'];
const result={schemaVersion:1,generatedAt:new Date().toISOString(),runtimeClass:'Mozilla Firefox branded browser; temporary exact ZIP; isolated profile',firefox,driver,driverVersion:execFileSync(driver,['--version'],{encoding:'utf8',timeout:5000}).trim(),driverArgs:args,profile,fixtureUrl:secureUrl,httpFixtureUrl:plainUrl,artifact:{sourceCommit:archiveIdentity.sourceCommit,sha256:createHash('sha256').update(artifact).digest('hex'),bytes:artifact.length},launches:[],passed:false,providerDiscoveryProved:false,chainIdProved:false,coexistenceProved:false,temporaryAddonNonPersistenceProved:false,httpActionInjectionProved:false,accountAuthorized:false,messageSigned:false,transactionSubmitted:false,installedLocal:false,deployedPublic:false};
let log='',child,session;
async function request(method,path,body,timeout=20000){const response=await fetch(endpoint+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});const data=await response.json();if(!response.ok||data.value?.error)throw Object.assign(new Error(data.value?.message??`WebDriver ${response.status}`),{code:data.value?.error});return data.value;}
const command=(method,path,body)=>request(method,`/session/${session}${path}`,body);
async function launch(){const value=await request('POST','/session',{capabilities:{alwaysMatch:{browserName:'firefox',acceptInsecureCerts:true,'moz:firefoxOptions':{binary:firefox,args:['-headless','-profile',profile]}}}});session=value.sessionId;result.launches.push({sessionId:session,capabilities:value.capabilities});await command('POST','/timeouts',{script:8000,pageLoad:12000,implicit:0});}
function ownedBrowserPids(){return execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8',maxBuffer:2_000_000}).split('\n').filter(line=>line.includes(profile)&&line.includes(firefox)).map(line=>Number.parseInt(line.trim(),10)).filter(Number.isInteger);}
async function cleanBrowsers(){const initial=ownedBrowserPids();for(const signal of ['SIGTERM','SIGKILL']){for(const pid of ownedBrowserPids())try{process.kill(pid,signal)}catch{}if(ownedBrowserPids().length)await new Promise(done=>setTimeout(done,500));}return{initial,alive:ownedBrowserPids()};}
async function close(){if(session){await command('DELETE','').catch(error=>{result.shutdownError=error.message});session=undefined;}}
const evaluate=script=>command('POST','/execute/sync',{script,args:[]});
const observationScript=`const page=window.wrappedJSObject||window;const f=page.__YNX_EIP6963_FIXTURE__,foreign=page.__YNX_FOREIGN_FIXTURE__;const items=f?.announcements||[];return {url:location.href,matchingCount:items.filter(x=>x.info?.rdns==='com.ynx.wallet').length,foreignUnchanged:!!foreign&&page.ethereum===foreign.ethereum&&page.ethereum.providers===foreign.providers&&Object.isFrozen(foreign.providers)&&foreign.providers.length===1&&foreign.providers[0]===foreign.provider,restartMarker:localStorage.getItem('ynx.fixture.restart')};`;
async function observation(expectProvider){let value;for(let attempt=0;attempt<25;attempt++){value=await evaluate(observationScript);if(!expectProvider||value.matchingCount===1)break;await new Promise(done=>setTimeout(done,200));}if(expectProvider&&value.matchingCount===1)value.chain=await command('POST','/execute/async',{script:`const done=arguments[arguments.length-1],page=window.wrappedJSObject||window,item=page.__YNX_EIP6963_FIXTURE__.announcements.find(x=>x.info.rdns==='com.ynx.wallet');item.provider.request({method:'eth_chainId'}).then(chainId=>done({chainId,info:item.info,isYNXWallet:item.provider.isYNXWallet,isMetaMask:item.provider.isMetaMask})).catch(error=>done({error:{code:error.code,message:error.message}}));`,args:[]});return value;}
try{
  child=spawn(driver,args,{stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>{log+=data});child.stderr.on('data',data=>{log+=data});
  for(let attempt=0;attempt<50;attempt++){try{await request('GET','/status',undefined,500);break}catch(error){if(attempt===49)throw error;await new Promise(done=>setTimeout(done,100));}}
  await launch();result.addonId=await command('POST','/moz/addon/install',{path:artifactPath,temporary:true});
  await command('POST','/url',{url:secureUrl});result.firstLaunch=await observation(true);await evaluate("localStorage.setItem('ynx.fixture.restart','retained');return true;");
  await command('POST','/url',{url:plainUrl});await new Promise(done=>setTimeout(done,600));result.httpWithoutAction=await observation(false);
  await close();await launch();await command('POST','/url',{url:secureUrl});await new Promise(done=>setTimeout(done,600));result.restartBeforeReload=await observation(false);
  result.reloadedAddonId=await command('POST','/moz/addon/install',{path:artifactPath,temporary:true});await command('POST','/url',{url:secureUrl+'?second-launch'});result.secondLaunch=await observation(true);
  Object.assign(result,assessFirefoxProviderEvidence(result));
}catch(error){result.error={name:error.name,code:error.code??null,message:error.message};}
finally{await close();if(child&&child.exitCode===null){child.kill('SIGTERM');await bounded(new Promise(done=>child.once('exit',done)),3000,'driver shutdown').catch(()=>child.kill('SIGKILL'));}result.browserCleanup=await cleanBrowsers();if(result.shutdownError||result.browserCleanup.alive.length)result.passed=false;for(const server of [https,http]){server.closeAllConnections();await new Promise(done=>server.close(done));}await writeFile(join(evidenceDir,'geckodriver.log'),log);await writeFile(join(evidenceDir,'result.json'),JSON.stringify(result,null,2)+'\n');await rm(temporary,{recursive:true,force:true});}
console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;

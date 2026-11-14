// Controller protocol fixtures only. These cases do not establish native peer
// credentials, human approval, Wallet signatures, node execution or chain funds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,settle} from './test-support.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function setup(handler) {
 const calls=[];
 const native={available:true,ready:false,request:async(operation,payload)=>{
  calls.push({operation,payload});
  return handler(operation,payload);
 }};
 const env=environment({native,ticket:false});
 return {...env,calls,native,load:async()=>{native.ready=true;await env.emit('native-node-read','click');}};
}

const actualBfaGUINodeResponse=()=>JSON.parse("{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":\"native_bfa_gui_status\",\"code\":\"OK\",\"peer\":{\"uid\":501,\"gid\":20,\"pid\":17476,\"credentialSource\":\"darwin-LOCAL_PEERCRED-Xucred\",\"nativeIPCVerified\":true,\"browserIdentityVerified\":false},\"result\":{\"payload\":{\"capabilities\":{\"install\":false,\"start\":false,\"stop\":false,\"restart\":false,\"visibleConsent\":true,\"read\":true,\"logs\":false},\"code\":\"OK\",\"node\":{\"nodeId\":\"ordinary-node\",\"stage\":\"not_installed\",\"mode\":\"production\",\"generation\":\"0\",\"runId\":\"\",\"processOwned\":false,\"lastPid\":0,\"artifactSHA256\":\"\",\"firstCause\":\"\",\"lastExit\":\"\",\"productionSupported\":false,\"capacity\":{\"complete\":true,\"usedBytes\":\"738\",\"limitBytes\":\"67108864\",\"freeBytes\":\"3361509376\",\"enforcement\":\"preflight-and-isolated-fixture-monitor\"},\"diagnostics\":{\"code\":\"LOCAL_OBSERVATION_ONLY\",\"authority\":false,\"logs\":{\"code\":\"NOT_SUPPLIED\",\"runId\":\"\",\"authority\":false,\"stdout\":null,\"stderr\":null},\"synchronization\":{\"code\":\"NOT_SUPPLIED\",\"localHeight\":null,\"targetHeight\":null,\"catchingUp\":null},\"recovery\":{\"code\":\"IDLE\",\"autoRestart\":false,\"storedPIDIsControlHandle\":false,\"processOwned\":false,\"priorEffectUnknown\":false}}},\"productionGrant\":false}}}\n");

// The candidate subobject is from the original isolated macOS observation
// SYNC_TIMEOUT.json (SHA256 32407edaff0cfde8b6c07fe860988e7ba2acbbd3fe31ce9d892b64c7cf19689e).
// The before-install envelope below tests UI only and conveys no admission.
const recordedRuntimeCandidate=()=>({
 code:'PUBLIC_BYTES_CHECKED_NO_AUTHORITY',manifestSHA256:'70b3a411af713ffe1bfceca215e87bfd7a5211a25d99db63f46d575b8c8dab87',authority:false,originalReleaseAdmitted:false,
 manifest:{version:'YNX-NETWORK-ORDINARY-RUNTIME-INTAKE/v1',releaseVersion:'local-observer-qa.1',os:'darwin',arch:'arm64',managedFilename:'node',artifactBytes:'47560706',
  artifactSHA256:'81b57b51a0e5afb4d2a99907f3fa8911b607e5d1688060048789f4f0f73dd377',sourceRevision:'5e7640aed0a030a1d56f6e5b0fd98163027b22a8',
  sourceRepository:'https://github.com/JiahaoAlbus/YNX-Chain',artifactSource:'https://example.invalid/isolated-qa-core-build',
  originalManifestSHA256:'7738efcf60997f08a076066c45bc94661ea2e1c51246b0a337c0022891bc84e1',runtimeContractSHA256:'aae71bbd0f3558f6123bacdf974498abe2378419a2d65c66f947846fc19e1096',
  role:'ordinary-observer',blockProduction:false,validator:false,signer:false,validatorKeys:false,
  network:{networkId32:'16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f',nativeChainId:'6423',nativeGenesisSHA256:'16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f',cometChainId:'ynx_6423-1',cometGenesisSHA256:'78b8de9920f1b431df2512bfe659d624c5936eddc5491f1dd57425cc1fcf03d9'}}
});
const packageID=field=>'native-node-package-'+field;
const packageFields=['source','version','bytes','network','chain'];
function assertPackageCleared(s){
 for(const field of packageFields){
  assert.equal(s.node(packageID(field)).textContent,'—',field);
  assert.equal(s.node(packageID(field)+'-row').hidden,true,field);
 }
}
function assertNoNodeEffects(s){
 for(const name of ['install','start','stop','restart','confirm'])assert.equal(s.node('native-node-'+name).disabled,true,name);
 assert.ok(s.calls.every(call=>!/^node_(prepare|install|start|stop|restart)$/.test(call.operation)));
}
function loadLocale(s){
 const document={documentElement:{},querySelectorAll:()=>[]};
 const window={document};
 runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window});
 s.window.NetworkI18n=window.NetworkI18n;
 return {locale:window.NetworkI18n,document};
}

test('node pre-install distinguishes local candidate bytes from an admitted release in 12 locales',async()=>{
 const actual=actualBfaGUINodeResponse();
 const s=setup(op=>op==='node_status'?actual:undefined);
 await settle();await s.load();
 assert.equal(s.node(packageID('state')).textContent,'未提供候选安装包');
 assertPackageCleared(s);
 actual.result.payload.node.runtimeCandidate=recordedRuntimeCandidate();
 await s.emit('native-node-read','click');
 const key='已核对候选文件字节；尚未获得发布授权。';
 assert.equal(s.node(packageID('state')).textContent,key);
 assert.match(s.node('native-node-wizard-next').textContent,/签名发布可用后/);
 const saved=actual.result.payload.node.runtimeCandidate.manifest;
 const values=[saved.artifactSource,saved.releaseVersion,'47560706 B',saved.network.networkId32,'6423 / ynx_6423-1'];
 const {locale,document}=loadLocale(s);
 for(const lang of locale.locales){
  locale.setLocale(lang);s.client.rerenderLocale();s.window.NetworkOperations.rerenderLocale();
  assert.equal(document.documentElement.dir,lang==='ar'?'rtl':'ltr');
  assert.equal(s.node(packageID('state')).textContent,locale.t(key));
  if(lang!=='zh-Hans')assert.notEqual(locale.t(key),key,lang);
  for(const [i,field] of packageFields.entries()){
   assert.equal(s.node(packageID(field)).textContent,values[i],field);
   assert.equal(s.node(packageID(field)+'-row').hidden,false,field);
  }
  assertNoNodeEffects(s);
 }
});

test('node pre-install hides unavailable or malformed metadata and rejects a late result after bridge loss',async()=>{
 const original=()=>{const actual=actualBfaGUINodeResponse();actual.result.payload.node.runtimeCandidate=recordedRuntimeCandidate();return actual;};
 let result=original(),finish;
 const s=setup(op=>op==='node_status'?result:undefined);
 await settle();await s.load();
 assert.equal(s.node(packageID('bytes')).textContent,'47560706 B');
 for(const reject of [c=>{c.code='UNAVAILABLE';},c=>{c.authority=true;},c=>{c.originalReleaseAdmitted=true;},c=>{c.manifest.artifactSource='javascript:open()';},
  c=>{c.manifest.artifactBytes=47560706;},c=>{c.manifest.network.nativeChainId='0';},c=>{c.manifest.network.networkId32='wrong';},c=>{c.manifest.validatorKeys=true;}]){
  result=original();reject(result.result.payload.node.runtimeCandidate);await s.emit('native-node-read','click');
  assert.equal(s.node(packageID('state')).textContent,'安装包检查不可用');
  assert.match(s.node('native-node-wizard-next').textContent,/请重新检查节点/);
  assertPackageCleared(s);
  assertNoNodeEffects(s);
 }
 result=original();await s.emit('native-node-read','click');
 result=new Promise(resolve=>{finish=resolve;});
 const pending=s.emit('native-node-read','click');await settle();
 assert.equal(s.node(packageID('state')).textContent,'正在读取');assertPackageCleared(s);
 s.native.ready=false;s.nativeState();
 finish(original());await pending;
 assert.equal(s.node(packageID('state')).textContent,'尚未读取');
 assertPackageCleared(s);assertNoNodeEffects(s);
});

test('independent proof setup shows the classic and PQ paths before browser pairing',async()=>{
 for(const [native,location] of [[null,/请在 macOS 的 Network App 中配置/],[{available:true,ready:false},/在本窗口顶部选择/]]){
  const s=environment({ticket:false,native});
  assert.match(s.node('anchor-setup-guide').textContent,location);
  assert.match(s.node('anchor-setup-guide').textContent,/这笔交易.*SHA-256/);
  assert.match(s.node('anchor-setup-guide').textContent,/经典 CometBFT 检查点.*独立.*SHA-256/);
  assert.equal(s.node('proof-file').disabled,true);
  assert.equal(s.requests.length,0);
  const {locale,document}=loadLocale(s);
  const nativeCopy=readFileSync(new URL('../qa/native_chrome_copy.m',import.meta.url),'utf8');
  const nativeRow=nativeCopy.match(/@"classicCheckpoint":@\[([^\]]+)\]/u)?.[1];
  assert.ok(nativeRow);
  const nativeTitles=Array.from(nativeRow.matchAll(/@"([^"]+)"/gu),m=>m[1]);
  const localeOrder=['en','zh-Hans','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id'];
  for(const [i,lang] of localeOrder.entries()){
   assert.ok(locale.setLocale(lang));
   s.client.rerenderLocale();
   assert.equal(document.documentElement.dir,lang==='ar'?'rtl':'ltr',lang);
   assert.equal(locale.t('经典 CometBFT 检查点'),nativeTitles[i],lang);
   assert.match(s.node('anchor-setup-guide').textContent,/CORE.*SHA-256/);
   assert.ok(s.node('anchor-setup-guide').textContent.includes(nativeTitles[i]),lang);
   assert.equal(s.node('proof-file').disabled,true);
   assert.equal(s.requests.length,0);
  }
 }
});

const capacityCode='CAPACITY_LIMIT';
const capacityMessage='节点存储达到限制。请检查节点状态与设备空间，释放空间后重新读取。';
const readings={used:'67109000 B',limit:'67108864 B',free:'268435456 B'};
const capacityID=field=>'native-node-capacity-'+field;
function capacityResponse(code=capacityCode){
 const value=actualBfaGUINodeResponse(),payload=value.result.payload;
 payload.code=code;
 payload.node.capacity={complete:true,usedBytes:'67109000',limitBytes:'67108864',freeBytes:'268435456',enforcement:'preflight-and-isolated-fixture-monitor'};
 return value;
}
function assertCapacityCleared(s){
 assert.equal(s.node(capacityID('details')).hidden,true);
 for(const field of Object.keys(readings))assert.equal(s.node(capacityID(field)).textContent,'—',field);
}

test('node capacity displays an explicit native limit with complete readings and never enables an effect',async()=>{
 const value=capacityResponse(),s=setup(()=>value);
 value.result.payload.capabilities={install:true,start:true,stop:true,restart:true,visibleConsent:true,logs:true,read:true};
 value.result.payload.node.stage='running';
 value.result.payload.node.processOwned=true;
 await s.load();
 assert.equal(s.node('native-node-stage').textContent,'运行中');
 assert.equal(s.node('native-node-operation-code').textContent,capacityCode);
 assert.equal(s.node('native-node-wizard-next').textContent,capacityMessage);
 assert.equal(s.node(capacityID('details')).hidden,false);
 for(const [field,value] of Object.entries(readings))assert.equal(s.node(capacityID(field)).textContent,value,field);
 assertNoNodeEffects(s);
 assert.equal(s.node('native-node-read').disabled,false);
 const {locale,document}=loadLocale(s);
 for(const lang of locale.locales){
  locale.setLocale(lang);s.client.rerenderLocale();s.window.NetworkOperations.rerenderLocale();
  assert.equal(document.documentElement.dir,lang==='ar'?'rtl':'ltr',lang);
  assert.equal(s.node('native-node-wizard-next').textContent,locale.t(capacityMessage),lang);
  assert.equal(s.node(capacityID('free')).textContent,readings.free,lang);
  if(lang!=='zh-Hans')assert.notEqual(locale.t(capacityMessage),capacityMessage,lang);
 }
});

test('node capacity removes absent, incomplete, superseded and disconnected readings',async()=>{
 let result=capacityResponse(),resolve;
 const s=setup(()=>result);
 await s.load();
 assert.equal(s.node(capacityID('used')).textContent,readings.used);
 for(const modify of [p=>{p.node=null;},p=>{p.node.capacity.complete=false;},p=>{delete p.node.capacity.freeBytes;},p=>{p.node.capacity.freeBytes=0;},p=>{p.node.capacity.freeBytes='18446744073709551616';}]){
  result=capacityResponse();modify(result.result.payload);
  await s.emit('native-node-read','click');
  assert.equal(s.node('native-node-wizard-next').textContent,capacityMessage);
  assertCapacityCleared(s);
 }
 for(const code of ['OK','UNAVAILABLE','EXPIRED','RECONCILING','UNKNOWN']){
  result=capacityResponse(code);if(code!=='OK')result.result.payload.node=null;
  await s.emit('native-node-read','click');
  assert.notEqual(s.node('native-node-wizard-next').textContent,capacityMessage);
  assertCapacityCleared(s);
 }
 result=capacityResponse();await s.emit('native-node-read','click');
 result=new Promise(r=>{resolve=r;});
 const pending=s.emit('native-node-read','click');await settle();
 assert.equal(s.node('native-node-wizard-next').textContent,'正在读取');
 assertCapacityCleared(s);
 s.native.ready=false;s.nativeState();
 resolve(capacityResponse());await pending;
 assert.equal(s.node('native-node-wizard-next').textContent,'原生连接尚未就绪');
 assertCapacityCleared(s);assertNoNodeEffects(s);
});

test('node restart capacity preserves fresh stopped state and never retries the original effect',async()=>{
 let ended=false,resolveRestart;
 const held=new Promise(resolve=>{resolveRestart=resolve;});
 const s=setup(op=>{
  if(op==='node_restart')return held;
  if(op!=='node_status')throw Error('unexpected request '+op);
  const result=capacityResponse('OK'),p=result.result.payload;
  Object.assign(p.node,{stage:ended?'stopped':'running',productionSupported:true,processOwned:!ended,generation:ended?'2':'1'});
  Object.assign(p.capabilities,{start:ended,stop:!ended,restart:!ended});
  return result;
 });
 await s.load();
 const pending=s.emit('native-node-restart','click');await settle();
 ended=true;
 const outcome=capacityResponse();outcome.result.payload.node=null;
 resolveRestart(outcome);await pending;
 assert.equal(s.node('native-node-stage').textContent,'已停止');
 assert.equal(s.node('native-node-operation').textContent,capacityMessage);
 assert.equal(s.node('native-node-operation-code').textContent,capacityCode);
 assert.equal(s.node('native-node-wizard-next').textContent,capacityMessage);
 assert.equal(s.node('native-node-start').disabled,true);
 assertCapacityCleared(s);
 assert.deepEqual(s.calls.map(c=>c.operation),['node_status','node_restart','node_status']);
});

test('node capacity after Start requires a completed explicit read before another attempt',async()=>{
 const hash='a'.repeat(64);
 const pendingIntent={managerId:'capacity-ui-protocol-fixture',nodeId:'ordinary-node',action:'start',artifactSHA256:hash,generation:'3'};
 const wrap=(value,patch)=>{Object.assign(value.result.payload,patch);return value;};
 const ordinary=()=>{const value=capacityResponse('OK'),p=value.result.payload;p.node.stage='installed';p.node.productionSupported=true;
  p.node.artifactSHA256=hash;p.node.generation='3';p.capabilities.start=true;return value;};
 // The backend's one-byte-short Start returns CAPACITY_LIMIT after an idle
 // status read returns OK. The effect response carries no new run or numbers.
 const limited=()=>wrap(capacityResponse(),{node:null});
 let reads=0,resolveRetry,releaseRetry;
 const s=setup((op,payload)=>{
  if(op==='node_prepare'){assert.equal(payload.action,'start');return wrap(capacityResponse(),{code:'PREPARED',node:pendingIntent});}
  if(op==='node_start')return limited();
  assert.equal(op,'node_status');reads++;
  if(reads===3)return new Promise(resolve=>{resolveRetry=resolve;});
  if(reads===4)throw Object.assign(Error('read failed'),{code:'NATIVE_TIMEOUT'});
  if(reads===5)return new Promise(resolve=>{releaseRetry=resolve;});
  return ordinary();
 });
 await s.load();await s.emit('native-node-start','click');await s.emit('native-node-confirm','click');
 assert.equal(s.node('native-node-stage').textContent,'已安装');
 assert.equal(s.node('native-node-wizard-next').textContent,capacityMessage);
 assert.equal(s.node('native-node-start').disabled,true);
 assertCapacityCleared(s);
 let refresh=s.emit('native-node-read','click');await settle();assert.equal(s.node('native-node-start').disabled,true);
 resolveRetry(limited());await refresh;
 assert.equal(s.node('native-node-wizard-next').textContent,capacityMessage);
 assert.equal(s.node('native-node-start').disabled,true);
 await s.emit('native-node-read','click');
 assert.equal(s.node('native-node-start').disabled,true);
 assert.equal(s.node('native-node-wizard-next').textContent,capacityMessage);
 refresh=s.emit('native-node-read','click');await settle();
 assert.equal(s.node('native-node-start').disabled,true);
 releaseRetry(ordinary());await refresh;
 assert.equal(s.node('native-node-start').disabled,false);
 assert.notEqual(s.node('native-node-wizard-next').textContent,capacityMessage);
 assert.equal(s.calls.filter(c=>c.operation==='node_start').length,1);
 assert.equal(s.calls.filter(c=>c.operation==='node_prepare').length,1);
});

test('node capacity keeps original reconciliation separate from storage and fences repeated launch',async()=>{
 const response=(code,recovery)=>{const value=capacityResponse(code),p=value.result.payload;
  Object.assign(p.node,{stage:recovery?'reconcile_required':'running',productionSupported:true,processOwned:!recovery});
  p.capabilities.restart=!recovery;p.capabilities.stop=!recovery;p.capabilities.start=recovery;
  return value;
 };
 let reads=0;
 const s=setup(op=>{
  if(op==='node_restart'){const v=capacityResponse('RECONCILING');v.result.payload.node=null;return v;}
  assert.equal(op,'node_status');reads++;
  return reads===2?response('OK',true):response('OK',false);
 });
 await s.load();await s.emit('native-node-restart','click');
 assert.equal(s.node('native-node-operation-code').textContent,'RECONCILING');
 assert.match(s.node('native-node-operation').textContent,/原结果未确定/);
 assert.doesNotMatch(s.node('native-node-operation').textContent,/存储/);
 assertCapacityCleared(s);
 assert.equal(s.node('native-node-restart').disabled,true);
 await s.emit('native-node-read','click');
 assert.equal(s.node('native-node-restart').disabled,false);
 assert.equal(s.calls.filter(c=>c.operation==='node_restart').length,1);
});

test('node capacity review clears on the paired session reset and rejects the retired read',async()=>{
 let reads=0,late;
 const ordinary=()=>{const v=capacityResponse('OK'),p=v.result.payload;
  Object.assign(p.node,{stage:'running',productionSupported:true,processOwned:true});p.capabilities.restart=true;return v;};
 const s=setup(op=>{
  if(op==='node_restart'){const v=capacityResponse();v.result.payload.node=null;return v;}
  assert.equal(op,'node_status');return ++reads===3?new Promise(r=>{late=r;}):ordinary();
 });
 await s.load();await s.emit('native-node-restart','click');
 assert.equal(s.node('native-node-restart').disabled,true);
 const read=s.emit('native-node-read','click');await settle();
 s.native.ready=false;s.nativeState();
 late(capacityResponse());await read;
 assertCapacityCleared(s);
 assert.equal(s.node('native-node-wizard-next').textContent,'原生连接尚未就绪');
 await s.load();assert.equal(s.node('native-node-restart').disabled,false);
 assert.equal(s.calls.filter(c=>c.operation==='node_restart').length,1);
});

test('node feedback separates unavailable node discovery from a missing package',async()=>{
 const payload=actualBfaGUINodeResponse().result.payload;
 payload.code='NOT_SUPPLIED';payload.node=null;
 payload.capabilities=Object.fromEntries(Object.keys(payload.capabilities).map(key=>[key,false]));
 const s=setup(()=>({ ...actualBfaGUINodeResponse(),result:{payload} }));
 await s.load();
 assert.equal(s.node('native-node-operation-code').textContent,'NOT_SUPPLIED');
 assert.match(s.node('native-node-wizard-next').textContent,/本机服务未提供普通节点管理/);
 assert.equal(s.node(packageID('state')).textContent,'安装包检查不可用');
 assertPackageCleared(s);assertNoNodeEffects(s);
 const {locale}=loadLocale(s);
 for(const lang of locale.locales){
  locale.setLocale(lang);s.client.rerenderLocale();s.window.NetworkOperations.rerenderLocale();
  assert.equal(s.node('native-node-wizard-next').textContent,locale.t('本机服务未提供普通节点管理。'),lang);
  assert.equal(s.node(packageID('state')).textContent,locale.t('安装包检查不可用'),lang);
 }
});

test('node feedback names exact native outcomes and shows only the fresh observed restart state',async()=>{
 const running=()=>{const v=capacityResponse('OK'),p=v.result.payload;
  Object.assign(p.node,{stage:'running',productionSupported:true,processOwned:true});p.capabilities.restart=true;return v;};
 const cases={
  CONSENT_UNAVAILABLE:'原生确认不可用。请重新打开已安装的 Network App，然后检查节点。',
  BUSY:'请等待当前操作结束。',
  NOT_RUNNING:'当前没有可操作的受管运行。请重新检查节点状态。',
  UNSUPPORTED:'当前版本不支持此操作。',
  NOT_SUPPLIED:'本机服务未提供普通节点管理。',
 };
 for(const [code,message] of Object.entries(cases)){
  let read=0,pending;
  const s=setup(op=>{
   const v=running(),p=v.result.payload;
   if(op==='node_restart'){p.code=code;p.node=null;return v;}
   assert.equal(op,'node_status');
   return ++read===1?v:new Promise(resolve=>{pending=resolve;});
  });
  await s.load();
  const restart=s.emit('native-node-restart','click');await settle();
  assert.equal(s.node('native-node-stage').textContent,'—');
  assert.equal(s.node('native-node-operation-code').textContent,code);
  assert.equal(s.node('native-node-operation').textContent,message);
  const fresh=running();
  Object.assign(fresh.result.payload.node,{stage:'stopped',processOwned:false});
  Object.assign(fresh.result.payload.capabilities,{restart:false,visibleConsent:false});
  pending(fresh);await restart;
  assert.equal(s.node('native-node-stage').textContent,'已停止');
  assert.equal(s.node('native-node-operation').textContent,message);
  assert.doesNotMatch(s.node('native-node-operation').textContent,/保持|未改变|重启成功/);
  const {locale,document}=loadLocale(s);
  for(const lang of locale.locales){
   locale.setLocale(lang);s.client.rerenderLocale();s.window.NetworkOperations.rerenderLocale();
   assert.equal(s.node('native-node-operation').textContent,locale.t(message),lang);
   assert.equal(s.node('native-node-operation-code').textContent,code,lang);
   assert.equal(s.node('native-node-stage').textContent,locale.t('已停止'),lang);
   assert.equal(document.documentElement.dir,lang==='ar'?'rtl':'ltr',lang);
  }
  assert.deepEqual(s.calls.map(call=>call.operation),['node_status','node_restart','node_status']);
 }
});

test('node feedback discards retired failure readback and preserves newer node state',async()=>{
 let check=0,late;
 const running=()=>{const v=capacityResponse('OK'),p=v.result.payload;
  Object.assign(p.node,{stage:'running',productionSupported:true,processOwned:true});p.capabilities.restart=true;return v;};
 const s=setup(op=>{
  if(op==='node_restart'){const v=running();v.result.payload.code='CONSENT_UNAVAILABLE';v.result.payload.node=null;return v;}
  assert.equal(op,'node_status');
  return ++check===2?new Promise(resolve=>{late=resolve;}):running();
 });
 await s.load();
 const restart=s.emit('native-node-restart','click');await settle();
 assert.equal(s.node('native-node-operation-code').textContent,'CONSENT_UNAVAILABLE');
 s.native.ready=false;s.nativeState();
 late(capacityResponse());await restart;
 assert.equal(s.node('native-node-operation-code').textContent,'—');
 assert.equal(s.node('native-node-stage').textContent,'—');
 assertCapacityCleared(s);
 await s.load();
 assert.equal(s.node('native-node-stage').textContent,'运行中');
 assert.equal(s.node('native-node-operation-code').textContent,'OK');
 assert.equal(s.calls.filter(call=>call.operation==='node_restart').length,1);
});

test('node restart acknowledgement requires a newer bound run before UI reports OK', async()=>{
 const originalRun='a'.repeat(48), newRun='b'.repeat(48), artifact='c'.repeat(64);
 const running=(runId=originalRun,generation='11',artifactSHA256=artifact)=>{
  const reply=actualBfaGUINodeResponse(),p=reply.result.payload;
  Object.assign(p.node,{runId,generation,artifactSHA256,stage:'running',processOwned:true,productionSupported:true});
  Object.assign(p.node.diagnostics.logs,{runId});
  Object.assign(p.capabilities,{stop:true,restart:true,read:true,visibleConsent:true});
  return reply;
 };
 const ack=()=>{const reply=running();reply.result.payload.node=null;return reply;};
 const cases=[
  ['same run',()=>running(originalRun,'14')],
  ['older generation',()=>running(newRun,'10')],
  ['missing run ID',()=>running('','14')],
  ['different artifact',()=>running(newRun,'14','d'.repeat(64))],
  ['offline status',()=>Promise.reject(Object.assign(new Error('status timeout'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'}))],
 ];
 for(const [label,observed] of cases){
  let reads=0,completeStatus;
  const s=setup(op=>{
   if(op==='node_restart')return ack();
   assert.equal(op,'node_status');
   return ++reads===1?running():reads===2?new Promise(resolve=>{completeStatus=()=>resolve(observed());}):running();
  });
  await s.load();
  const restart=s.emit('native-node-restart','click');await settle();
  assert.equal(s.node('native-node-operation-code').textContent,'—',label);
  assert.equal(s.node('native-node-stage').textContent,'—',label);
  completeStatus();await restart;
  assert.equal(s.node('native-node-operation-code').textContent,'RECONCILING',label);
  assert.equal(s.node('native-node-stage').textContent,'—',label);
  assert.equal(s.node('native-node-restart').disabled,true,label);
  const {locale,document}=loadLocale(s);
  for(const lang of locale.locales){
   locale.setLocale(lang);s.client.rerenderLocale();s.window.NetworkOperations.rerenderLocale();
   assert.equal(s.node('native-node-operation').textContent,locale.t('原结果未确定。先读取原状态，不要重复操作。'),lang);
   assert.equal(document.documentElement.dir,lang==='ar'?'rtl':'ltr',lang);
  }
  await s.load(); // Exact owned status makes safe Stop possible on this run.
  assert.equal(s.node('native-node-stop').disabled,false,label);
  assert.equal(s.node('native-node-restart').disabled,true,label);
  assert.deepEqual(s.calls.map(call=>call.operation),['node_status','node_restart','node_status','node_status']);
 }
 const s=setup((()=>{let count=0;return op=>op==='node_restart'?ack():(++count===1?running():running(newRun,'14'));})());
 await s.load();await s.emit('native-node-restart','click');
 assert.equal(s.node('native-node-operation-code').textContent,'OK');
 assert.equal(s.node('native-node-stage').textContent,'运行中');
 assert.equal(s.node('native-node-stop').disabled,false);
 assert.deepEqual(s.calls.map(call=>call.operation),['node_status','node_restart','node_status']);
});

test('node restart lost acknowledgment stays UNKNOWN after current read, with original Stop preserved',async()=>{
 const runId='a'.repeat(48),artifactSHA256='f'.repeat(64);
 let calls=0;
 const running=()=>{
  const reply=actualBfaGUINodeResponse(),p=reply.result.payload;
  Object.assign(p.node,{runId,generation:'11',artifactSHA256,stage:'running',processOwned:true,productionSupported:true});
  Object.assign(p.capabilities,{stop:true,restart:true,read:true,visibleConsent:true});
  return reply;
 };
 const s=setup((op,payload)=>{
  if(op==='node_restart')return Promise.reject(Object.assign(new Error('lost result'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'}));
  if(op==='node_prepare'){
   assert.equal(payload.action,'stop');
   const reply=running(),p=reply.result.payload;
   p.code='PREPARED';p.node={action:'stop',nodeId:'ordinary-node',managerId:'controlled-manager',generation:'11',artifactSHA256};
   return reply;
  }
  assert.equal(op,'node_status');
  calls++;
  return running();
 });
 await s.load();await s.emit('native-node-restart','click');
 assert.equal(s.node('native-node-operation-code').textContent,'UNKNOWN');
 assert.equal(s.node('native-node-stage').textContent,'—');
 assert.equal(s.node('native-node-restart').disabled,true);
 assert.equal(s.node('native-node-stop').disabled,true);
 await s.emit('native-node-read','click');
 assert.equal(s.node('native-node-operation-code').textContent,'UNKNOWN');
 assert.equal(s.node('native-node-restart').disabled,true);
 assert.equal(s.node('native-node-stop').disabled,false);
 await s.emit('native-node-stop','click');
 assert.equal(s.node('native-node-confirm').disabled,false);
 assert.equal(calls,3);
 assert.deepEqual(s.calls.map(call=>call.operation),['node_status','node_restart','node_status','node_status','node_prepare']);
});

test('full storage permits only a freshly authorized native stop of the observed owned run',async()=>{
 const runId='a'.repeat(48),hash='c'.repeat(64),generation='11';
 const intent={managerId:'controlled-manager',nodeId:'ordinary-node',action:'stop',artifactSHA256:hash,generation};
 let stopped=false;
 const status=()=>{
  const r=capacityResponse(),p=r.result.payload;
  Object.assign(p.node,{stage:stopped?'stopped':'running',processOwned:!stopped,productionSupported:true,runId,generation,artifactSHA256:hash});
  Object.assign(p.capabilities,{read:true,stop:!stopped,visibleConsent:true,install:false,start:false,restart:false,logs:false});
  return r;
 };
 const s=setup((op,payload)=>{
  if(op==='node_status')return status();
  if(op==='node_prepare'){
   assert.equal(JSON.stringify(payload),JSON.stringify({action:'stop',artifactSHA256:''}));
   const r=status();r.result.payload.code='PREPARED';r.result.payload.node=intent;return r;
  }
  if(op==='node_stop'){
   assert.equal(JSON.stringify(payload),JSON.stringify(intent));stopped=true;
   const r=status();r.result.payload.code='OK';r.result.payload.node=null;return r;
  }
  throw Error('unexpected effect '+op);
 });
 await s.load();
 assert.equal(s.node('native-node-stop').disabled,false);
 for(const action of ['install','start','restart'])assert.equal(s.node('native-node-'+action).disabled,true,action);
 await s.emit('native-node-stop','click');
 assert.equal(s.node('native-node-confirm').disabled,false);
 assert.equal(s.calls.filter(c=>c.operation==='node_stop').length,0);
 await s.emit('native-node-confirm','click');
 assert.equal(s.node('native-node-stage').textContent,'已停止');
 assert.equal(s.node('native-node-operation-code').textContent,'OK');
 assert.equal(s.node('native-node-stop').disabled,true);
 assert.equal(s.node('native-node-restart').disabled,true);
 assert.deepEqual(s.calls.map(c=>c.operation),['node_status','node_prepare','node_stop','node_status']);
});

test('capacity stop remains closed for incomplete, unowned, ambiguous or overbroad native readback',async()=>{
 const safe=()=>{
  const r=capacityResponse(),p=r.result.payload;
  Object.assign(p.node,{stage:'running',processOwned:true,runId:'a'.repeat(48),generation:'11',artifactSHA256:'c'.repeat(64)});
  Object.assign(p.capabilities,{read:true,stop:true,visibleConsent:true,install:false,start:false,restart:false,logs:false});
  return r;
 };
 for(const [name,mutate] of [
  ['incomplete',p=>p.node.capacity.complete=false],
  ['not owned',p=>p.node.processOwned=false],
  ['not running',p=>p.node.stage='starting'],
  ['bad run',p=>p.node.runId=''],
  ['bad artifact',p=>p.node.artifactSHA256=''],
  ['unknown prior effect',p=>p.node.diagnostics.recovery.priorEffectUnknown=true],
  ['consent unavailable',p=>p.capabilities.visibleConsent=false],
  ['missing read',p=>p.capabilities.read=false],
  ['start advertised',p=>p.capabilities.start=true],
  ['restart advertised',p=>p.capabilities.restart=true],
  ['logs advertised',p=>p.capabilities.logs=true],
 ]){
  const r=safe();mutate(r.result.payload);const s=setup(()=>r);await s.load();
  assertNoNodeEffects(s);
  assert.equal(s.node('native-node-stop').disabled,true,name);
 }
});

test('capacity stop with lost native acknowledgment cannot be automatically repeated',async()=>{
 const hash='b'.repeat(64),generation='13';
 const status=()=>{
  const r=capacityResponse(),p=r.result.payload;
  Object.assign(p.node,{stage:'running',processOwned:true,runId:'a'.repeat(48),generation,artifactSHA256:hash});
  Object.assign(p.capabilities,{read:true,stop:true,visibleConsent:true,install:false,start:false,restart:false,logs:false});
  return r;
 };
 const s=setup(op=>{
  if(op==='node_status')return status();
  if(op==='node_prepare'){
   const r=status();r.result.payload.code='PREPARED';
   r.result.payload.node={managerId:'controlled-manager',nodeId:'ordinary-node',action:'stop',artifactSHA256:hash,generation};return r;
  }
  if(op==='node_stop')return Promise.reject(Object.assign(new Error('lost native stop response'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'}));
  throw Error('unexpected request');
 });
 await s.load();await s.emit('native-node-stop','click');await s.emit('native-node-confirm','click');
 assert.equal(s.node('native-node-operation-code').textContent,'UNKNOWN');
 assert.equal(s.node('native-node-stop').disabled,true);
 await s.emit('native-node-read','click');
 assert.equal(s.node('native-node-stop').disabled,true);
 assert.equal(s.node('native-node-restart').disabled,true);
 assert.equal(s.calls.filter(c=>c.operation==='node_stop').length,1);
});

test('cancelled native node prompt refreshes controls only from the current observation',async t=>{
 const hash='c'.repeat(64),runId='d'.repeat(48),generation='17';
 const intent={managerId:'controlled-manager',nodeId:'ordinary-node',action:'stop',artifactSHA256:hash,generation};
 const status=(running=true,code='OK')=>{
  const result=actualBfaGUINodeResponse(),p=result.result.payload;
  p.code=code;
  Object.assign(p.node,{stage:running?'running':'stopped',processOwned:running,artifactSHA256:hash,generation:running?generation:'19',runId});
  Object.assign(p.capabilities,{stop:running,start:false,restart:false});
  return result;
 };
 for(const mode of ['still-running','changed','unavailable','transport-failure','old-session'])await t.test(mode,async()=>{
  let reads=0,finishRead,failRead;
  const s=setup((op,payload)=>{
   if(op==='node_status')return ++reads===2?new Promise((resolve,reject)=>{finishRead=resolve;failRead=reject;}):status(reads===1);
   if(op==='node_prepare'){
    assert.equal(payload.action,'stop');
    const result=status(),p=result.result.payload;p.code='PREPARED';p.node=intent;return result;
   }
   if(op==='node_stop'){
    assert.deepEqual(JSON.parse(JSON.stringify(payload)),intent);
    const result=status(),p=result.result.payload;p.code='CANCELLED';p.node=null;p.capabilities.stop=false;return result;
   }
   throw Error('unexpected '+op);
  });
  await s.load();await s.emit('native-node-stop','click');const cancelled=s.emit('native-node-confirm','click');await settle();
  const operation=()=>s.node('native-node-operation-code').textContent;
  assert.equal(operation(),'CANCELLED');
  assert.equal(reads,2,'cancelling an ordinary native prompt requires a fresh readback');
  assert.equal(s.node('native-node-stage').textContent,'—');
  assert.equal(s.node('native-node-stop').disabled,true);
  if(mode==='old-session'){
   s.native.ready=false;s.nativeState();await s.load();
   finishRead(status());await cancelled;
   assert.equal(operation(),'OK');
  }else{
   if(mode==='transport-failure')failRead(Object.assign(Error('current status transport unavailable'),{code:'NATIVE_UNAVAILABLE',outcome:'NOT_SENT'}));
   else if(mode==='unavailable'){const invalid=status(false,'UNAVAILABLE');invalid.result.payload.node=null;finishRead(invalid);}
   else finishRead(status(mode==='still-running'));
   await cancelled;
   assert.equal(operation(),'CANCELLED');
   const {locale,document}=loadLocale(s);
   for(const lang of locale.locales){
    locale.setLocale(lang);s.client.rerenderLocale();s.window.NetworkOperations.rerenderLocale();
    assert.equal(document.documentElement.dir,lang==='ar'?'rtl':'ltr');
    assert.equal(s.node('native-node-operation').textContent,locale.t('本机操作已取消。'),lang);
   }
   locale.setLocale('zh-Hans');s.client.rerenderLocale();s.window.NetworkOperations.rerenderLocale();
  }
  assert.equal(s.node('native-node-stage').textContent,mode==='still-running'?'运行中':['old-session','changed'].includes(mode)?'已停止':'—');
  assert.equal(s.node('native-node-stop').disabled,mode!=='still-running');
  assert.equal(s.node('native-node-confirm').disabled,true);
  assert.equal(s.calls.filter(call=>call.operation==='node_stop').length,1);
  assert.equal(s.calls.filter(call=>call.operation==='node_prepare').length,1);
 });
});

test('ordinary start prompt cancellation refreshes whereas a pending Start cancel waits for explicit read',async t=>{
 const hash='c'.repeat(64),generation='17';
 for(const requested of [false,true])await t.test(requested?'pending cancellation button':'cancelled native prompt',async()=>{
  const intent={managerId:'controlled-manager',nodeId:'ordinary-node',action:'start',artifactSHA256:hash,generation};
  let reads=0,finishStart,signals=0;
  const status=()=>{
   const result=actualBfaGUINodeResponse(),p=result.result.payload;
   Object.assign(p.node,{stage:'installed',productionSupported:true,artifactSHA256:hash,generation});p.capabilities.start=true;
   return result;
  };
  const s=setup(op=>{
   if(op==='node_status'){reads++;return status();}
   if(op==='node_prepare'){const result=status();Object.assign(result.result.payload,{code:'PREPARED',node:intent});return result;}
   if(op==='node_start')return new Promise(resolve=>{finishStart=resolve;});
   throw Error('unexpected '+op);
  });
  Object.defineProperty(s.native,'canCancelNodeStart',{get:()=>Boolean(finishStart)&&!signals});
  s.native.cancelPendingNodeStart=()=>{signals++;return true;};
  await s.load();await s.emit('native-node-start','click');const start=s.emit('native-node-confirm','click');await settle();
  if(requested)s.emit('native-node-cancel-start','click');
  const result=status();Object.assign(result.result.payload,{code:'CANCELLED',node:null});finishStart(result);await start;
  assert.equal(s.node('native-node-operation-code').textContent,'CANCELLED');
  assert.equal(reads,requested?1:2);
  assert.equal(s.node('native-node-start').disabled,requested);
  assert.equal(s.node('native-node-cancel-start-note').hidden,!requested);
  if(requested){
   await s.emit('native-node-read','click');
   assert.equal(reads,2);assert.equal(s.node('native-node-start').disabled,false);
   assert.equal(s.node('native-node-cancel-start-note').hidden,true);
  }
  assert.equal(signals,Number(requested));
  assert.equal(s.calls.filter(call=>call.operation==='node_start').length,1);
 });
});

test('node install waits for the requested artifact in a new installed generation', async () => {
 const digest='a'.repeat(64);
 const before=()=>{
  const value=actualBfaGUINodeResponse(),p=value.result.payload;
  Object.assign(p.node,{productionSupported:true,generation:'9'});
  p.capabilities.install=true;
  return value;
 };
 const installed=()=>{
  const value=before(),p=value.result.payload;
  Object.assign(p.node,{stage:'installed',artifactSHA256:digest,generation:'10'});
  Object.assign(p.capabilities,{start:true,install:false});
  return value;
 };
 const cases=[
  ['different artifact', p=>{p.node.artifactSHA256='b'.repeat(64);}],
  ['same generation', p=>{p.node.generation='9';}],
  ['older generation', p=>{p.node.generation='8';}],
  ['already running', p=>{Object.assign(p.node,{stage:'running',processOwned:true,runId:'1'.repeat(48)});}],
  ['not yet installed', p=>{p.node.stage='installing';}],
  ['no production support', p=>{p.node.productionSupported=false;}],
  ['prior effect unknown', p=>{p.node.diagnostics.recovery.priorEffectUnknown=true;}],
  ['missing status', p=>{p.code='UNAVAILABLE';p.node=null;}],
  ['matches', null],
 ];
 for(const [name,change] of cases){
  let reads=0,settleRead;
  const expected={managerId:'controlled-install-manager',nodeId:'ordinary-node',action:'install',artifactSHA256:digest,generation:'9'};
  const env=setup((op,payload)=>{
   const value=installed(),p=value.result.payload;
   if(op==='node_status'){
    if(++reads===1)return before();
    if(reads===2)return new Promise(resolve=>{settleRead=()=>{change?.(p);resolve(value);};});
    return name==='different artifact'&&reads===4?installed():before();
   }
   if(op==='node_prepare'){
    assert.deepEqual(JSON.parse(JSON.stringify(payload)),{action:'install',artifactSHA256:digest});
    p.code='PREPARED';p.node=expected;return value;
   }
   if(op==='node_install'){
    assert.deepEqual(JSON.parse(JSON.stringify(payload)),expected);
    p.node=null;return value;
   }
   throw Error('unexpected '+op);
  });
  await env.load();
  const input=env.node('native-node-artifact');
  input.value=digest;env.emit('native-node-artifact','input');
  await env.emit('native-node-install','click');
  const operation=env.emit('native-node-confirm','click');
  await settle();
  assert.equal(env.node('native-node-operation-code').textContent,'—',name);
  assert.equal(env.node('native-node-stage').textContent,'—',name);
  assert.equal(env.node('native-node-start').disabled,true,name);
  settleRead();await operation;
  if(change){
   assert.equal(env.node('native-node-operation-code').textContent,'RECONCILING',name);
   assert.equal(env.node('native-node-stage').textContent,'—',name);
   assert.equal(env.node('native-node-install').disabled,true,name);
   assert.equal(env.node('native-node-start').disabled,true,name);
   if(name==='different artifact'){
    const {locale,document}=loadLocale(env);
    for(const lang of locale.locales){
     locale.setLocale(lang);env.client.rerenderLocale();env.window.NetworkOperations.rerenderLocale();
     assert.equal(env.node('native-node-operation').textContent,locale.t('原结果未确定。先读取原状态，不要重复操作。'),lang);
     assert.equal(document.documentElement.dir,lang==='ar'?'rtl':'ltr');
    }
    await env.emit('native-node-read','click');
    assert.equal(env.node('native-node-operation-code').textContent,'RECONCILING');
    assert.equal(env.node('native-node-stage').textContent,'—');
    assert.equal(env.node('native-node-install').disabled,true);
    assert.equal(env.node('native-node-start').disabled,true);
    await env.emit('native-node-install','click');
    await env.emit('native-node-read','click');
    assert.equal(env.node('native-node-operation-code').textContent,'OK');
    assert.equal(env.node('native-node-start').disabled,false);
   }
  }else{
   assert.equal(env.node('native-node-operation-code').textContent,'OK',name);
   assert.equal(env.node('native-node-stage').textContent,'已安装',name);
   assert.equal(env.node('native-node-start').disabled,false,name);
  }
  assert.equal(env.calls.filter(call=>call.operation==='node_install').length,1,name);
  assert.equal(env.calls.filter(call=>call.operation==='node_start').length,0,name);
 }
});

test('uncertain node install retains the prepared digest until an exact explicit read',async t=>{
 const digest='a'.repeat(64),other='b'.repeat(64);
 const intent={managerId:'controlled-install-manager',nodeId:'ordinary-node',action:'install',artifactSHA256:digest,generation:'9'};
 const status=(stage,hash='',generation='9')=>{
  const value=actualBfaGUINodeResponse(),p=value.result.payload;
  Object.assign(p.node,{productionSupported:true,stage,artifactSHA256:hash,generation});
  Object.assign(p.capabilities,{install:stage==='not_installed',start:stage==='installed'});
  return value;
 };
 for(const outcome of ['UNKNOWN','RECONCILING','NATIVE_TIMEOUT'])await t.test(outcome,async()=>{
  const expectedCode=outcome==='NATIVE_TIMEOUT'?'UNKNOWN':outcome;
  let observation=status('not_installed');
  const s=setup((op,payload)=>{
   if(op==='node_status'){
    if(observation instanceof Error)throw observation;
    return observation;
   }
   if(op==='node_prepare'){
    const value=status('not_installed'),p=value.result.payload;
    p.code='PREPARED';p.node=intent;
    assert.deepEqual(JSON.parse(JSON.stringify(payload)),{action:'install',artifactSHA256:digest});
    return value;
   }
   if(op==='node_install'){
    assert.deepEqual(JSON.parse(JSON.stringify(payload)),intent);
    if(outcome==='NATIVE_TIMEOUT')throw Object.assign(new Error(outcome),{code:outcome,outcome:'UNKNOWN'});
    const value=status('not_installed'),p=value.result.payload;
    p.code=outcome;p.node=null;return value;
   }
   throw Error('unexpected '+op);
  });
  const operation=()=>s.node('native-node-operation-code').textContent;
  await s.load();
  s.node('native-node-artifact').value=digest;
  s.emit('native-node-artifact','input');
  await s.emit('native-node-install','click');
  observation=status('installed',other,'10');
  await s.emit('native-node-confirm','click');
  assert.equal(operation(),expectedCode);
  assert.equal(s.node('native-node-start').disabled,true);
  assert.equal(s.node('native-node-stage').textContent,'—');

  await s.emit('native-node-read','click');
  assert.equal(s.node('native-node-start').disabled,true,'a different installed artifact cannot enable Start');
  assert.equal(s.node('native-node-stage').textContent,'—');
  assert.equal(operation(),expectedCode);
  observation=status('not_installed');
  await s.emit('native-node-read','click');
  assert.equal(s.node('native-node-install').disabled,true,'an older observation cannot allow a repeated Install');
  assert.equal(operation(),expectedCode);
  observation=Object.assign(new Error('status unavailable'),{code:'NATIVE_UNAVAILABLE'});
  await s.emit('native-node-read','click');
  assert.equal(s.node('native-node-start').disabled,true);
  assert.equal(operation(),expectedCode);
  observation=status('installed',digest,'9');
  await s.emit('native-node-read','click');
  assert.equal(s.node('native-node-start').disabled,true);
  assert.equal(operation(),expectedCode);
  observation=status('installed',digest,'10');
  await s.emit('native-node-read','click');
  assert.equal(s.node('native-node-start').disabled,false);
  assert.equal(s.node('native-node-install').disabled,true);
  assert.equal(operation(),expectedCode==='UNKNOWN'?'UNKNOWN':'OK');
  assert.equal(s.calls.filter(call=>call.operation==='node_install').length,1);
  assert.equal(s.calls.filter(call=>call.operation==='node_start').length,0);
 });
});

// PUBLIC test-host transport double ONLY. Never a normal CLI/provider port.
// Actual unmodified stdin CLI is the process entry; no field can activate this.
import https from 'node:https';import{syncBuiltinESMExports}from'node:module';import{EventEmitter}from'node:events';
import{createWalletProductSourceFixture}from'./wallet-product-source.fixture.mjs';
if(typeof process.send!=='function')throw Error('PUBLIC_PRODUCT_TEST_IPC_REQUIRED');
const fixture=await createWalletProductSourceFixture();process.once('exit',()=>fixture.close());
https.request=(url,options,callback)=>{
 const request=new EventEmitter();request.destroy=error=>{if(error)request.emit('error',error);request.emit('close')};
 request.end=()=>{queueMicrotask(()=>{try{
  const u=new URL(url);if(options.method!=='GET')throw Error('PUBLIC_PRODUCT_METHOD');let raw,kind;
  const owner=u.pathname.match(/^\/accounts\/(0x[0-9a-f]{40})\/authorization$/)?.[1];
  if(owner&&u.origin===fixture.input.node.origin){const record=fixture.rawRegistrations[owner];if(!record)throw Error('PUBLIC_PRODUCT_OWNER');raw=fixture.canonical(record);kind='registration';}
  else if(u.origin+u.pathname===fixture.input.policy.endpoint){if(u.searchParams.get('profile')!==fixture.sha(fixture.input.profileRaw))throw Error('PUBLIC_PRODUCT_PROFILE');raw=fixture.current(u.searchParams.get('nonce'));kind='current';}
  else throw Error('PUBLIC_PRODUCT_URL');
  process.send({kind:'PUBLIC_PRODUCT_HTTP_MOCK',type:kind});
  const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'application/json'};response.complete=false;response.destroy=()=>response.emit('close');callback(response);response.emit('data',Buffer.from(raw));response.complete=true;response.emit('end');response.emit('close');request.emit('close');
 }catch(cause){request.emit('error',cause);request.emit('close')}});return request;};return request;
};syncBuiltinESMExports();
process.send({kind:'PUBLIC_PRODUCT_INPUT',input:fixture.input});

import {createCanonicalMusicRequest,MUSIC_ORIGIN,MUSIC_SCOPES} from './canonical-request.js';
export const MUSIC_CALLBACK=MUSIC_ORIGIN+'/wallet-auth/callback';
export function createMusicSession({load,activate,dispose,fetch=globalThis.fetch.bind(globalThis),origin=globalThis.location?.origin,timeoutMs=15000}){
 let browser=null,loading=null,epoch=0;
 async function get(){
  if(origin!==MUSIC_ORIGIN)throw Error('Music sign-in requires its registered HTTPS origin');
  if(!loading)loading=Promise.resolve().then(load).then(value=>{
   createCanonicalMusicRequest({browser:value,fetch,origin});
   for(const method of ['restore','beginExplicit','handleReturn','disconnect'])if(typeof value.client?.[method]!=='function')throw Error('Music session lifecycle unavailable');
   browser=value;return value;
  }).catch(error=>{loading=null;throw error});
  return loading;
 }
 async function accept(b,state,revision){
  if(revision!==epoch)return {status:'superseded'};
  if(state.status!=='connected')return state;
  const session=state.session;
  if(session?.productId!=='music'||session.clientId!=='ynx-music-v1'||session.platform!=='web'||session.applicationId!=='com.ynxweb4.music.web'||session.origin!==MUSIC_ORIGIN||session.callback!==MUSIC_CALLBACK||session.bundleId!==null||session.packageId!==null||JSON.stringify(session.scopes)!==JSON.stringify(MUSIC_SCOPES)||!session.account)throw Error('Music session binding mismatch');
  const current=()=>revision===epoch&&b.client.current===state;
  const request=createCanonicalMusicRequest({browser:b,fetch,origin,isCurrent:current});
  await activate(async(path,options)=>{
   const response=await request(path,options);
   if(path==='api/me'&&response.ok){const snapshot=await response.clone().json();if(!current()||snapshot?.profile?.account!==session.account)throw Error('Music account readback mismatch')}
   return response;
  });
  if(!current()){if(revision===epoch)dispose();return {status:'superseded'}}
  return state;
 }
 async function operation(action){const revision=++epoch;dispose();let timer,timedOut=false;const work=(async()=>{const b=await get();if(revision!==epoch)return {status:'superseded'};return accept(b,await action(b.client),revision)})();try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;if(revision===epoch){++epoch;dispose()}reject(Error('Music sign-in timed out. Retry when the service is available.'))},timeoutMs)})])}catch(error){if(revision!==epoch&&!timedOut)return {status:'superseded'};if(revision===epoch)dispose();throw error}finally{clearTimeout(timer)}}
 return Object.freeze({
  restore:(online=true)=>operation(client=>client.restore(online)),
  begin:()=>operation(client=>client.beginExplicit()),
  finishReturn:url=>{const target=new URL(url);if(target.origin+target.pathname!==MUSIC_CALLBACK||target.hash||target.username||target.password)throw Error('Unexpected Music callback');return operation(client=>client.handleReturn(url))},
  async disconnect(){++epoch;dispose();let timer;const work=(async()=>{const b=browser||await get();return b.client.disconnect()})();try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Music sign-out is still pending. Retry to finish the original revocation.')),timeoutMs)})])}finally{clearTimeout(timer)}},
  invalidate(){++epoch;dispose()},
 });
}

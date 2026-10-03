import {createClient, ClientEvent, RoomEvent, IndexedDBStore} from 'matrix-js-sdk';
import {CryptoEvent} from 'matrix-js-sdk/lib/crypto-api/CryptoEvent.js';
import {encryptAttachment, decryptAttachment} from 'matrix-encrypt-attachment';
import {validMatrixUserId} from './login.mjs';
import {validEncryptedAttachment} from './restricted-moments.mjs';
import {createBoundedOperation,wipeBytes} from './bounded-operation.mjs';
export const MATRIX_PROTOCOL = 'ynx-social-matrix/v1';
export class MatrixPolicyError extends Error { constructor(code,message){super(message);this.code=code} }
const fail=(code,message)=>{throw new MatrixPolicyError(code,message)};
export function validateBinding(binding,account,{localQA=false,expectedUserId}={}){
  if(binding?.protocol!==MATRIX_PROTOCOL||binding.account!==account||!/^ynx1[0-9a-z]{38}$/.test(account))fail('MATRIX_ACCOUNT_MISMATCH','Verified YNX identity and transport binding differ');
  const url=new URL(binding.homeserver);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(localQA&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))fail('MATRIX_UNSAFE_ORIGIN','A fixed secure homeserver is required');
  if(!validMatrixUserId(binding.userId,binding.serverName)||binding.userId!==(expectedUserId??`@${account}:${binding.serverName}`)||!/^[A-Za-z0-9._-]{3,64}$/.test(binding.deviceId)||typeof binding.accessToken!=='string'||!binding.accessToken||binding.accessToken.length>8192)fail('MATRIX_INVALID_BINDING','Invalid account/device transport binding');
  return binding;
}
export async function fetchMatrixBinding({account,deviceId,client,csrfToken,fetcher=fetch}){
  const result=await client.restore();if(result.status!=='connected'||result.session.account!==account||!['social.messaging','social.contacts','social.profile'].every(s=>result.session.scopes.includes(s)))fail('MATRIX_PERMISSION_REQUIRED','Explicit Social profile, contacts and messaging approval is required');
  const {proofHeader}=await client.proof(['social.messaging','social.contacts']);
  const response=await fetcher('/social/v3/matrix/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-YNX-Product-Session-Proof-V2':proofHeader,'X-YNX-SSO-CSRF':csrfToken},body:JSON.stringify({deviceId})});
  if(!response.ok)fail('MATRIX_BRIDGE_UNAVAILABLE',`Verified Matrix binding unavailable (${response.status}); legacy encrypted history is retained`);
  return validateBinding(await response.json(),account);
}
export class MatrixSocialTransport {
  constructor({publish=()=>{},onVerification=()=>{},localQA=false,clientFactory=createClient,storeFactory=options=>new IndexedDBStore(options),reauthenticateDevice=null,fetcher=globalThis.fetch}={}){this.publish=publish;this.onVerification=onVerification;this.localQA=localQA;this.clientFactory=clientFactory;this.storeFactory=storeFactory;this.reauthenticateDevice=reauthenticateDevice;this.fetcher=fetcher;this.downloads=new Set();this.client=null;this.generation=0;this.requests=new Map();this.verifiers=new Map();this.sas=new Map();this.connected=false;this.deviceSets=new Map()}
  async connect(binding,account,storageKey,{expectedUserId}={}){
    this.stop();validateBinding(binding,account,{localQA:this.localQA,expectedUserId});if(!(storageKey instanceof Uint8Array)||storageKey.length!==32)fail('MATRIX_STORAGE_REQUIRED','Protected durable crypto storage key is required');
    const generation=this.generation;this.binding=binding;
    const store=this.storeFactory({indexedDB:globalThis.indexedDB,dbName:`ynx-social-matrix-sync-v1:${account}:${binding.deviceId}`});
    // SDK's default cache degradation clears its database. Retain it instead,
    // lock this session, and let the user recover without replacing any keys.
    store.backend.clearDatabase=async()=>{throw new MatrixPolicyError('MATRIX_CACHE_RETAINED','Original sync data was retained')};
    store.on('degraded',()=>{if(generation===this.generation){this.stop();this.publish({type:'storage-locked',code:'MATRIX_STORAGE_RECOVERY_REQUIRED'})}});
    store.on('closed',()=>{if(generation===this.generation){this.stop();this.publish({type:'storage-locked',code:'MATRIX_STORAGE_RECOVERY_REQUIRED'})}});
    store.wantsSave=()=>true;
    const client=this.clientFactory({baseUrl:binding.homeserver,userId:binding.userId,deviceId:binding.deviceId,accessToken:binding.accessToken,store,verificationMethods:['m.sas.v1'],logger:{trace(){},debug(){},info(){},warn(){},error(){},log(){},getChild(){return this}}});
    this.client=client;
    const operation=this.capture();
    try{
      await store.startup();this.guard(operation);
      await client.initRustCrypto({useIndexedDB:true,cryptoDatabasePrefix:`ynx-social-matrix-v1:${account}:${binding.deviceId}`,storageKey});
      if(generation!==this.generation){client.stopClient();fail('MATRIX_STALE_SESSION','Identity changed during crypto startup')}
      const crypto=client.getCrypto();if(!crypto)fail('MATRIX_CRYPTO_UNAVAILABLE','Rust crypto is unavailable');
      crypto.globalBlacklistUnverifiedDevices=true;crypto.setTrustCrossSignedDevices(false);
      // First device only: standard cross-signing. Never reset an existing user
      // identity merely because a new local device lacks its private keys.
      const existingIdentity=await crypto.userHasCrossSigningKeys(binding.userId,true);
      if(generation!==this.generation)fail('MATRIX_STALE_SESSION','Identity changed during trust startup');
      if(!existingIdentity){await crypto.bootstrapCrossSigning({authUploadDeviceSigningKeys:makeRequest=>makeRequest({})});if(generation!==this.generation)fail('MATRIX_STALE_SESSION','Identity changed during trust startup')}
      client.on(ClientEvent.Sync,state=>{if(generation!==this.generation)return;this.connected=['PREPARED','SYNCING'].includes(state);this.publish({type:'sync',state,protocol:MATRIX_PROTOCOL})});
      client.on(CryptoEvent.VerificationRequestReceived,request=>{if(generation===this.generation)this.registerVerification(request)});
      client.on(RoomEvent.Timeline,(event,room)=>{if(generation!==this.generation)return;if(event.getType()==='m.room.encrypted')this.publish({type:'encrypted-event',roomId:room?.roomId,eventId:event.getId()});});
      await client.startClient({initialSyncLimit:100});
      this.guard(operation);
      await this.wait(()=>{this.guard(operation);return this.connected},30000);
      this.guard(operation);
      return {account,userId:binding.userId,deviceId:binding.deviceId,protocol:MATRIX_PROTOCOL,cryptoVersion:crypto.getVersion()};
    }catch(error){client.stopClient();if(this.client===client)this.client=null;throw error}
  }
  stop(){this.generation++;for(const request of this.downloads)request.abort();this.downloads.clear();this.connected=false;this.client?.stopClient();this.client=null;this.requests.clear();this.verifiers.clear();this.sas.clear();this.deviceSets.clear();this.binding=null}
  crypto(){const crypto=this.client?.getCrypto();if(!crypto)fail('MATRIX_LOCKED','Verified Matrix session is not active');return crypto}
  capture(){if(!this.client||!this.binding)fail('MATRIX_LOCKED','Verified Matrix session is not active');return {generation:this.generation,client:this.client,binding:this.binding}}
  guard(operation){if(operation.generation!==this.generation||operation.client!==this.client||operation.binding!==this.binding)fail('MATRIX_STALE_SESSION','Identity changed; old operation was discarded without retry')}
  async wait(check,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100))}fail('MATRIX_TIMEOUT','Matrix operation timed out; keys and history were retained')}
  registerVerification(request){const operation=this.capture(),id=request.transactionId;if(!id)return;this.requests.set(id,request);this.onVerification({id,userId:request.otherUserId,deviceId:request.otherDeviceId,phase:request.phase});request.on('change',()=>{if(operation.generation!==this.generation||operation.client!==this.client)return;const verifier=request.verifier;if(verifier&&!this.verifiers.has(id))this.attachVerifier(id,verifier);this.onVerification({id,userId:request.otherUserId,deviceId:request.otherDeviceId,phase:request.phase});});return id}
  async requestVerification(userId,deviceId){const operation=this.capture(),request=await operation.client.getCrypto().requestDeviceVerification(userId,deviceId);this.guard(operation);return this.registerVerification(request)}
  async acceptVerification(id){const operation=this.capture(),request=this.requests.get(id);if(!request)fail('MATRIX_VERIFICATION_MISSING','Verification request expired');await request.accept();this.guard(operation)}
  async startVerification(id){const operation=this.capture(),request=this.requests.get(id);if(!request)fail('MATRIX_VERIFICATION_MISSING','Verification request expired');const verifier=await request.startVerification('m.sas.v1');this.guard(operation);this.attachVerifier(id,verifier);return id}
  attachVerifier(id,verifier){const operation=this.capture(),current=()=>operation.generation===this.generation&&operation.client===this.client;if(this.verifiers.has(id))return;this.verifiers.set(id,verifier);verifier.on('show_sas',callbacks=>{if(!current())return;this.sas.set(id,callbacks);this.onVerification({id,sas:callbacks.sas,needsConfirmation:true})});verifier.verify().then(()=>{if(!current())return;this.sas.delete(id);this.publish({type:'verification-done',id})},()=>{if(!current())return;this.sas.delete(id);this.publish({type:'verification-cancelled',id})})}
  async confirmVerification(id,confirmed){const operation=this.capture(),callbacks=this.sas.get(id);if(!callbacks)fail('MATRIX_SAS_MISSING','No active SAS comparison');if(confirmed!==true){callbacks.mismatch();return}await callbacks.confirm();this.guard(operation)}
  async rejectVerification(id){const operation=this.capture(),request=this.requests.get(id);if(!request)fail('MATRIX_VERIFICATION_MISSING','Verification request expired');await request.cancel({code:'m.user',reason:'User declined verification'});this.guard(operation);this.sas.delete(id)}
  async devices(userId,operation=this.capture()){this.guard(operation);const devices=(await operation.client.getCrypto().getUserDeviceInfo([userId],true)).get(userId);this.guard(operation);return devices?[...devices.values()]:[]}
  async assertTrusted(roomId,operation=this.capture()){
    this.guard(operation);const client=operation.client,crypto=client.getCrypto();if(!this.connected||!client)fail('MATRIX_OFFLINE','Reconnect before sending; no plaintext fallback');
    const encrypted=await crypto.isEncryptionEnabledInRoom(roomId);this.guard(operation);if(!encrypted)fail('MATRIX_DOWNGRADE_BLOCKED','Room is not encrypted');
    const room=client.getRoom(roomId);if(!room)fail('MATRIX_ROOM_MISSING','Room has not synchronized');
    const members=room.getMembers().filter(m=>['join','invite'].includes(m.membership));
    for(const member of members){const list=await this.devices(member.userId,operation);this.guard(operation);if(!list.length)fail('MATRIX_UNVERIFIED_DEVICE','Participant has no verified encryption device');
      const signature=list.map(d=>`${d.deviceId}:${[...d.keys].sort().map(([k,v])=>`${k}=${v}`).join(',')}`).sort().join('|');
      const key=`${roomId}:${member.userId}`,previous=this.deviceSets.get(key);if(previous&&previous!==signature){await crypto.forceDiscardSession(roomId);this.guard(operation);this.deviceSets.delete(key);this.publish({type:'devices-changed',userId:member.userId});fail('MATRIX_DEVICE_CHANGED','Participant devices changed; compare and verify before sending again')}
      for(const device of list){if(member.userId===operation.binding.userId&&device.deviceId===operation.binding.deviceId)continue;const status=await crypto.getDeviceVerificationStatus(member.userId,device.deviceId);this.guard(operation);if(!status?.isVerified())fail('MATRIX_UNVERIFIED_DEVICE','Verify every participant device before sending');}
      this.deviceSets.set(key,signature);
    }
  }
  async createConversation(peerUserId,{verifiedPeer}={}){const operation=this.capture();const mapped=verifiedPeer&&/^ynx1[0-9a-z]{38}$/.test(verifiedPeer.account)&&verifiedPeer.userId===peerUserId&&validMatrixUserId(peerUserId,verifiedPeer.serverName);if(!mapped&&!/^@ynx1[0-9a-z]{38}:[^\s]+$/.test(peerUserId))fail('MATRIX_PEER_BINDING_REQUIRED','A backend-verified YNX transport alias is required');const result=await operation.client.createRoom({is_direct:true,invite:[peerUserId],preset:'private_chat',initial_state:[{type:'m.room.encryption',state_key:'',content:{algorithm:'m.megolm.v1.aes-sha2',rotation_period_ms:3600000,rotation_period_msgs:100}},{type:'com.ynx.social.protocol',state_key:'',content:{protocol:MATRIX_PROTOCOL,legacyUpgrade:false}}]});this.guard(operation);return result.room_id}
  async join(roomId){const operation=this.capture();await operation.client.joinRoom(roomId);this.guard(operation);await this.wait(()=>{this.guard(operation);return operation.client.getRoom(roomId)?.getMyMembership()==='join'});this.guard(operation)}
  async sendText(roomId,text){const operation=this.capture();if(typeof text!=='string'||!text.trim()||text.length>16000)fail('MATRIX_MESSAGE_INVALID','Message length must be 1..16000');await this.assertTrusted(roomId,operation);this.guard(operation);const result=await operation.client.sendTextMessage(roomId,text);this.guard(operation);return result}
  async sendAttachment(roomId,bytes,{name='attachment',mimeType='application/octet-stream'}={}){
    const operation=this.capture();if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength>25*1024*1024)fail('MATRIX_ATTACHMENT_INVALID','Attachment size must be 1 byte..25MB');await this.assertTrusted(roomId,operation);this.guard(operation);
    const encrypted=await encryptAttachment(bytes);this.guard(operation);const uploaded=await operation.client.uploadContent(new Uint8Array(encrypted.data),{type:'application/octet-stream',includeFilename:false});this.guard(operation);
    await this.assertTrusted(roomId,operation);this.guard(operation);const result=await operation.client.sendMessage(roomId,{msgtype:'m.file',body:name.slice(0,255),file:{...encrypted.info,url:uploaded.content_uri},info:{size:bytes.byteLength,mimetype:mimeType}});this.guard(operation);return result;
  }
  async messages(roomId){const operation=this.capture(),room=operation.client.getRoom(roomId);if(!room)return [];const events=room.getLiveTimeline().getEvents();const result=[];
    for(const event of events){if(!event.isEncrypted())continue;await operation.client.decryptEventIfNeeded(event);this.guard(operation);if(event.isDecryptionFailure())continue;if(event.getType()!=='m.room.message')continue;const verification=await operation.client.getCrypto().getEncryptionInfoForEvent(event);this.guard(operation);if(!verification||verification.shieldColour!==0){result.push({id:event.getId(),sender:event.getSender(),content:{body:'Encrypted message blocked: sender authentication warning'},encrypted:true,verification});continue}
      const record={id:event.getId(),sender:event.getSender(),content:structuredClone(event.getContent()),encrypted:true,verification,remoteConfirmed:event.status===null&&/^\$[^\s\x00-\x1f]{1,254}$/.test(event.getId()),timestamp:event.getTs?.(),localStatus:event.status,
        readByPeer:(room.getUsersReadUpTo?.(event)??[]).some(user=>user!==operation.binding.userId)};
      // Own remote echoes only. Pending local echoes cannot settle delivery.
      const unsigned=event.getUnsigned?.().transaction_id,local=event.getTxnId?.();
      const transactionId=unsigned??local;
      if(record.sender===operation.binding.userId&&record.remoteConfirmed&&typeof transactionId==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(transactionId)&&(unsigned===undefined||local===undefined||unsigned===local))record.transactionId=transactionId;
      result.push(record);
    }this.guard(operation);return result;
  }
  async downloadAttachment(content,{revalidate=async()=>{},assertCurrent=()=>{},signal=null}={}){
    const operation=this.capture();content=structuredClone(content);
    if(!validEncryptedAttachment(content,false))fail('MATRIX_ATTACHMENT_DOWNGRADE','Standard encrypted attachment descriptor required');
    const base=new URL(operation.binding.homeserver),uri=operation.client.mxcUrlToHttp(content.file.url,undefined,undefined,undefined,false,false,true);
    if(!uri)fail('MATRIX_ATTACHMENT_INVALID','Invalid Matrix media URL');
    const url=new URL(uri),[server,media]=content.file.url.slice(6).split('/');
    const expectedPath=`/_matrix/client/v1/media/download/${server}/${media}`;
    if(base.username||base.password||base.pathname!=='/'||base.search||base.hash||!(base.protocol==='https:'||(this.localQA&&base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)))||url.origin!==base.origin||url.username||url.password||url.hash||url.pathname!==expectedPath||[...url.searchParams].some(([key,value])=>key!=='allow_redirect'||!['true','false'].includes(value))||typeof operation.binding.accessToken!=='string'||!operation.binding.accessToken)
      fail('MATRIX_UNSAFE_MEDIA_ORIGIN','Media credentials are restricted to the verified homeserver endpoint');
    url.searchParams.set('allow_redirect','false');
    const bounded=createBoundedOperation({signal}),controller=bounded.controller,limit=25*1024*1024,chunks=[];
    let reader=null,total=0,plain=null;
    this.downloads.add(controller);
    const local=()=>{this.guard(operation);assertCurrent();bounded.guard()};
    let lastChecked=0;
    const checkpoint=async()=>{local();await bounded.wait(()=>revalidate({signal:bounded.signal}));local();lastChecked=performance.now()};
    try{
      await checkpoint();
      const response=await bounded.wait(()=>this.fetcher(url.href,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Authorization:`Bearer ${operation.binding.accessToken}`}}),response=>{if(response.body)void response.body.cancel().catch(()=>{})});
      await checkpoint();
      if(!response.ok||response.redirected||response.type==='opaque'||response.url&&response.url!==url.href)fail('MATRIX_MEDIA_UNAVAILABLE','Encrypted media unavailable at the verified endpoint');
      const rawLength=response.headers.get('content-length');
      if(rawLength!==null&&(!/^\d+$/.test(rawLength)||!Number.isSafeInteger(Number(rawLength))||Number(rawLength)>limit))fail('MATRIX_ATTACHMENT_INVALID','Encrypted attachment exceeds its limit');
      if(!response.body?.getReader)fail('MATRIX_MEDIA_UNAVAILABLE','Bounded media stream required');
      reader=response.body.getReader();
      while(true){
        const {done,value}=await bounded.wait(()=>reader.read(),result=>wipeBytes(result?.value));local();
        // HTTP chunk boundaries must not dictate signed REST traffic. Local
        // epoch/abort checks run every await; remote checks are time-bounded.
        if(performance.now()-lastChecked>=5000)await checkpoint();if(done)break;
        if(!(value instanceof Uint8Array)||total+value.byteLength>limit)fail('MATRIX_ATTACHMENT_INVALID','Encrypted attachment exceeds its limit');
        total+=value.byteLength;chunks.push(value.slice());
      }
      if(!total||rawLength!==null&&Number(rawLength)!==total||content.info?.size!==undefined&&content.info.size!==total)fail('MATRIX_ATTACHMENT_INVALID','Encrypted attachment length differs from its descriptor');
      await checkpoint();
      const encrypted=new Uint8Array(total);let offset=0;for(const chunk of chunks){encrypted.set(chunk,offset);offset+=chunk.byteLength}
      try{plain=await bounded.wait(()=>decryptAttachment(encrypted.buffer,content.file),wipeBytes);await checkpoint()}finally{encrypted.fill(0)}
      return plain;
    }catch(error){wipeBytes(plain);throw error}
    finally{this.downloads.delete(controller);bounded.dispose();if(reader){void reader.cancel().catch(()=>{});try{reader.releaseLock()}catch{}}for(const chunk of chunks)chunk.fill(0)}
  }
  async revokeOwnDevice(deviceId,confirmed){
    const operation=this.capture();if(confirmed!==true)fail('MATRIX_CONFIRMATION_REQUIRED','Explicit device removal confirmation required');
    try{await operation.client.deleteDevice(deviceId)}catch(error){
      this.guard(operation);if(error?.httpStatus!==401)throw error;
      const data=error.data||{},flows=Array.isArray(data.flows)?data.flows.map(flow=>({stages:Array.isArray(flow.stages)?flow.stages.filter(stage=>typeof stage==='string'):[]})):[];
      this.publish({type:'device-reauth-required',deviceId,status:401,flows});
      if(!this.reauthenticateDevice||typeof data.session!=='string'||!flows.length)fail('MATRIX_DEVICE_REAUTH_REQUIRED','Device removal requires supported identity reauthentication; nothing was revoked');
      const result=await this.reauthenticateDevice({deviceId,account:operation.binding.account,userId:operation.binding.userId,homeserver:operation.binding.homeserver,challenge:{session:data.session,flows}});this.guard(operation);
      // SSO fallback is completed out of band. Its standard retry contains
      // only the original session; the local completion stage is not sent.
      const fallback=result?.completedStage!==undefined,auth=fallback?result.auth:result;
      const supported=fallback?result.completedStage==='m.login.sso'&&flows.some(flow=>flow.stages.includes(result.completedStage))&&auth&&Object.keys(auth).length===1:flows.some(flow=>flow.stages.includes(auth?.type));
      if(!auth||auth.session!==data.session||!supported)fail('MATRIX_DEVICE_REAUTH_REQUIRED','Identity reauthentication did not match the upstream challenge');
      const identity=await operation.client.whoami();this.guard(operation);
      if(identity.user_id!==operation.binding.userId||identity.device_id!==operation.binding.deviceId)fail('MATRIX_ACCOUNT_MISMATCH','Homeserver identity differs from the original device-removal session');
      await operation.client.deleteDevice(deviceId,auth);
    }
    this.guard(operation);if(deviceId===operation.binding.deviceId)this.stop();
  }
}

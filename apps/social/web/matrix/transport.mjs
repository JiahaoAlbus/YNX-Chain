import {createClient, ClientEvent, RoomEvent, MemoryStore} from 'matrix-js-sdk';
import {CryptoEvent} from 'matrix-js-sdk/lib/crypto-api/CryptoEvent.js';
import {encryptAttachment, decryptAttachment} from 'matrix-encrypt-attachment';
export const MATRIX_PROTOCOL = 'ynx-social-matrix/v1';
export class MatrixPolicyError extends Error { constructor(code,message){super(message);this.code=code} }
const fail=(code,message)=>{throw new MatrixPolicyError(code,message)};
export function validateBinding(binding,account,{localQA=false}={}){
  if(binding?.protocol!==MATRIX_PROTOCOL||binding.account!==account||!/^ynx1[0-9a-z]{38}$/.test(account))fail('MATRIX_ACCOUNT_MISMATCH','Verified YNX identity and transport binding differ');
  const url=new URL(binding.homeserver);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(localQA&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))fail('MATRIX_UNSAFE_ORIGIN','A fixed secure homeserver is required');
  if(binding.userId!==`@${account}:${binding.serverName}`||!/^[A-Za-z0-9._-]{3,64}$/.test(binding.deviceId)||typeof binding.accessToken!=='string'||!binding.accessToken||binding.accessToken.length>8192)fail('MATRIX_INVALID_BINDING','Invalid account/device transport binding');
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
  constructor({publish=()=>{},onVerification=()=>{},localQA=false,clientFactory=createClient}={}){this.publish=publish;this.onVerification=onVerification;this.localQA=localQA;this.clientFactory=clientFactory;this.client=null;this.generation=0;this.requests=new Map();this.verifiers=new Map();this.sas=new Map();this.connected=false;this.deviceSets=new Map()}
  async connect(binding,account,storageKey){
    this.stop();validateBinding(binding,account,{localQA:this.localQA});if(!(storageKey instanceof Uint8Array)||storageKey.length!==32)fail('MATRIX_STORAGE_REQUIRED','Protected durable crypto storage key is required');
    const generation=this.generation;this.binding=binding;
    const client=this.clientFactory({baseUrl:binding.homeserver,userId:binding.userId,deviceId:binding.deviceId,accessToken:binding.accessToken,store:new MemoryStore(),verificationMethods:['m.sas.v1'],logger:{trace(){},debug(){},info(){},warn(){},error(){},log(){},getChild(){return this}}});
    this.client=client;
    const operation=this.capture();
    try{
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
  stop(){this.generation++;this.connected=false;this.client?.stopClient();this.client=null;this.requests.clear();this.verifiers.clear();this.sas.clear();this.deviceSets.clear();this.binding=null}
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
  async createConversation(peerUserId){const operation=this.capture();if(!/^@ynx1[0-9a-z]{38}:[^\s]+$/.test(peerUserId))fail('MATRIX_PEER_BINDING_REQUIRED','A backend-verified YNX transport alias is required');const result=await operation.client.createRoom({is_direct:true,invite:[peerUserId],preset:'private_chat',initial_state:[{type:'m.room.encryption',state_key:'',content:{algorithm:'m.megolm.v1.aes-sha2',rotation_period_ms:3600000,rotation_period_msgs:100}},{type:'com.ynx.social.protocol',state_key:'',content:{protocol:MATRIX_PROTOCOL,legacyUpgrade:false}}]});this.guard(operation);return result.room_id}
  async join(roomId){const operation=this.capture();await operation.client.joinRoom(roomId);this.guard(operation);await this.wait(()=>{this.guard(operation);return operation.client.getRoom(roomId)?.getMyMembership()==='join'});this.guard(operation)}
  async sendText(roomId,text){const operation=this.capture();if(typeof text!=='string'||!text.trim()||text.length>16000)fail('MATRIX_MESSAGE_INVALID','Message length must be 1..16000');await this.assertTrusted(roomId,operation);this.guard(operation);const result=await operation.client.sendTextMessage(roomId,text);this.guard(operation);return result}
  async sendAttachment(roomId,bytes,{name='attachment',mimeType='application/octet-stream'}={}){
    const operation=this.capture();if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength>25*1024*1024)fail('MATRIX_ATTACHMENT_INVALID','Attachment size must be 1 byte..25MB');await this.assertTrusted(roomId,operation);this.guard(operation);
    const encrypted=await encryptAttachment(bytes);this.guard(operation);const uploaded=await operation.client.uploadContent(new Uint8Array(encrypted.data),{type:'application/octet-stream',includeFilename:false});this.guard(operation);
    await this.assertTrusted(roomId,operation);this.guard(operation);const result=await operation.client.sendMessage(roomId,{msgtype:'m.file',body:name.slice(0,255),file:{...encrypted.info,url:uploaded.content_uri},info:{size:bytes.byteLength,mimetype:mimeType}});this.guard(operation);return result;
  }
  async messages(roomId){const operation=this.capture(),room=operation.client.getRoom(roomId);if(!room)return [];const events=room.getLiveTimeline().getEvents();const result=[];
    for(const event of events){if(!event.isEncrypted())continue;await operation.client.decryptEventIfNeeded(event);this.guard(operation);if(event.isDecryptionFailure())continue;if(event.getType()!=='m.room.message')continue;const verification=await operation.client.getCrypto().getEncryptionInfoForEvent(event);this.guard(operation);if(!verification||verification.shieldColour!==0){result.push({id:event.getId(),sender:event.getSender(),content:{body:'Encrypted message blocked: sender authentication warning'},encrypted:true,verification});continue}result.push({id:event.getId(),sender:event.getSender(),content:event.getContent(),encrypted:true,verification})}this.guard(operation);return result;
  }
  async downloadAttachment(content){const operation=this.capture();if(!content?.file?.url||content.url)fail('MATRIX_ATTACHMENT_DOWNGRADE','Encrypted attachment descriptor required');const url=operation.client.mxcUrlToHttp(content.file.url,undefined,undefined,undefined,false,true,true);if(!url)fail('MATRIX_ATTACHMENT_INVALID','Invalid Matrix media URL');const response=await fetch(url,{headers:{Authorization:`Bearer ${operation.binding.accessToken}`}});this.guard(operation);if(!response.ok)fail('MATRIX_MEDIA_UNAVAILABLE','Encrypted media unavailable');const bytes=await response.arrayBuffer();this.guard(operation);if(bytes.byteLength>25*1024*1024)fail('MATRIX_ATTACHMENT_INVALID','Encrypted attachment exceeds its limit');const plain=await decryptAttachment(bytes,content.file);this.guard(operation);return plain}
  async revokeOwnDevice(deviceId,confirmed){const operation=this.capture();if(confirmed!==true)fail('MATRIX_CONFIRMATION_REQUIRED','Explicit device removal confirmation required');await operation.client.deleteDevice(deviceId);this.guard(operation);if(deviceId===operation.binding.deviceId)this.stop()}
}

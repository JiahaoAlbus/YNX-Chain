//! Original-byte message evidence, never qualification or permission.
//! Only the retained native account/Source caller supplies original facts.
use crate::source_evidence::{Error,MessageSourceKeys,Scope};
#[path="r5_device_originals.rs"]pub(crate)mod r5_device_originals;
// Public DATA consistency only; the native prekey proof owner independently
// retains the actual accepted-device Source and checks current around it.
#[path="message_evidence/prekey_request_metadata.rs"]mod prekey_request_metadata;
#[path="native_completed_public.rs"]pub(crate)mod native_completed_public;
use base64::{Engine as _,engine::general_purpose::URL_SAFE_NO_PAD as B64};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::{marker::PhantomData,rc::Rc,time::{Duration,Instant}};
use zeroize::Zeroizing;
#[path="initialization_engine_binding.rs"]mod initialization_engine_binding;
pub(crate)use initialization_engine_binding::InitializationEngineBinding;
#[path="message_evidence/ordinary_commit_v2.rs"]pub(crate)mod ordinary_commit_v2;
#[path="message_evidence/initial_operation_set_v2.rs"]mod initial_operation_set_v2;
const PURPOSE:&[u8]=b"YNX/SOCIAL/MESSAGE-PURPOSE/V1\0";
const ASSOCIATION:&[u8]=b"YNX/SOCIAL/MESSAGE-ASSOCIATION/V1\0";
const FINAL:&[u8]=b"YNX/SOCIAL/MESSAGE-FINAL/V1\0";
const MAX_BODY:usize=32768;
pub(crate)fn message_purpose_kind_hint(raw:&[u8])->Result<crate::initial_session_contract::MessagePurposeKind,Error>{
 // Untrusted DATA until the native session independently verifies this SAME
 // Root original and its projection binds sha256(raw). Never a grant here.
 if raw.is_empty()||raw.len()>65536{return Err(Error::Bounds)}
 let value:serde_json::Value=serde_json::from_slice(raw).map_err(|_|Error::Bounds)?;
 let encoded=value.get("body").and_then(serde_json::Value::as_str).ok_or(Error::Binding)?;
 let bytes=B64.decode(encoded).map_err(|_|Error::Bounds)?;if bytes.len()>MAX_BODY||B64.encode(&bytes)!=encoded{return Err(Error::Bounds)}
 let p:PurposeAuthorization=canonical(&bytes)?;crate::initial_session_contract::kind_from_root_label(&p.purpose).ok_or(Error::Binding)
}
const MAX_SAFE:u64=(1u64<<53)-1;
fn hash(raw:&[u8])->String{Sha256::digest(raw).iter().map(|b|format!("{b:02x}")).collect()}
fn digest(v:&str)->bool{v.len()==64&&v.bytes().all(|v|v.is_ascii_digit()||(b'a'..=b'f').contains(&v))}
fn label(v:&str,max:usize)->bool{!v.is_empty()&&v.len()<=max&&v.bytes().all(|v|(33..=126).contains(&v))}
fn decoded<const N:usize>(v:&str)->Result<[u8;N],Error>{let raw=B64.decode(v).map_err(|_|Error::Bounds)?;if B64.encode(&raw)!=v{return Err(Error::Canonical)}raw.try_into().map_err(|_|Error::Bounds)}
fn canonical<T:Serialize+for<'d>Deserialize<'d>>(raw:&[u8])->Result<T,Error>{
 if raw.is_empty()||raw.len()>MAX_BODY{return Err(Error::Bounds)}
 let body:T=serde_json::from_slice(raw).map_err(|_|Error::Canonical)?;
 let encoded=serde_json::to_string(&body).map_err(|_|Error::Canonical)?.replace('&',"\\u0026").replace('<',"\\u003c").replace('>',"\\u003e").replace('\u{2028}',"\\u2028").replace('\u{2029}',"\\u2029");
 if encoded.as_bytes()!=raw{return Err(Error::Canonical)}Ok(body)
}
#[derive(Serialize,Deserialize,PartialEq,Eq)]#[serde(deny_unknown_fields,rename_all="camelCase")]
pub(crate)struct MessageBinding{coordinates:[String;11],source_abi:String}
impl MessageBinding{
 fn values(&self)->Result<[u64;11],Error>{
  let mut out=[0;11];for(i,s)in self.coordinates.iter().enumerate(){let n=s.parse::<u64>().map_err(|_|Error::Bounds)?;if n.to_string()!=*s{return Err(Error::Canonical)}out[i]=n;}
  if !digest(&self.source_abi){return Err(Error::Binding)}Ok(out)
 }
 pub(crate)fn matches(&self,coordinates:&[u64;11],source_abi:&[u8;32])->Result<(),Error>{if self.values()?!=*coordinates||self.source_abi!=source_abi.iter().map(|b|format!("{b:02x}")).collect::<String>(){return Err(Error::Binding)}Ok(())}
}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Resource{administration_domain:String,enrollment_digest:String,ak_public_digest:String,ak_name:String,sealed_object_name:String,policy_digest:String,nv_name:String,protected_service_binary_digest:String}
impl Resource{
 fn shape(&self)->bool{
  // TPM Names are actual name bytes, not aliases. Mathematical shape alone
  // does not establish independent administration, enrollment or possession.
  let name=|v:&str|B64.decode(v).is_ok_and(|b|!b.is_empty()&&b.len()<=68&&B64.encode(b)==v);
  label(&self.administration_domain,512)&&[&self.enrollment_digest,&self.ak_public_digest,&self.policy_digest,&self.protected_service_binary_digest].iter().all(|v|digest(v))&&[&self.ak_name,&self.sealed_object_name,&self.nv_name].iter().all(|v|name(v))
 }
}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct PurposeAuthorization{version:u32,purpose:String,environment:String,bootstrap:String,issuer_credential_digest:String,anchor_credential_digest:String,scope:Scope,issuer_resource:Resource,anchor_resource:Resource,allowed_directions:Vec<u8>,#[serde(rename="notBeforeMS")]not_before:i64,#[serde(rename="expiresMS")]expires:i64}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Address{name:String,device_id:u32}
impl Address{fn shape(&self)->bool{label(&self.name,512)&&libsignal_protocol::DeviceId::try_from(self.device_id).is_ok()}}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Association{version:u32,purpose:String,purpose_authorization_digest:String,operation:String,request_digest:String,nonce:String,account_current_digest:String,source_history_digest:String,scope:Scope,binding:MessageBinding,selected_session_digest:String,local:Address,remote:Address,accepted_relation_digest:String,contact_checkpoint_digest:String,logical:String,direction:u8,#[serde(rename="issuedMS")]issued:i64,#[serde(rename="expiresMS")]expires:i64}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct FinalCheckpoint{version:u32,purpose:String,purpose_authorization_digest:String,association_digest:String,operation:String,request_digest:String,nonce:String,scope:Scope,binding:MessageBinding,logical:String,direction:u8,protected_journal_digest:String,protected_output_digest:String,output_kind:u8,output_bytes:u64,previous_checkpoint_digest:String,checkpoint_sequence:u64,checkpoint_digest:String,issuer_fence_digest:String,anchor_fence_digest:String,issuer_monotonic_attestation_digest:String,anchor_monotonic_attestation_digest:String,state:String,#[serde(rename="issuedMS")]issued:i64,#[serde(rename="expiresMS")]expires:i64}
// Private original facts are supplied by same native retained owners. These
// inputs cannot create a qualified capability; they only constrain evidence.
pub(crate)struct OriginalMessageFacts<'a>{pub(crate)operation:&'a str,pub(crate)request:&'a[u8],pub(crate)nonce:&'a[u8;32],pub(crate)account_current:&'a[u8],source_history_digest:String,pub(crate)started:Instant,pub(crate)remaining:Duration,pub(crate)issued:i64,pub(crate)expires:i64}
// One immutable operation window, not the lifetime of an authenticated device
// or ratchet session. It is created at original operation capture and has no
// refresh/renew method. Restoring a session must create a NEW operation origin,
// never replace this window or reuse an expired first-device Attempt.
struct MessageOperationWindow{started:Instant,budget:Duration,expires:i64}
impl MessageOperationWindow{
 fn from_original(started:Instant,budget:Duration,expires:i64,at:i64)->Result<Self,Error>{
  if expires<=at||started.elapsed()>=budget{return Err(Error::Window)}
  let elapsed=started.elapsed();
  let signed=elapsed.checked_add(Duration::from_millis((expires-at)as u64)).ok_or(Error::Window)?;
  Ok(Self{started,budget:budget.min(signed),expires})
 }
 fn recheck(&self)->Result<(),Error>{if self.started.elapsed()>=self.budget||crate::source_evidence::now_ms()?>=self.expires{return Err(Error::Window)}Ok(())}
}
// The normal caller retains this evidence inside the SAME operation. Borrowing
// keys prevents Source replacement; !Send prevents migration to another worker.
pub(crate)struct MessageEvidence<'a>{keys:MessageSourceKeys<'a>,account:&'a crate::account_instance::Attempt,purpose:PurposeAuthorization,association:Association,purpose_raw:Zeroizing<Vec<u8>>,association_raw:Zeroizing<Vec<u8>>,window:MessageOperationWindow,local:PhantomData<Rc<()>>}
fn verify_association_inner<'a>(keys:MessageSourceKeys<'a>,permit_raw:&[u8],issuer_raw:&[u8],anchor_raw:&[u8],original:&OriginalMessageFacts<'_>,account:&'a crate::account_instance::Attempt)->Result<MessageEvidence<'a>,Error>{
 let total=permit_raw.len().checked_add(issuer_raw.len()).and_then(|n|n.checked_add(anchor_raw.len())).ok_or(Error::Bounds)?;
 if total>393216{return Err(Error::Bounds)}
 keys.recheck()?;let at=crate::source_evidence::now_ms()?;
 let permit=keys.verify(permit_raw,PURPOSE,"purpose-authorization")?;let p:PurposeAuthorization=canonical(&permit)?;
 let(i,a)=keys.credential_digests();
 let selected_purpose=crate::initial_session_contract::operation_kind(original.operation).ok_or(Error::Binding)?;
 if p.version!=1||p.purpose!=crate::initial_session_contract::root_label(selected_purpose)||p.environment!="testnet-qa"||p.bootstrap!=keys.bootstrap()?||p.issuer_credential_digest!=i||p.anchor_credential_digest!=a||p.scope!=*keys.scope()||!p.issuer_resource.shape()||!p.anchor_resource.shape()||p.allowed_directions.is_empty()||p.allowed_directions.len()>2||!matches!(p.allowed_directions.as_slice(),[1]|[2]|[1,2]){return Err(Error::Binding)}
 // Distinct labels/digests are required but NEVER prove domain independence.
 if p.issuer_resource.administration_domain==p.anchor_resource.administration_domain||p.issuer_resource.enrollment_digest==p.anchor_resource.enrollment_digest||p.issuer_resource.ak_public_digest==p.anchor_resource.ak_public_digest{return Err(Error::Binding)}
 let association=keys.verify(issuer_raw,ASSOCIATION,"association-issuer")?;
 if keys.verify(anchor_raw,ASSOCIATION,"association-anchor")?!=association{return Err(Error::Binding)}
 let a:Association=canonical(&association)?;
 if a.version!=1||a.purpose!=crate::initial_session_contract::association_label(selected_purpose)||a.purpose_authorization_digest!=hash(permit_raw)||a.operation!=original.operation||!label(&a.operation,128)||a.request_digest!=hash(original.request)||decoded::<32>(&a.nonce)?!=*original.nonce||a.account_current_digest!=hash(original.account_current)||a.source_history_digest!=original.source_history_digest||a.scope!=p.scope||!a.local.shape()||!a.remote.shape()||!p.allowed_directions.contains(&a.direction)||decoded::<16>(&a.logical)?.iter().all(|b|*b==0)||[&a.selected_session_digest,&a.accepted_relation_digest,&a.contact_checkpoint_digest].iter().any(|v|!digest(v)){return Err(Error::Binding)}
 a.binding.values()?;
 let lower=p.not_before.max(a.issued).max(original.issued);let expires=p.expires.min(a.expires).min(original.expires).min(keys.expires());
 if p.not_before<0||p.expires>MAX_SAFE as i64||a.expires>MAX_SAFE as i64||p.expires<=p.not_before||a.issued<0||a.expires<=a.issued||a.expires-a.issued>30000||original.issued<0||original.expires<=original.issued||lower>at||expires<=at||original.started.elapsed()>=original.remaining{return Err(Error::Window)}
 // Same monotonic origin and elapsed budget: response/parsing never renews it.
 let window=MessageOperationWindow::from_original(original.started,original.remaining,expires,at)?;
 let evidence=MessageEvidence{keys,account,purpose:p,association:a,purpose_raw:Zeroizing::new(permit_raw.to_vec()),association_raw:Zeroizing::new(issuer_raw.to_vec()),window,local:PhantomData};evidence.recheck()?;Ok(evidence)
}
impl MessageEvidence<'_>{
 pub(crate)fn recheck(&self)->Result<(),Error>{self.keys.recheck()?;self.account.recheck().map_err(|_|Error::Window)?;self.window.recheck()}
 pub(crate)fn bind_snapshot(&self,coordinates:&[u64;11],source_abi:&[u8;32],selected_session:&[u8],relation:&[u8],contact_checkpoint:&[u8],logical:&[u8;16],direction:u8)->Result<(),Error>{
  self.recheck()?;validate_contact_originals(relation,contact_checkpoint)?;let a=&self.association;a.binding.matches(coordinates,source_abi)?;
  if a.selected_session_digest!=hash(selected_session)||a.accepted_relation_digest!=hash(relation)||a.contact_checkpoint_digest!=hash(contact_checkpoint)||decoded::<16>(&a.logical)?!=*logical||a.direction!=direction{return Err(Error::Binding)}self.recheck()
 }
 pub(crate)fn verify_final(&self,issuer_raw:&[u8],anchor_raw:&[u8],original_checkpoint:&[u8],protected_journal:&[u8],protected_output:&[u8],output_kind:u8,prior_checkpoint:&[u8],sequence:u64,issuer_fence:&[u8],anchor_fence:&[u8],issuer_attestation:&[u8],anchor_attestation:&[u8])->Result<UnadmittedFinalEvidence,Error>{
  self.recheck()?;if original_checkpoint.is_empty()||protected_journal.is_empty()||prior_checkpoint.is_empty()||issuer_fence.is_empty()||anchor_fence.is_empty()||issuer_attestation.is_empty()||anchor_attestation.is_empty()||sequence==0||sequence>MAX_SAFE||original_checkpoint.len()>393216||prior_checkpoint.len()>393216||protected_journal.len()>1048576||[issuer_fence,anchor_fence,issuer_attestation,anchor_attestation].iter().any(|v|v.len()>65536)||protected_output.len()>1048576||!match self.association.direction{1=>matches!(output_kind,2|3),2=>output_kind==1&&protected_output.len()<=65536,_=>false}{return Err(Error::Bounds)}
  let raw=self.keys.verify(issuer_raw,FINAL,"final-issuer")?;if self.keys.verify(anchor_raw,FINAL,"final-anchor")?!=raw{return Err(Error::Binding)}
  let f:FinalCheckpoint=canonical(&raw)?;let a=&self.association;let now=crate::source_evidence::now_ms()?;
  let selected_purpose=crate::initial_session_contract::operation_kind(&a.operation).ok_or(Error::Binding)?;
  if f.version!=1||f.purpose!=crate::initial_session_contract::final_label(selected_purpose)||f.purpose_authorization_digest!=hash(&self.purpose_raw)||f.association_digest!=hash(&self.association_raw)||f.operation!=a.operation||f.request_digest!=a.request_digest||f.nonce!=a.nonce||f.scope!=a.scope||f.binding!=a.binding||f.logical!=a.logical||f.direction!=a.direction||f.state!="COMMITTED"||f.protected_journal_digest!=hash(protected_journal)||f.protected_output_digest!=hash(protected_output)||f.output_kind!=output_kind||f.output_bytes!=protected_output.len()as u64||f.previous_checkpoint_digest!=hash(prior_checkpoint)||f.checkpoint_sequence!=sequence||f.checkpoint_digest!=hash(original_checkpoint)||f.issuer_fence_digest!=hash(issuer_fence)||f.anchor_fence_digest!=hash(anchor_fence)||f.issuer_monotonic_attestation_digest!=hash(issuer_attestation)||f.anchor_monotonic_attestation_digest!=hash(anchor_attestation){return Err(Error::Binding)}
  if f.issued<a.issued||f.issued>now||f.expires<=now||f.expires>self.window.expires||f.expires-f.issued>30000{return Err(Error::Window)}self.recheck()?;
  // Independent enrollment/attestation/terminal owner must STILL verify these
  // original inputs. This mathematical result is NOT NativeVerifiedFinalCommit.
  Ok(UnadmittedFinalEvidence{issuer:Zeroizing::new(issuer_raw.to_vec()),anchor:Zeroizing::new(anchor_raw.to_vec()),checkpoint:Zeroizing::new(original_checkpoint.to_vec()),local:PhantomData})
 }
}
pub(crate)struct UnadmittedFinalEvidence{issuer:Zeroizing<Vec<u8>>,anchor:Zeroizing<Vec<u8>>,checkpoint:Zeroizing<Vec<u8>>,local:PhantomData<Rc<()>>}


// The normal acquisition caller cannot choose its account/request/current
// expectations. Those come from the original retained Attempt under its borrow.
pub(crate)fn verify_association<'a>(keys:MessageSourceKeys<'a>,permit:&[u8],issuer:&[u8],anchor:&[u8],account:&'a crate::account_instance::Attempt)->Result<MessageEvidence<'a>,Error>{
 let mut retained_keys=Some(keys);let mut result=None;
 account.with_message_original(|original|{
  let keys=retained_keys.take().ok_or(crate::account_instance::Error::Unknown)?;
  let history=keys.history_original().map_err(|_|crate::account_instance::Error::Binding)?;
  let facts=OriginalMessageFacts{operation:original.operation,request:original.request,nonce:original.nonce,account_current:original.current,source_history_digest:hash(history),started:original.started,remaining:original.budget,issued:original.issued,expires:original.expires};
  // history is used only for its original digest before moving the key borrow.
  let current=verify_association_inner(keys,permit,issuer,anchor,&facts,account);
  result=Some(current);Ok(())
 }).map_err(|_|Error::Window)?;
 result.ok_or(Error::Binding)?
}


#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct OpenTransport{version:u32,issuer_credential:String,anchor_credential:String,purpose_authorization:String,association_issuer:String,association_anchor:String}
// Unsigned transport approved separately; none of these bytes selects a Root.
pub(crate)struct MessageOpenInput{pub(crate)issuer_credential:Zeroizing<Vec<u8>>,pub(crate)anchor_credential:Zeroizing<Vec<u8>>,pub(crate)purpose_authorization:Zeroizing<Vec<u8>>,pub(crate)association_issuer:Zeroizing<Vec<u8>>,pub(crate)association_anchor:Zeroizing<Vec<u8>>}
impl MessageOpenInput{
 pub(crate)fn parse(raw:&[u8])->Result<Self,Error>{
  if raw.is_empty()||raw.len()>393216{return Err(Error::Bounds)}
  let t:OpenTransport=serde_json::from_slice(raw).map_err(|_|Error::Canonical)?;
  let encoded=serde_json::to_string(&t).map_err(|_|Error::Canonical)?.replace('&',"\\u0026").replace('<',"\\u003c").replace('>',"\\u003e").replace('\u{2028}',"\\u2028").replace('\u{2029}',"\\u2029");
  if encoded.as_bytes()!=raw{return Err(Error::Canonical)}if t.version!=1{return Err(Error::Binding)}
  let decode=|value:&str|->Result<Zeroizing<Vec<u8>>,Error>{if value.len()>65536usize.div_ceil(3)*4{return Err(Error::Bounds)}let bytes=B64.decode(value).map_err(|_|Error::Bounds)?;if bytes.is_empty()||bytes.len()>65536||B64.encode(&bytes)!=value{return Err(Error::Canonical)}Ok(Zeroizing::new(bytes))};
  let input=Self{issuer_credential:decode(&t.issuer_credential)?,anchor_credential:decode(&t.anchor_credential)?,purpose_authorization:decode(&t.purpose_authorization)?,association_issuer:decode(&t.association_issuer)?,association_anchor:decode(&t.association_anchor)?};
  let total=[&input.issuer_credential,&input.anchor_credential,&input.purpose_authorization,&input.association_issuer,&input.association_anchor].iter().try_fold(0usize,|n,b|n.checked_add(b.len()).ok_or(Error::Bounds))?;
  if total>393216{return Err(Error::Bounds)}Ok(input)
 }
}

impl MessageEvidence<'_>{
 pub(crate)fn with_enrollments<R>(&self,issuer:&[u8],issuer_history:&[&[u8]],anchor:&[u8],anchor_history:&[&[u8]],run:impl for<'b>FnOnce(crate::message_enrollment::UnadmittedEnrollment<'b>,crate::message_enrollment::UnadmittedEnrollment<'b>)->R)->Result<R,(Error,Option<R>)>{
  self.recheck().map_err(|e|(e,None))?;
  let i=crate::message_enrollment::verify(&self.keys,issuer,issuer_history,1,&self.purpose.issuer_resource.enrollment_digest).map_err(|e|(e,None))?;
  let a=crate::message_enrollment::verify(&self.keys,anchor,anchor_history,2,&self.purpose.anchor_resource.enrollment_digest).map_err(|e|(e,None))?;
  for (r,e) in [(&self.purpose.issuer_resource,&i),(&self.purpose.anchor_resource,&a)]{
   let n=&e.registration;
   if r.administration_domain!=n.administration_domain||r.ak_public_digest!=hash(&B64.decode(&n.attestation_key_public).map_err(|_|(Error::Bounds,None))?)||r.ak_name!=n.ak_name||r.sealed_object_name!=n.object_name||r.nv_name!=n.counter_name||r.protected_service_binary_digest!=n.protected_service_binary_digest||r.policy_digest!=hash(&B64.decode(&n.object_policy).map_err(|_|(Error::Bounds,None))?){return Err((Error::Binding,None))}
  }
  // Necessary distinctness, never proof of separate administration or hardware.
  if i.registration.platform_identity_digest==a.registration.platform_identity_digest||i.registration.administration_domain==a.registration.administration_domain||i.registration.protected_service_endpoint==a.registration.protected_service_endpoint{return Err((Error::Binding,None))}
  i.recheck().map_err(|e|(e,None))?;a.recheck().map_err(|e|(e,None))?;self.recheck().map_err(|e|(e,None))?;
  let result=run(i,a);
  match self.recheck(){Ok(())=>Ok(result),Err(e)=>Err((e,Some(result)))}
 }
}

// Exact Main durable ORIGINAL bytes. These facts never create authority or an
// independent rollback floor; authenticated account-to-address mapping and the
// protected checkpoint must still be supplied by the retained native owner.
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct ContactRelationOriginal{version:u32,request_id:String,from:String,to:String,revision:u64,state:String,created_ms:u64,expires_ms:u64,changed_ms:u64}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct ContactCheckpointOriginal{version:u32,sequence:u64,journal_digest:String,relation_digest:String}
fn validate_contact_originals(relation:&[u8],checkpoint:&[u8])->Result<(),Error>{
 let r:ContactRelationOriginal=canonical(relation)?;
 let c:ContactCheckpointOriginal=canonical(checkpoint)?;
 if r.version!=1||!label(&r.request_id,128)||!label(&r.from,512)||!label(&r.to,512)||r.from==r.to||r.revision==0||r.revision>MAX_SAFE||r.state!="accepted"||r.created_ms>MAX_SAFE||r.expires_ms>MAX_SAFE||r.changed_ms>MAX_SAFE||r.expires_ms<=r.created_ms||r.changed_ms<r.created_ms||r.changed_ms>=r.expires_ms||c.version!=1||c.sequence==0||c.sequence>MAX_SAFE||!digest(&c.journal_digest)||c.relation_digest!=hash(relation){return Err(Error::Binding)}
 Ok(())
}

const DEVICE_FINAL:&[u8]=b"YNX/SOCIAL/ACCEPTED-DEVICE-FINAL/V1\0";
const DEVICE_CURRENT:&[u8]=b"YNX/SOCIAL/ACCEPTED-DEVICE-CURRENT/V1\0";
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct DeviceFinalBody{version:u32,purpose:String,account:String,device:String,root_digest:String,registration_digest:String,device_classic:String,#[serde(rename="devicePQ")]device_pq:String,first_device_operation_digest:String,independent_terminal_digest:String,checkpoint_digest:String,sequence:String}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct DeviceCurrentBody{version:u32,purpose:String,final_digest:String,sequence:String,previous_digest:Option<String>,state:String,revocation_checkpoint_digest:String,#[serde(rename="issuedMS")]issued:i64,#[serde(rename="expiresMS")]expires:i64}
#[path="message_evidence/prekey_server_current.rs"]pub(crate)mod prekey_server_current;
#[path="message_evidence/prekey_server_physical_records.rs"]pub(crate)mod prekey_server_physical_records;
fn device_sequence(v:&str)->Result<u64,Error>{let n=v.parse::<u64>().map_err(|_|Error::Bounds)?;if n==0||n.to_string()!=v{return Err(Error::Canonical)}Ok(n)}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct DeviceRecordsTransport{version:u32,final_original:String,current_original:String,current_predecessors:Vec<String>,independent_terminal_original:String,checkpoint_original:String}
// Unique unsigned paired slot. Its supplied original bytes, not either
// companion or decoded body, are the final/current/history digest preimage.
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
struct DeviceCompanionSlot{version:u32,issuer_original:String,anchor_original:String}
fn device_companions(raw:&[u8])->Result<(Vec<u8>,Vec<u8>),Error>{
 if raw.is_empty()||raw.len()>65536{return Err(Error::Bounds)}
 let slot:DeviceCompanionSlot=serde_json::from_slice(raw).map_err(|_|Error::Canonical)?;
 if serde_json::to_vec(&slot).map_err(|_|Error::Canonical)?.as_slice()!=raw{return Err(Error::Canonical)}
 if slot.version!=1{return Err(Error::Binding)}
 let decode=|s:&str|->Result<Vec<u8>,Error>{let b=B64.decode(s).map_err(|_|Error::Canonical)?;if b.is_empty()||b.len()>65536||B64.encode(&b)!=s{return Err(Error::Canonical)}Ok(b)};
 Ok((decode(&slot.issuer_original)?,decode(&slot.anchor_original)?))
}
// Strict private engine-slot adaptation only. Unlike final/current slots,
// engineCommitDigest MUST hash issuer_original(), never this unsigned JSON.
pub(crate)struct EngineCommitCompanions{issuer:Zeroizing<Vec<u8>>,anchor:Zeroizing<Vec<u8>>}
impl EngineCommitCompanions{
 pub(crate)fn parse(raw:&[u8])->Result<Self,Error>{let(issuer,anchor)=device_companions(raw)?;if issuer==anchor{return Err(Error::Binding)}Ok(Self{issuer:Zeroizing::new(issuer),anchor:Zeroizing::new(anchor)})}
 pub(crate)fn issuer_original(&self)->&[u8]{&self.issuer}
 pub(crate)fn anchor_original(&self)->&[u8]{&self.anchor}
 pub(crate)fn encode(issuer:&[u8],anchor:&[u8])->Result<Vec<u8>,Error>{
  if issuer.is_empty()||anchor.is_empty()||issuer.len()>65536||anchor.len()>65536||issuer==anchor{return Err(Error::Bounds)}
  let slot=DeviceCompanionSlot{version:1,issuer_original:B64.encode(issuer),anchor_original:B64.encode(anchor)};
  let raw=serde_json::to_vec(&slot).map_err(|_|Error::Canonical)?;
  Self::parse(&raw)?;Ok(raw) // retains the existing outer slot's 65536 bound
 }
}
fn same_device_body(issuer:Vec<u8>,anchor:Vec<u8>)->Result<Vec<u8>,Error>{if issuer!=anchor{return Err(Error::Binding)}Ok(issuer)}
// Original PUBLIC records only, not an accepted owner. No session secret enters
// this transport and no signature/floor result can silently promote this type.
pub(crate)struct OriginalDeviceRecords{final_raw:Zeroizing<Vec<u8>>,current_raw:Zeroizing<Vec<u8>>,predecessors:Vec<Zeroizing<Vec<u8>>>,terminal_raw:Zeroizing<Vec<u8>>,checkpoint_raw:Zeroizing<Vec<u8>>,local:PhantomData<Rc<()>>}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields)]
struct DeviceDisplaySignature{classic:String,pq:String}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields)]
struct DeviceDisplayEnvelope{version:u32,role:String,body:String,signature:DeviceDisplaySignature}
#[cfg(test)]mod device_display_data_controls{
 use super::*;
 fn fixture(issuer_account:&str,anchor_account:&str)->OriginalDeviceRecords{
  fn companion(account:&str,role:&str)->Vec<u8>{
   let body=DeviceFinalBody{version:1,purpose:"PUBLIC-UNADMITTED-DATA".into(),account:account.into(),device:"device".into(),root_digest:"not-proof".into(),registration_digest:"not-proof".into(),device_classic:"not-key".into(),device_pq:"not-key".into(),first_device_operation_digest:"not-proof".into(),independent_terminal_digest:"not-proof".into(),checkpoint_digest:"not-proof".into(),sequence:"1".into()};
   serde_json::to_vec(&DeviceDisplayEnvelope{version:1,role:role.into(),body:B64.encode(serde_json::to_vec(&body).unwrap()),signature:DeviceDisplaySignature{classic:"PUBLIC-NOT-SIGNED".into(),pq:"PUBLIC-NOT-SIGNED".into()}}).unwrap()
  }
  let slot=DeviceCompanionSlot{version:1,issuer_original:B64.encode(companion(issuer_account,"issuer")),anchor_original:B64.encode(companion(anchor_account,"anchor"))};
  OriginalDeviceRecords{final_raw:Zeroizing::new(serde_json::to_vec(&slot).unwrap()),current_raw:Zeroizing::new(Vec::new()),predecessors:Vec::new(),terminal_raw:Zeroizing::new(Vec::new()),checkpoint_raw:Zeroizing::new(Vec::new()),local:PhantomData}
 }
 #[test]fn account_display_projection_is_only_data_and_requires_exact_both_bodies(){
  assert_eq!(fixture("public-account","public-account").unadmitted_account_label().unwrap(),"public-account");
  assert!(fixture("one-account","different-account").unadmitted_account_label().is_err());
  // These PUBLIC records have neither signatures/current nor a qualified C
  // owner. Parsing a label deliberately does NOT verify or admit the device.
  assert!(fixture("public-account","public-account").current_raw.is_empty());
 }
 #[test]fn malformed_account_label_cannot_be_published_as_normal_identity(){
  for account in [""," ","a\nbody"]{assert!(fixture(account,account).unadmitted_account_label().is_err());}
  let over="x".repeat(129);assert!(fixture(&over,&over).unadmitted_account_label().is_err());
 }
}
impl OriginalDeviceRecords{
 // PUBLIC matching data only, not signature verification or qualification.
 // Only the actual accepted-device Source may expose this label, after/before
 // its independent C current fences. Never construct a device/grant from it.
 pub(crate)fn unadmitted_account_label(&self)->Result<String,Error>{
  let(issuer,anchor)=device_companions(&self.final_raw)?;
  let body=|wire:&[u8]|->Result<Vec<u8>,Error>{
   let envelope:DeviceDisplayEnvelope=canonical(wire)?;
   if envelope.version!=1{return Err(Error::Binding)}
   let raw=B64.decode(&envelope.body).map_err(|_|Error::Canonical)?;
   if raw.is_empty()||raw.len()>MAX_BODY||B64.encode(&raw)!=envelope.body{return Err(Error::Canonical)}
   Ok(raw)
  };
  let exact=same_device_body(body(&issuer)?,body(&anchor)?)?;
  let final_body:DeviceFinalBody=canonical(&exact)?;
  if final_body.version!=1||!label(&final_body.account,128){return Err(Error::Binding)}
  Ok(final_body.account)
 }
 pub(crate)fn parse(raw:&[u8])->Result<Self,Error>{
  if raw.is_empty()||raw.len()>393216{return Err(Error::Bounds)}
  let t:DeviceRecordsTransport=serde_json::from_slice(raw).map_err(|_|Error::Canonical)?;
  if serde_json::to_vec(&t).map_err(|_|Error::Canonical)?.as_slice()!=raw{return Err(Error::Canonical)}
  if t.version!=1||t.current_predecessors.len()>255{return Err(Error::Bounds)}
  let mut total=0usize;let mut decode=|v:&str|->Result<Zeroizing<Vec<u8>>,Error>{if v.len()>87382{return Err(Error::Bounds)}let b=B64.decode(v).map_err(|_|Error::Canonical)?;if b.is_empty()||b.len()>65536||B64.encode(&b)!=v{return Err(Error::Bounds)}total=total.checked_add(b.len()).ok_or(Error::Bounds)?;if total>393216{return Err(Error::Bounds)}Ok(Zeroizing::new(b))};
  let final_raw=decode(&t.final_original)?;let current_raw=decode(&t.current_original)?;
  let mut predecessors=Vec::new();predecessors.try_reserve_exact(t.current_predecessors.len()).map_err(|_|Error::Bounds)?;for p in &t.current_predecessors{predecessors.push(decode(p)?)}
  let terminal_raw=decode(&t.independent_terminal_original)?;let checkpoint_raw=decode(&t.checkpoint_original)?;
  device_companions(&final_raw)?;device_companions(&current_raw)?;for p in &predecessors{device_companions(p)?;}
  Ok(Self{final_raw,current_raw,predecessors,terminal_raw,checkpoint_raw,local:PhantomData})
 }
}
pub(crate)struct UnadmittedDeviceEvidence<'a>{records:&'a OriginalDeviceRecords,final_body:DeviceFinalBody,current:DeviceCurrentBody,local:PhantomData<Rc<()>>}

// DATA linkage after both original accepted-device signatures have been checked.
// Qualification remains in the SAME actual completed Native final owner.
fn first_device_operation_matches(expected:&str,raw:&[u8])->Result<(),Error>{
 if raw.len()==592{initial_operation_set_v2::shape(raw)?;return if expected==hash(raw){Ok(())}else{Err(Error::Binding)}}
 if raw.len()!=224||&raw[..11]!=b"YNXINITINT1"||raw[11..16].iter().any(|b|*b!=0)||
  raw[16..24].iter().all(|b|*b==0)||raw[24..32].iter().all(|b|*b==0)||
  raw[32..].chunks_exact(32).any(|part|part.iter().all(|b|*b==0))||expected!=hash(raw){return Err(Error::Binding)}
 Ok(())
}
impl UnadmittedDeviceEvidence<'_>{
 pub(crate)fn require_first_device_operation(&self,raw:&[u8])->Result<(),Error>{first_device_operation_matches(&self.final_body.first_device_operation_digest,raw)}
}
#[cfg(test)]mod actual_first_device_operation_data_controls{
 use super::*;
 fn original()->Vec<u8>{let mut raw=vec![1u8;224];raw[..11].copy_from_slice(b"YNXINITINT1");raw[11..16].fill(0);raw[16..24].copy_from_slice(&1u64.to_be_bytes());raw[24..32].copy_from_slice(&1000u64.to_be_bytes());raw}
 #[test]fn exact_existing_operation_bytes_not_reencoded_or_replaced(){let raw=original();let expected=hash(&raw);assert!(first_device_operation_matches(&expected,&raw).is_ok());for at in [0,11,16,32,64,96,128,160,192,223]{let mut changed=raw.clone();changed[at]^=1;assert!(first_device_operation_matches(&expected,&changed).is_err());}}
 #[test]fn old_request_envelopes_empty_reserved_zero_fields_or_truncated_do_not_match(){let raw=original();for wrong in [b"PUBLIC-request".to_vec(),b"{\"engineIssuer\":\"PUBLIC\"}".to_vec(),raw[..223].to_vec(),vec![0;224]]{assert!(first_device_operation_matches(&hash(&wrong),&wrong).is_err());}for part in [16..24,24..32,32..64,192..224]{let mut wrong=raw.clone();wrong[part].fill(0);assert!(first_device_operation_matches(&hash(&wrong),&wrong).is_err());}}
}

impl MessageEvidence<'_>{
 // Called under actual same-worker recovery custody with Native-derived public
 // keys. This proves original mathematical linkage, NOT independent terminal,
 // fresh latest-head/floor, restoration or a persistent message capability.
 pub(crate)fn verify_device_records<'a>(&self,r:&'a OriginalDeviceRecords,independent:&IndependentCommitOriginals<'_>,classic:&[u8],pq:&[u8])->Result<UnadmittedDeviceEvidence<'a>,Error>{
  self.recheck()?;
  let (issuer,anchor)=device_companions(&r.final_raw)?;
  let raw=same_device_body(self.keys.verify(&issuer,DEVICE_FINAL,"accepted-device-final-issuer")?,self.keys.verify(&anchor,DEVICE_FINAL,"accepted-device-final-anchor")?)?;let f:DeviceFinalBody=canonical(&raw)?;
  if f.version!=1||f.purpose!="SOCIAL_ACCEPTED_DEVICE_FINAL_V1"||!label(&f.account,512)||!label(&f.device,512)||[&f.root_digest,&f.registration_digest,&f.first_device_operation_digest,&f.independent_terminal_digest,&f.checkpoint_digest].iter().any(|v|!digest(v))||decoded::<33>(&f.device_classic)?.as_slice()!=classic||classic.first()!=Some(&5)||decoded::<2592>(&f.device_pq)?.as_slice()!=pq||f.independent_terminal_digest!=hash(&r.terminal_raw)||f.checkpoint_digest!=hash(&r.checkpoint_raw){return Err(Error::Binding)}
  self.account.with_message_original(|original|{
   let value:serde_json::Value=serde_json::from_slice(original.current).map_err(|_|crate::account_instance::Error::Canonical)?;
   if value["body"]["account"].as_str()!=Some(f.account.as_str())||value["body"]["device"].as_str()!=Some(f.device.as_str()){return Err(crate::account_instance::Error::Binding)}
   Ok(())
  }).map_err(|_|Error::Binding)?;
  device_sequence(&f.sequence)?;self.verify_independent_commit(r,&f,independent)?;
  let mut previous:Option<(DeviceCurrentBody,&[u8])>=None;
  for original in r.predecessors.iter().map(|b|b.as_slice()).chain(std::iter::once(r.current_raw.as_slice())){
   let (issuer,anchor)=device_companions(original)?;
   let raw=same_device_body(self.keys.verify(&issuer,DEVICE_CURRENT,"accepted-device-current-issuer")?,self.keys.verify(&anchor,DEVICE_CURRENT,"accepted-device-current-anchor")?)?;let n:DeviceCurrentBody=canonical(&raw)?;
   device_sequence(&n.sequence)?;
   if n.version!=1||n.purpose!="SOCIAL_ACCEPTED_DEVICE_CURRENT_V1"||n.final_digest!=hash(&r.final_raw)||!digest(&n.revocation_checkpoint_digest)||!matches!(n.state.as_str(),"active"|"revoked")||n.issued<0||n.expires>MAX_SAFE as i64||n.expires.checked_sub(n.issued).is_none_or(|v|v<=0||v>30000){return Err(Error::Binding)}
   device_current_link(previous.as_ref().map(|(p,raw)|(p,*raw)),&n)?;
   previous=Some((n,original));
  }
  let(current,_)=previous.ok_or(Error::Binding)?;let now=crate::source_evidence::now_ms()?;if current.state!="active"||now<current.issued||now>=current.expires{return Err(Error::Window)}
  self.recheck()?;Ok(UnadmittedDeviceEvidence{records:r,final_body:f,current,local:PhantomData})
 }
}

fn device_current_link(previous:Option<(&DeviceCurrentBody,&[u8])>,next:&DeviceCurrentBody)->Result<(),Error>{
 let seq=device_sequence(&next.sequence)?;
 if let Some((p,raw))=previous{
  if device_sequence(&p.sequence)?.checked_add(1)!=Some(seq)||next.previous_digest.as_deref()!=Some(hash(raw).as_str())||next.issued<p.issued||p.state=="revoked"&&next.state!="revoked"{return Err(Error::Binding)}
 }else if seq!=1||next.previous_digest.is_some()||next.state!="active"{return Err(Error::Binding)}
 Ok(())
}

// Mandatory independently retained originals, borrowed synchronously from the
// final provider. No public carrier selects a Root or inhabits a capability.
pub(crate)struct IndependentCommitOriginals<'a>{
 pub(crate)engine_issuer:&'a[u8],pub(crate)engine_anchor:&'a[u8],
 pub(crate)checkpoint_anchor:&'a[u8],pub(crate)terminal_issuer:&'a[u8],pub(crate)terminal_anchor:&'a[u8],
 pub(crate)checkpoint_predecessors:&'a[&'a[u8]],pub(crate)terminal_issuer_predecessors:&'a[&'a[u8]],pub(crate)terminal_anchor_predecessors:&'a[&'a[u8]],
}
const ENGINE_COMMIT:&[u8]=b"YNX/SOCIAL/FIRST-DEVICE-ENGINE-COMMIT/V1\0";
const ENGINE_CHECKPOINT:&[u8]=b"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-CHECKPOINT/V1\0";
const ENGINE_TERMINAL:&[u8]=b"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-TERMINAL/V1\0";
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
pub(crate)struct EngineCommitBody{
 pub(crate)version:u32,pub(crate)purpose:String,pub(crate)account:String,pub(crate)device:String,
 pub(crate)root_digest:String,pub(crate)registration_digest:String,pub(crate)device_classic:String,
 #[serde(rename="devicePQ")]pub(crate)device_pq:String,
 pub(crate)operation:String,pub(crate)nonce:String,
 #[serde(default,skip_serializing_if="Option::is_none")]pub(crate)source_abi:Option<String>,
 #[serde(default,skip_serializing_if="Option::is_none")]pub(crate)coordinates:Option<[String;11]>,pub(crate)base_revision:String,pub(crate)next_revision:String,
 pub(crate)base_hash:String,pub(crate)next_hash:String,pub(crate)cipher_hash:String,
 pub(crate)journal_digest:String,pub(crate)source_head:String,
 #[serde(default,skip_serializing_if="Option::is_none")]pub(crate)source_sequence:Option<String>,
 #[serde(default,skip_serializing_if="Option::is_none")]pub(crate)initialization:Option<InitializationEngineBinding>,
}
impl EngineCommitBody{
 fn validate_variant(&self)->Result<(),Error>{
  match (&self.source_abi,&self.coordinates,&self.source_sequence,&self.initialization){
   (Some(abi),Some(coordinates),Some(sequence),None)=>{
    MessageBinding{coordinates:coordinates.clone(),source_abi:abi.clone()}.values()?;
    device_sequence(sequence)?;Ok(())
   },
   (None,None,None,Some(initialization))=>initialization.match_body(self),
   _=>Err(Error::Binding),
  }
 }
}
pub(crate)fn verify_engine_commit_originals(source:&crate::source_evidence::FixedStartupSourceEvidence,issuer:&[u8],anchor:&[u8])->Result<EngineCommitBody,Error>{
 let raw=source.verify_commit_original(issuer,ENGINE_COMMIT,"first-device-engine-commit-issuer")?;
 if source.verify_commit_original(anchor,ENGINE_COMMIT,"first-device-engine-commit-anchor")?!=raw{return Err(Error::Binding)}
 let body:EngineCommitBody=canonical(&raw)?;body.validate_variant()?;Ok(body)
}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
pub(crate)struct EngineCheckpointBody{pub(crate)version:u32,pub(crate)purpose:String,pub(crate)engine_commit_digest:String,pub(crate)administration_domain:String,pub(crate)enrollment_digest:String,pub(crate)counter_name:String,pub(crate)floor:String,pub(crate)sequence:String,pub(crate)previous_digest:Option<String>,pub(crate)source_head:String,pub(crate)namespace_digest:String,#[serde(rename="issuedMS")]pub(crate)issued:i64,#[serde(rename="expiresMS")]pub(crate)expires:i64}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]
pub(crate)struct EngineTerminalBody{pub(crate)version:u32,pub(crate)purpose:String,pub(crate)engine_commit_digest:String,pub(crate)checkpoint_digest:String,pub(crate)issuer_enrollment_digest:String,pub(crate)anchor_enrollment_digest:String,pub(crate)issuer_current_digest:String,pub(crate)anchor_current_digest:String,pub(crate)operation:String,pub(crate)nonce:String,pub(crate)once_digest:String,pub(crate)protected_output_digest:String,pub(crate)sequence:String,pub(crate)previous_digest:Option<String>,pub(crate)state:String,#[serde(rename="issuedMS")]pub(crate)issued:i64,#[serde(rename="expiresMS")]pub(crate)expires:i64}
// Only the actual same-policy owner chooses these independently retained
// originals. This borrowed comparison input is never an authority constructor.
pub(crate)struct CommitCurrentOriginals<'a>{pub(crate)issuer_current:&'a[u8],pub(crate)anchor_current:&'a[u8],pub(crate)namespace:&'a[u8]}
fn match_commit_current_originals(checkpoint:&EngineCheckpointBody,terminal:Option<&EngineTerminalBody>,originals:&CommitCurrentOriginals<'_>)->Result<(),Error>{
 if [originals.issuer_current,originals.anchor_current,originals.namespace].iter().any(|raw|raw.is_empty()||raw.len()>1048576){return Err(Error::Bounds)}
 if checkpoint.namespace_digest!=hash(originals.namespace){return Err(Error::Binding)}
 if let Some(terminal)=terminal{if terminal.issuer_current_digest!=hash(originals.issuer_current)||terminal.anchor_current_digest!=hash(originals.anchor_current){return Err(Error::Binding)}}
 Ok(())
}
pub(crate)fn verify_commit_current_originals(source:&crate::source_evidence::FixedStartupSourceEvidence,checkpoint_raw:&[u8],terminal_originals:Option<(&[u8],&[u8])>,originals:&CommitCurrentOriginals<'_>)->Result<(),Error>{
 let untrusted=source.verify_commit_original(checkpoint_raw,ENGINE_CHECKPOINT,"first-device-independent-checkpoint-anchor")?;
 let variant:serde_json::Value=serde_json::from_slice(&untrusted).map_err(|_|Error::Canonical)?;
 if variant.get("version").and_then(|v|v.as_u64())==Some(2){return ordinary_commit_v2::verify_current(source,checkpoint_raw,terminal_originals,originals)}
 // Independent decoding and verification, not a comparison with the producer's
 // in-memory body. This gate runs on the complete actual signed snapshot used
 // by C retirement; partial/failed signature capture does not grant anything.
 let checkpoint:EngineCheckpointBody=canonical(&source.verify_commit_original(checkpoint_raw,ENGINE_CHECKPOINT,"first-device-independent-checkpoint-anchor")?)?;
 if checkpoint.version!=1||checkpoint.purpose!="SOCIAL_FIRST_DEVICE_INDEPENDENT_CHECKPOINT_V1"{return Err(Error::Binding)}
 historical_observation_window(checkpoint.issued,checkpoint.expires)?;
 let terminal=match terminal_originals{
  None=>None,
  Some((issuer,anchor))=>{
   let raw=source.verify_commit_original(issuer,ENGINE_TERMINAL,"first-device-independent-terminal-issuer")?;
   if source.verify_commit_original(anchor,ENGINE_TERMINAL,"first-device-independent-terminal-anchor")?!=raw{return Err(Error::Binding)}
   let terminal:EngineTerminalBody=canonical(&raw)?;
   if terminal.version!=1||terminal.purpose!="SOCIAL_FIRST_DEVICE_INDEPENDENT_TERMINAL_V1"||terminal.state!="committed"||terminal.checkpoint_digest!=hash(checkpoint_raw){return Err(Error::Binding)}
   historical_observation_window(terminal.issued,terminal.expires)?;Some(terminal)
  },
 };
 match_commit_current_originals(&checkpoint,terminal.as_ref(),originals)
}
fn original_history_link(seq:&str,prev:&Option<String>,prior:Option<(&str,&[u8])>)->Result<(),Error>{
 let n=device_sequence(seq)?;
 match prior{None=>if n!=1||prev.is_some(){return Err(Error::Binding)},Some((s,raw))=>if device_sequence(s)?.checked_add(1)!=Some(n)||prev.as_deref()!=Some(hash(raw).as_str()){return Err(Error::Binding)}}Ok(())
}
fn historical_observation_window(issued:i64,expires:i64)->Result<(),Error>{
 // Historical terminal is never reissued to renew device/session lifetime.
 if issued<=0||expires>MAX_SAFE as i64||expires.checked_sub(issued).is_none_or(|n|n<=0||n>30000){return Err(Error::Window)}Ok(())
}

#[cfg(test)]mod commit_current_original_controls{
 use super::*;
 fn bodies()->(EngineCheckpointBody,EngineTerminalBody){
  let checkpoint=EngineCheckpointBody{version:1,purpose:"SOCIAL_FIRST_DEVICE_INDEPENDENT_CHECKPOINT_V1".into(),engine_commit_digest:"1".repeat(64),administration_domain:"PUBLIC-ANCHOR".into(),enrollment_digest:"2".repeat(64),counter_name:B64.encode([3;34]),floor:"1".into(),sequence:"1".into(),previous_digest:None,source_head:"4".repeat(64),namespace_digest:hash(b"PUBLIC-NAMESPACE-ORIGINAL"),issued:100,expires:200};
  let terminal=EngineTerminalBody{version:1,purpose:"SOCIAL_FIRST_DEVICE_INDEPENDENT_TERMINAL_V1".into(),engine_commit_digest:"1".repeat(64),checkpoint_digest:"5".repeat(64),issuer_enrollment_digest:"6".repeat(64),anchor_enrollment_digest:"2".repeat(64),issuer_current_digest:hash(b"PUBLIC-ISSUER-CURRENT"),anchor_current_digest:hash(b"PUBLIC-ANCHOR-CURRENT"),operation:"PUBLIC-OPERATION".into(),nonce:B64.encode([7;32]),once_digest:"8".repeat(64),protected_output_digest:"9".repeat(64),sequence:"1".into(),previous_digest:None,state:"committed".into(),issued:100,expires:200};(checkpoint,terminal)
 }
 fn originals()->CommitCurrentOriginals<'static>{CommitCurrentOriginals{issuer_current:b"PUBLIC-ISSUER-CURRENT",anchor_current:b"PUBLIC-ANCHOR-CURRENT",namespace:b"PUBLIC-NAMESPACE-ORIGINAL"}}
 #[test]fn engine_binding_originals_accept_only_the_exact_separately_retained_raw_bytes(){let(c,t)=bodies();assert_eq!(match_commit_current_originals(&c,Some(&t),&originals()),Ok(()));}
 #[test]fn engine_binding_originals_reject_changed_issuer_anchor_and_namespace_not_just_bad_hex(){
  let(c,t)=bodies();
  for index in 0..3{let mut raw=originals();match index{0=>raw.issuer_current=b"ANOTHER-VALID-LOOKING-ISSUER",1=>raw.anchor_current=b"ANOTHER-VALID-LOOKING-ANCHOR",_=>raw.namespace=b"ANOTHER-NAMESPACE"}assert_eq!(match_commit_current_originals(&c,Some(&t),&raw),Err(Error::Binding));}
  let mut reversed=originals();std::mem::swap(&mut reversed.issuer_current,&mut reversed.anchor_current);assert_eq!(match_commit_current_originals(&c,Some(&t),&reversed),Err(Error::Binding));
 }
 #[test]fn engine_binding_originals_hash_raw_bytes_not_reencoded_json_or_caller_digest(){
  let(mut c,mut t)=bodies();let raw=CommitCurrentOriginals{issuer_current:br#"{ "version":1 }"#,anchor_current:br#"{"version":2}"#,namespace:b"PUBLIC-NAMESPACE-ORIGINAL"};
  t.issuer_current_digest=hash(br#"{"version":1}"#);t.anchor_current_digest=hash(raw.anchor_current);
  assert_eq!(match_commit_current_originals(&c,Some(&t),&raw),Err(Error::Binding));
  t.issuer_current_digest=hash(raw.issuer_current);assert_eq!(match_commit_current_originals(&c,Some(&t),&raw),Ok(()));
  c.namespace_digest=hash(b"PUBLIC-NAMESPACE-ORIGINAL\0");assert_eq!(match_commit_current_originals(&c,Some(&t),&raw),Err(Error::Binding));
 }
 #[test]fn engine_binding_originals_refuse_missing_current_even_when_no_terminal_is_requested(){let(c,_)=bodies();let mut raw=originals();raw.anchor_current=&[];assert_eq!(match_commit_current_originals(&c,None,&raw),Err(Error::Bounds));}
}
fn match_device_terminal_originals(records:&OriginalDeviceRecords,original:&IndependentCommitOriginals<'_>)->Result<(),Error>{
 let(issuer,anchor)=device_companions(&records.terminal_raw)?;
 if original.terminal_issuer!=issuer.as_slice()||original.terminal_anchor!=anchor.as_slice()||original.checkpoint_anchor!=records.checkpoint_raw.as_slice(){return Err(Error::Binding)}
 Ok(())
}
#[cfg(test)]mod device_terminal_original_controls{
 use super::*;
 #[test]fn exact_companion_preserves_role_order_and_requires_both_originals(){
  let issuer=b"PUBLIC-TERMINAL-ISSUER";let anchor=b"PUBLIC-TERMINAL-ANCHOR";let cp=b"PUBLIC-CHECKPOINT";
  let terminal=EngineCommitCompanions::encode(issuer,anchor).unwrap();
  let mut records=OriginalDeviceRecords{final_raw:Zeroizing::new(vec![]),current_raw:Zeroizing::new(vec![]),predecessors:vec![],terminal_raw:Zeroizing::new(terminal),checkpoint_raw:Zeroizing::new(cp.to_vec()),local:PhantomData};
  let mut original=IndependentCommitOriginals{engine_issuer:b"e1",engine_anchor:b"e2",checkpoint_anchor:cp,terminal_issuer:issuer,terminal_anchor:anchor,checkpoint_predecessors:&[],terminal_issuer_predecessors:&[],terminal_anchor_predecessors:&[]};
  assert!(match_device_terminal_originals(&records,&original).is_ok());
  original.terminal_issuer=anchor;original.terminal_anchor=issuer;assert!(match_device_terminal_originals(&records,&original).is_err());
  original.terminal_issuer=issuer;original.terminal_anchor=b"";assert!(match_device_terminal_originals(&records,&original).is_err());
  original.terminal_anchor=anchor;original.checkpoint_anchor=b"other";assert!(match_device_terminal_originals(&records,&original).is_err());
  original.checkpoint_anchor=cp;records.terminal_raw=Zeroizing::new(b"PUBLIC-TERMINAL-ISSUER".to_vec());assert!(match_device_terminal_originals(&records,&original).is_err());
  // This test supplies no signatures; verify_commit_chain still verifies both.
 }
}
impl MessageEvidence<'_>{
 fn verify_independent_commit(&self,records:&OriginalDeviceRecords,f:&DeviceFinalBody,original:&IndependentCommitOriginals<'_>)->Result<(),Error>{
  self.recheck()?;
  let histories=[original.checkpoint_predecessors,original.terminal_issuer_predecessors,original.terminal_anchor_predecessors];
  if histories.iter().any(|h|h.len()>255)||original.terminal_issuer_predecessors.len()!=original.terminal_anchor_predecessors.len(){return Err(Error::Bounds)}
  // terminal/checkpoint are exact aliases below, counted only once.
  let mut total=records.final_raw.len()+records.current_raw.len();
  for raw in records.predecessors.iter().map(|b|b.as_slice()).chain([original.engine_issuer,original.engine_anchor,original.checkpoint_anchor,original.terminal_issuer,original.terminal_anchor]).chain(histories.iter().flat_map(|h|h.iter().copied())){
   if raw.is_empty()||raw.len()>65536{return Err(Error::Bounds)}total=total.checked_add(raw.len()).ok_or(Error::Bounds)?;if total>393216{return Err(Error::Bounds)}
  }
  // The DEVICE final hashes the complete two-role terminal companion. Match
  // each of its exact original envelopes to the independently held engine
  // originals before the existing chain verifier checks both signatures.
  match_device_terminal_originals(records,original)?;
  let e=verify_commit_chain(CommitOriginalVerifier::Account(&self.keys),original)?;
  if e.account!=f.account||e.device!=f.device||e.root_digest!=f.root_digest||e.registration_digest!=f.registration_digest||e.device_classic!=f.device_classic||e.device_pq!=f.device_pq{return Err(Error::Binding)}
  self.account.with_message_original(|o|{if e.operation!=o.operation||decoded::<32>(&e.nonce).map_err(|_|crate::account_instance::Error::Binding)?!=*o.nonce{return Err(crate::account_instance::Error::Binding)}Ok(())}).map_err(|_|Error::Binding)?;
  // Still UNADMITTED: actual provider checks origin/journal, fresh floor/head,
  // enrolled administration, once/output and custody under its retained fence.
  self.recheck()
 }
}

// Two explicit private borrowed verification contexts; no callback/factory
// can inject keys or create an owning final. Initial account and fixed server
// startup share exact original chain validation, never account lifetime.
enum CommitOriginalVerifier<'a,'b>{Account(&'a MessageSourceKeys<'b>),Startup(&'a crate::source_evidence::FixedStartupSourceEvidence)}
impl CommitOriginalVerifier<'_,'_>{fn verify(&self,raw:&[u8],domain:&[u8],role:&str)->Result<Vec<u8>,Error>{match self{Self::Account(keys)=>keys.verify(raw,domain,role),Self::Startup(source)=>source.verify_commit_original(raw,domain,role)}}}
fn verify_commit_chain(signatures:CommitOriginalVerifier<'_,'_>,original:&IndependentCommitOriginals<'_>)->Result<EngineCommitBody,Error>{
 let histories=[original.checkpoint_predecessors,original.terminal_issuer_predecessors,original.terminal_anchor_predecessors];
 if histories.iter().any(|h|h.len()>255)||original.terminal_issuer_predecessors.len()!=original.terminal_anchor_predecessors.len(){return Err(Error::Bounds)}
 let mut total=0usize;for raw in [original.engine_issuer,original.engine_anchor,original.checkpoint_anchor,original.terminal_issuer,original.terminal_anchor].into_iter().chain(histories.iter().flat_map(|h|h.iter().copied())){if raw.is_empty()||raw.len()>65536{return Err(Error::Bounds)}total=total.checked_add(raw.len()).ok_or(Error::Bounds)?;if total>393216{return Err(Error::Bounds)}}
  let e_raw=signatures.verify(original.engine_issuer,ENGINE_COMMIT,"first-device-engine-commit-issuer")?;
  if signatures.verify(original.engine_anchor,ENGINE_COMMIT,"first-device-engine-commit-anchor")?!=e_raw{return Err(Error::Binding)}
  let e:EngineCommitBody=canonical(&e_raw)?;
  e.validate_variant()?;
  let revision=|s:&str|->Result<i64,Error>{let n=s.parse::<i64>().map_err(|_|Error::Bounds)?;if n<0||n.to_string()!=s{return Err(Error::Canonical)}Ok(n)};
  if e.version!=1||e.purpose!="SOCIAL_FIRST_DEVICE_ENGINE_COMMIT_V1"||!label(&e.account,256)||!label(&e.device,256)||[&e.root_digest,&e.registration_digest,&e.base_hash,&e.next_hash,&e.cipher_hash,&e.journal_digest,&e.source_head].iter().any(|v|!digest(v))||!label(&e.operation,128)||decoded::<32>(&e.nonce)?.iter().all(|v|*v==0)||revision(&e.base_revision)?.checked_add(1)!=Some(revision(&e.next_revision)?){return Err(Error::Binding)}
  let classic=decoded::<33>(&e.device_classic)?;if classic[0]!=5{return Err(Error::Binding)}decoded::<2592>(&e.device_pq)?;
  if e.initialization.as_ref().is_some_and(|i|i.version==2){ordinary_commit_v2::verify_chain(&signatures,original,&e)?;return Ok(e)}
  let engine_digest=hash(original.engine_issuer);let mut cp_prior:Option<(EngineCheckpointBody,&[u8])>=None;
  for raw in original.checkpoint_predecessors.iter().copied().chain(std::iter::once(original.checkpoint_anchor)){
   let decoded=signatures.verify(raw,ENGINE_CHECKPOINT,"first-device-independent-checkpoint-anchor")?;let c:EngineCheckpointBody=canonical(&decoded)?;
   let floor=c.floor.parse::<u64>().map_err(|_|Error::Bounds)?;if floor.to_string()!=c.floor{return Err(Error::Canonical)}
   let name=B64.decode(&c.counter_name).map_err(|_|Error::Bounds)?;
   if c.version!=1||c.purpose!="SOCIAL_FIRST_DEVICE_INDEPENDENT_CHECKPOINT_V1"||!digest(&c.engine_commit_digest)||!label(&c.administration_domain,128)||!digest(&c.enrollment_digest)||name.is_empty()||name.len()>66||B64.encode(&name)!=c.counter_name||!digest(&c.source_head)||!digest(&c.namespace_digest){return Err(Error::Binding)}
   if raw==original.checkpoint_anchor&&(c.engine_commit_digest!=engine_digest||c.source_head!=e.source_head){return Err(Error::Binding)}
   historical_observation_window(c.issued,c.expires)?;original_history_link(&c.sequence,&c.previous_digest,cp_prior.as_ref().map(|(p,r)|(p.sequence.as_str(),*r)))?;
   if cp_prior.as_ref().is_some_and(|(p,_)|c.issued<p.issued||c.floor.parse::<u64>().ok()<p.floor.parse::<u64>().ok()||c.administration_domain!=p.administration_domain||c.enrollment_digest!=p.enrollment_digest||c.counter_name!=p.counter_name){return Err(Error::Binding)}cp_prior=Some((c,raw));
  }
  let cp=cp_prior.ok_or(Error::Binding)?.0;let mut t_prior:Option<(EngineTerminalBody,&[u8])>=None;
  for (issuer,anchor) in original.terminal_issuer_predecessors.iter().copied().zip(original.terminal_anchor_predecessors.iter().copied()).chain(std::iter::once((original.terminal_issuer,original.terminal_anchor))){
   let raw=signatures.verify(issuer,ENGINE_TERMINAL,"first-device-independent-terminal-issuer")?;if signatures.verify(anchor,ENGINE_TERMINAL,"first-device-independent-terminal-anchor")?!=raw{return Err(Error::Binding)}let t:EngineTerminalBody=canonical(&raw)?;
   if t.version!=1||t.purpose!="SOCIAL_FIRST_DEVICE_INDEPENDENT_TERMINAL_V1"||!digest(&t.engine_commit_digest)||!digest(&t.checkpoint_digest)||!label(&t.operation,128)||decoded::<32>(&t.nonce)?.iter().all(|n|*n==0)||t.state!="committed"||t.issuer_enrollment_digest==t.anchor_enrollment_digest||[&t.issuer_enrollment_digest,&t.anchor_enrollment_digest,&t.issuer_current_digest,&t.anchor_current_digest,&t.once_digest,&t.protected_output_digest].iter().any(|v|!digest(v)){return Err(Error::Binding)}
   if issuer==original.terminal_issuer&&(t.engine_commit_digest!=engine_digest||t.checkpoint_digest!=hash(original.checkpoint_anchor)||t.operation!=e.operation||t.nonce!=e.nonce||t.anchor_enrollment_digest!=cp.enrollment_digest){return Err(Error::Binding)}
   historical_observation_window(t.issued,t.expires)?;original_history_link(&t.sequence,&t.previous_digest,t_prior.as_ref().map(|(p,r)|(p.sequence.as_str(),*r)))?;
   if t_prior.as_ref().is_some_and(|(p,_)|t.issued<p.issued){return Err(Error::Binding)}t_prior=Some((t,issuer));
  }
  t_prior.ok_or(Error::Binding)?;
 Ok(e)
}
pub(crate)fn verify_fixed_commit_originals(source:&crate::source_evidence::FixedStartupSourceEvidence,original:&IndependentCommitOriginals<'_>,expected_nonce:&[u8;32])->Result<(),Error>{
 let engine=verify_commit_chain(CommitOriginalVerifier::Startup(source),original)?;
 if decoded::<32>(&engine.nonce)?!=*expected_nonce{return Err(Error::Binding)}
 // UNADMITTED. Same-intent actual core/journal/finish, fresh independent floor,
 // once/output and live resource guards must still be consumed by the owner.
 Ok(())
}

// A verified mathematical borrow can retain PUBLIC originals; this never
// constructs a device authority. The actual final root independently checks
// enrollment/current/floor before any persistent owning acquisition succeeds.
impl UnadmittedDeviceEvidence<'_>{
 pub(crate)fn retain_original_records(&self)->Result<OriginalDeviceRecords,Error>{
  fn copy(b:&[u8])->Result<Zeroizing<Vec<u8>>,Error>{let mut v=Zeroizing::new(Vec::new());v.try_reserve_exact(b.len()).map_err(|_|Error::Bounds)?;v.extend_from_slice(b);Ok(v)}
  let r=self.records;let mut p=Vec::new();p.try_reserve_exact(r.predecessors.len()).map_err(|_|Error::Bounds)?;
  for b in &r.predecessors{p.push(copy(b)?)}
  Ok(OriginalDeviceRecords{final_raw:copy(&r.final_raw)?,current_raw:copy(&r.current_raw)?,predecessors:p,terminal_raw:copy(&r.terminal_raw)?,checkpoint_raw:copy(&r.checkpoint_raw)?,local:PhantomData})
 }
}
impl OriginalDeviceRecords{
 pub(crate)fn with_original_parts<R>(&self,f:impl FnOnce(&[u8],&[u8],&[u8],&[u8],&[Zeroizing<Vec<u8>>])->R)->R{f(&self.final_raw,&self.current_raw,&self.terminal_raw,&self.checkpoint_raw,&self.predecessors)}
}

// PUBLIC observation only. Caller must hold and recheck a genuine device owner;
// this projection is never a message-purpose/session capability.
#[derive(Serialize)]#[serde(rename_all="camelCase")]
pub(crate)struct AcceptedDeviceProjection{version:u32,kind:&'static str,account:String,device:String,root_digest:String,registration_digest:String,final_digest:String,current_digest:String,current_sequence:String,revocation_checkpoint_digest:String,#[serde(rename="observedIssuedMS")]issued:i64,#[serde(rename="observedExpiresMS")]expires:i64}
impl OriginalDeviceRecords{
 pub(crate)fn public_projection(&self)->Result<AcceptedDeviceProjection,Error>{
  fn body<T:Serialize+for<'d>Deserialize<'d>>(raw:&[u8],issuer_role:&str,anchor_role:&str)->Result<T,Error>{
   let (issuer,anchor)=device_companions(raw)?;
   let raw=same_device_body(crate::source_evidence::observe_device_original_body(&issuer,issuer_role)?,crate::source_evidence::observe_device_original_body(&anchor,anchor_role)?)?;canonical(&raw)
  }
  let f:DeviceFinalBody=body(&self.final_raw,"accepted-device-final-issuer","accepted-device-final-anchor")?;
  let c:DeviceCurrentBody=body(&self.current_raw,"accepted-device-current-issuer","accepted-device-current-anchor")?;
  if f.version!=1||f.purpose!="SOCIAL_ACCEPTED_DEVICE_FINAL_V1"||!label(&f.account,512)||!label(&f.device,512)||!digest(&f.root_digest)||!digest(&f.registration_digest)||c.version!=1||c.purpose!="SOCIAL_ACCEPTED_DEVICE_CURRENT_V1"||c.final_digest!=hash(&self.final_raw)||c.state!="active"||!digest(&c.revocation_checkpoint_digest)||c.expires<=c.issued{return Err(Error::Binding)}
  device_sequence(&f.sequence)?;device_sequence(&c.sequence)?;
  Ok(AcceptedDeviceProjection{version:1,kind:"accepted-device-observation",account:f.account,device:f.device,root_digest:f.root_digest,registration_digest:f.registration_digest,final_digest:c.final_digest,current_digest:hash(&self.current_raw),current_sequence:c.sequence,revocation_checkpoint_digest:c.revocation_checkpoint_digest,issued:c.issued,expires:c.expires})
 }
}

impl OriginalDeviceRecords{
 pub(crate)fn canonical_transport(final_raw:&[u8],current_raw:&[u8],predecessors:&[&[u8]],terminal_raw:&[u8],checkpoint_raw:&[u8])->Result<Vec<u8>,Error>{
  if predecessors.len()>255{return Err(Error::Bounds)}let transport=DeviceRecordsTransport{version:1,final_original:B64.encode(final_raw),current_original:B64.encode(current_raw),current_predecessors:predecessors.iter().map(|p|B64.encode(p)).collect(),independent_terminal_original:B64.encode(terminal_raw),checkpoint_original:B64.encode(checkpoint_raw)};let raw=serde_json::to_vec(&transport).map_err(|_|Error::Canonical)?;Self::parse(&raw)?;Ok(raw)
 }
}

impl OriginalDeviceRecords{
 // Original matching facts only. Caller MUST surround this borrow with the
 // actual accepted device owner's current and C original validation.
 pub(crate) fn with_native_core_binding<R>(&self,f:impl FnOnce(&[u8;32],&[u8;32],&[u8;33],&[u8;2592])->R)->Result<R,Error>{
  let(issuer,anchor)=device_companions(&self.final_raw)?;
  let raw=same_device_body(crate::source_evidence::observe_device_original_body(&issuer,"accepted-device-final-issuer")?,crate::source_evidence::observe_device_original_body(&anchor,"accepted-device-final-anchor")?)?;
  let b:DeviceFinalBody=canonical(&raw)?;
  if b.version!=1||b.purpose!="SOCIAL_ACCEPTED_DEVICE_FINAL_V1"||!label(&b.account,512)||!label(&b.device,512){return Err(Error::Binding)}
  fn bytes(s:&str)->Result<[u8;32],Error>{if !digest(s){return Err(Error::Binding)}let mut out=[0;32];for(i,v)in out.iter_mut().enumerate(){*v=u8::from_str_radix(&s[i*2..i*2+2],16).map_err(|_|Error::Canonical)?;}Ok(out)}
  let root=bytes(&b.root_digest)?;let registration=bytes(&b.registration_digest)?;
  let classic=decoded::<33>(&b.device_classic)?;let pq=decoded::<2592>(&b.device_pq)?;if classic[0]!=5{return Err(Error::Binding)}
  Ok(f(&root,&registration,&classic,&pq))
 }
}

#[path="message_purpose_owner.rs"]mod message_purpose_owner;
pub(crate)use message_purpose_owner::RootMessagePurposeBorrow;

#[path="message_evidence/contact_request_metadata.rs"]mod contact_request_metadata;
#[path="message_evidence/device_revocation_metadata.rs"]mod device_revocation_metadata;

#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="source-server-collector"))]
#[path="message_evidence/contact_independent_transport.rs"]mod contact_independent_transport;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="source-server-collector"))]
pub(crate)use contact_independent_transport::ContactIndependentTransport;


impl MessageEvidence<'_>{
 pub(crate)fn require_completed_public(&self,verified:&UnadmittedDeviceEvidence<'_>,raw:&[u8],operation:&[u8])->Result<(),Error>{
  self.recheck()?;verified.require_first_device_operation(operation)?;
  native_completed_public::verify_for_account_device_final(&self.keys,raw,&verified.final_body,operation,&verified.records.terminal_raw,&verified.records.checkpoint_raw)?;
  self.recheck()
 }
}

#[path="ordinary_message_engine_semantics.rs"]mod original_message_engine_semantics;
#[path="ordinary_message_operation_body.rs"]mod original_message_operation_body;
pub(crate)use original_message_operation_body::{OperationBodyOriginals,validate_ordinary_message_candidate_frame};

#[path="message_evidence/f06_device_records_math.rs"]mod f06_device_records_math;
pub(crate)use f06_device_records_math::verify_f06_registered_device;

#[path="message_evidence/directory_read_device_math.rs"]mod directory_read_device_math;
pub(crate)use directory_read_device_math::verify_directory_read_actor;

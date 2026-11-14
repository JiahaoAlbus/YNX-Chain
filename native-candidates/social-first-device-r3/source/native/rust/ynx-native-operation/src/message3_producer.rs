//! Normal same-owner EngineCommit producer. Public originals are not grants.
//! The C coordinator owns durable once bits, current fences and retirement.
use super::*;
use base64::{Engine as _,engine::general_purpose::URL_SAFE_NO_PAD as B64};
use crate::source_evidence::native_core_rights_v2::NativeCoreEnforcingBindingV2 as Binding;
use crate::source_infrastructure::{Message3EngineOriginal,Message3EffectOriginal,SourceError,SourceRole};
use serde::Serialize;
use sha2::{Digest,Sha256};
#[path="message3_successors.rs"]mod successors;
#[path="message3_ordinary.rs"]mod ordinary;
use ordinary::EngineBinding;

#[repr(C)]#[derive(Clone,Copy)]
struct Span{data:*const u8,size:usize}
impl Span{fn of(v:&[u8])->Self{Self{data:if v.is_empty(){std::ptr::null()}else{v.as_ptr()},size:v.len()}}}
#[repr(C)]#[derive(Clone,Copy)]
pub(crate)struct Effect{
 version:u32,kind:u32,storage_generation:u64,policy_generation:u64,deadline:u64,
 intent:[u8;32],effect_digest:[u8;32],effect_original:Span,checkpoint_original:Span,domain_originals:[Span;2],
}
#[repr(C)]
pub(crate)struct Snapshot{
 version:u32,kind:u32,phase:u32,role_count:u32,storage_generation:u64,policy_generation:u64,
 deadline:u64,intent:[u8;32],id:Span,body:Span,frames:[Span;2],classic:[Span;2],pq:[Span;2],receipt:Span,
}
const _:[();160]=[();std::mem::size_of::<Effect>()];
const _:[();216]=[();std::mem::size_of::<Snapshot>()];
unsafe extern "C"{
 fn ynx_native_core_resource_driver_store_reference_v1(resource:*mut c_void,out:*mut u8)->i32;
 fn ynx_native_core_resource_driver_message3_effect_facts(resource:*mut c_void,kind:u32,out:*mut Effect)->i32;
 fn ynx_native_core_resource_driver_message3_enter(resource:*mut c_void,holder:*mut c_void,kind:u32)->i32;
 fn ynx_native_core_resource_driver_message3_key_enter(resource:*mut c_void,holder:*mut c_void,kind:u32,role:u32,pq:u32)->i32;
 fn ynx_native_core_resource_driver_message3_key_leave(resource:*mut c_void,holder:*mut c_void,kind:u32,status:i32)->i32;
 fn ynx_native_core_resource_driver_message3_retire(resource:*mut c_void,holder:*mut c_void,kind:u32,out:*mut u8,capacity:usize,written:*mut usize)->i32;
}
const DOMAIN:&[u8]=b"YNX/SOCIAL/FIRST-DEVICE-ENGINE-COMMIT/V1\0";
const ROLES:[&str;2]=["first-device-engine-commit-issuer","first-device-engine-commit-anchor"];
// Existing veil_checked_store.h status; refusal is not a new attempt failure.
const DUPLICATE:i32=9;
fn hex(raw:&[u8])->String{raw.iter().map(|b|format!("{b:02x}")).collect()}
fn encode<T:Serialize>(v:&T)->Result<Vec<u8>,i32>{
 Ok(serde_json::to_string(v).map_err(|_|BOUND)?.replace('&',"\\u0026")
  .replace('<',"\\u003c").replace('>',"\\u003e").replace('\u{2028}',"\\u2028")
  .replace('\u{2029}',"\\u2029").into_bytes())
}
fn status(code:i32)->Result<(),i32>{if code==OK{Ok(())}else{Err(code)}}
#[derive(Clone)]
struct Context{startup:usize,link:crate::source_infrastructure::ServerCoreLink,classic:[u8;33],pq:Box<[u8;2592]>}

// All callbacks below run OUTSIDE SDK/core inventory borrows. The returned
// locator is the existing verified participant, never a replacement account.
fn context(holder:*mut c_void,policy:*mut c_void)->Result<Context,i32>{
 status(unsafe{ynx_sdk_native_core_rights_current_v2(policy)})?;
 let c=SDK_CUSTODY.with(|s|{
  let s=s.try_borrow().map_err(|_|UNKNOWN)?;let sdk=s.get(&(holder as usize)).ok_or(1)?;
  if sdk.unknown{return Err(UNKNOWN)}
  CORE_LOANS_V2.with(|r|{
   let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(policy as usize)).ok_or(1)?;
   if loan.unknown{return Err(UNKNOWN)}
   if loan.startup!=sdk.startup||loan.purpose!=CorePurposeV2::FirstDeviceCore||loan.children==0||
    SELECTED_STARTUP.with(|s|s.get())!=Some(sdk.startup){return Err(MISMATCH)}
   let public=loan.first_public.as_ref().ok_or(1)?;
   let link=public.server_link.as_ref().ok_or(1)?.clone();
   if link.facts.nonce!=public.account_nonce{return Err(MISMATCH)}
   Ok(Context{startup:sdk.startup,link,classic:public.classic,pq:public.pq.clone()})
  })
 })?;
 c.link.current()?;Ok(c)
}
pub(crate)struct EngineAttempt{
 resource:usize,context:Context,binding:EngineBinding,ordinary:Option<ordinary::Original>,engine:Option<Message3EngineOriginal>,
 effect:Vec<u8>,effect_digest:[u8;32],domains:[Vec<u8>;2],body:Vec<u8>,frames:[Vec<u8>;2],
 classic:[Vec<u8>;2],pq:[Vec<u8>;2],originals:[Vec<u8>;2],receipt:Vec<u8>,readback:Vec<u8>,
 phase:u32,first:i32,
 successors:[Option<successors::Attempt>;2],lifecycle_first:i32,device_proofs:BTreeMap<(u32,usize,bool),device_possession::DeviceProofAttempt>,
}
fn with_attempt<T>(holder:*mut c_void,policy:*mut c_void,f:impl FnOnce(&mut EngineAttempt)->Result<T,i32>)->Result<T,i32>{
 SDK_CUSTODY.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let sdk=r.get_mut(&(holder as usize)).ok_or(1)?;
  f(sdk.engine_attempts.get_mut(&(policy as usize)).ok_or(1)?)})
}
fn fail(holder:*mut c_void,policy:*mut c_void,cause:i32)->i32{
 let _=with_attempt(holder,policy,|a|{if a.first==OK{a.first=if cause==OK{UNKNOWN}else{cause}}a.phase=4;Ok(())});
 if cause==OK{UNKNOWN}else{cause}
}
fn effect_matches(a:&EngineAttempt,e:&Effect,kind:u32)->Result<(),i32>{
 a.binding.strong()?;
 if e.version!=1||e.kind!=kind||e.storage_generation!=a.binding.storage_generation()||
  e.policy_generation!=a.binding.policy_generation()||e.deadline!=a.binding.deadline()||
  e.intent!=a.binding.intent()||e.effect_digest!=a.effect_digest{return Err(MISMATCH)}
 for(span,expected)in [(e.effect_original,a.effect.as_slice()),(e.domain_originals[0],a.domains[0].as_slice()),(e.domain_originals[1],a.domains[1].as_slice())]{
  if span.size!=expected.len()||span.size==0||region(span.data,span.size).is_none(){return Err(BOUND)}
  if unsafe{std::slice::from_raw_parts(span.data,span.size)}!=expected{return Err(MISMATCH)}
 }Ok(())
}
fn spans(a:&EngineAttempt)->Snapshot{
 Snapshot{version:1,kind:1,phase:a.phase,role_count:2,storage_generation:a.binding.storage_generation(),
  policy_generation:a.binding.policy_generation(),deadline:a.binding.deadline(),intent:a.binding.intent(),
  id:Span::of(a.context.link.facts.operation.as_bytes()),body:Span::of(&a.body),
  frames:std::array::from_fn(|i|Span::of(&a.frames[i])),classic:std::array::from_fn(|i|Span::of(&a.classic[i])),
  pq:std::array::from_fn(|i|Span::of(&a.pq[i])),receipt:Span::of(&a.receipt)}
}
// Pure same-inventory fence for the final caller of a Source copy. No getter,
// signer, policy/current callback, state mutation, or input/output byte write.
pub(super)fn protect_original_output(a:&EngineAttempt,output:(usize,usize))->Result<(),i32>{
 let mut originals=vec![a.body.as_slice(),a.effect.as_slice(),a.receipt.as_slice(),a.readback.as_slice()];
 for values in [&a.domains,&a.frames,&a.classic,&a.pq,&a.originals]{for raw in values{originals.push(raw.as_slice())}}
 if let Some(e)=&a.engine{originals.extend([e.typed.as_slice(),e.journal.as_slice(),e.source_frame.as_slice()]);}
 if let Some(original)=&a.ordinary{ordinary::protect_original_output(original,output)?;}
 for raw in originals{if !raw.is_empty()&&!disjoint(output,region(raw.as_ptr(),raw.len()).ok_or(BOUND)?){return Err(BOUND)}}successors::protect_retained_output(a,output)
}
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_message3_snapshot_v1(holder:*mut c_void,policy:*mut c_void,effect:*const Effect,out:*mut Snapshot)->i32{
 if effect.is_null()||out.is_null()||(effect as usize)%std::mem::align_of::<Effect>()!=0||
  (out as usize)%std::mem::align_of::<Snapshot>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<Snapshot>())else{return BOUND};
 let Some(e)=region(effect.cast(),std::mem::size_of::<Effect>())else{return BOUND};
 if !disjoint(o,e){return BOUND}
 let facts=unsafe{*effect};
 for s in [facts.effect_original,facts.checkpoint_original,facts.domain_originals[0],facts.domain_originals[1]]{
  if s.size!=0{let Some(r)=region(s.data,s.size)else{return BOUND};if !disjoint(o,r){return BOUND}}
 }
 let result=catch_unwind(AssertUnwindSafe(||{
  if matches!(facts.kind,2|3){return successors::snapshot(holder,policy,&facts,out,o)}
  // Reject aliases of retained public outputs before touching output memory.
  let observed=with_attempt(holder,policy,|a|{
   let snapshot=spans(a);
   for s in [snapshot.id,snapshot.body,snapshot.frames[0],snapshot.frames[1],snapshot.classic[0],snapshot.classic[1],snapshot.pq[0],snapshot.pq[1],snapshot.receipt]{
    if s.size!=0&&!disjoint(o,region(s.data,s.size).ok_or(BOUND)?){return Err(BOUND)}
   }
   effect_matches(a,&facts,1)?;
   if a.body.is_empty()||a.frames.iter().any(Vec::is_empty){return Err(if a.first!=OK{a.first}else{1})}
   let complete=snapshot.phase>=2;Ok((snapshot,a.first,a.context.clone(),complete))
  });
  // No output for an unrecognized holder or mismatched original. On a known
  // signing failure, preserve the real parts before returning that failure.
  match observed{
   Ok((snapshot,first,original,complete))=>{
    unsafe{std::ptr::write(out,snapshot)};
    let live=context(holder,policy);
    if first!=OK{return Err(first)}
    let live=live?;
    if live.startup!=original.startup||live.link.facts!=original.link.facts||live.classic!=original.classic||live.pq!=original.pq{return Err(MISMATCH)}
    if complete{validate_initialization(holder,policy,true)?;}
    Ok(())
   },
   Err(code)=>{if code!=BOUND{unsafe{std::ptr::write_bytes(out,0,1)}}Err(code)},
  }
 }));
 match result{Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// This guard is not constructible outside this module. Holding a delegated
// pair alone cannot call a signer. Drop always releases an entered native key
// guard, including a Rust panic, without reporting an uncertain call as OK.
pub(crate)struct KeyGuard{holder:*mut c_void,policy:*mut c_void,resource:*mut c_void,kind:u32,role:usize,pq:bool,frame:Vec<u8>,claimed:bool,finished:bool}
impl KeyGuard{
 pub(crate)fn claim(&mut self,role:SourceRole)->Result<(&[u8],bool),SourceError>{
  let selected=if self.kind==2&&self.role==0{1}else{self.role};
  if self.claimed||self.finished||selected!=match role{SourceRole::Issuer=>0,SourceRole::Anchor=>1}{return Err(SourceError::Pair)}
  self.claimed=true;Ok((&self.frame,self.pq))
 }
 fn finish(mut self,bytes:Vec<u8>,actual:i32)->Result<(),i32>{
  let recorded=with_attempt(self.holder,self.policy,|a|{
   if self.kind!=1{return successors::record_signature(a,self.kind,self.role,self.pq,bytes,actual)}
   let target=if self.pq{&mut a.pq[self.role]}else{&mut a.classic[self.role]};
   if !target.is_empty(){return Err(MISMATCH)}*target=bytes;
   if actual!=OK&&a.first==OK{a.first=actual;a.phase=4;}Ok(())
  });
  let original=recorded.err().unwrap_or(actual);
  let left=unsafe{ynx_native_core_resource_driver_message3_key_leave(self.resource,self.holder,self.kind,original)};
  self.finished=true;
  if original!=OK{return Err(self.fail(original))}
  if left!=OK{return Err(self.fail(left))}Ok(())
 }
 fn fail(&self,cause:i32)->i32{if self.kind==1{fail(self.holder,self.policy,cause)}else{successors::fail(self.holder,self.policy,self.kind,cause)}}
}
impl Drop for KeyGuard{fn drop(&mut self){if !self.finished{
 self.fail(UNKNOWN);
 unsafe{ynx_native_core_resource_driver_message3_key_leave(self.resource,self.holder,self.kind,UNKNOWN);}
 self.finished=true;
}}}
#[derive(Serialize)]struct Signature{classic:String,pq:String}
#[derive(Serialize)]struct Envelope<'a>{version:u32,role:&'a str,body:String,signature:Signature}
#[derive(Serialize)]struct OriginalDescriptor{bytes:usize,sha256:String}
#[derive(Serialize)]#[serde(rename_all="camelCase")]
struct Receipt<'a>{version:u32,id:&'a str,kind:&'a str,body_digest:String,originals:[OriginalDescriptor;2]}
fn finish_public_parts(a:&mut EngineAttempt)->Result<(),i32>{
 for i in 0..2{
  if a.classic[i].len()!=64||a.pq[i].len()!=4627{return Err(MISMATCH)}
  a.originals[i]=encode(&Envelope{version:1,role:ROLES[i],body:B64.encode(&a.body),
   signature:Signature{classic:B64.encode(&a.classic[i]),pq:B64.encode(&a.pq[i])}})?;
 }
 a.receipt=encode(&Receipt{version:1,id:&a.context.link.facts.operation,kind:"engineCommit",
  body_digest:hex(&Sha256::digest(&a.body)),originals:std::array::from_fn(|i|OriginalDescriptor{bytes:a.originals[i].len(),sha256:hex(&Sha256::digest(&a.originals[i]))})})?;
 a.phase=2;Ok(())
}
fn engine_body(a:&EngineAttempt,device:&NativeCoreDeviceBindingV2)->Result<crate::message_evidence::EngineCommitBody,i32>{
 if a.binding.is_ordinary(){return ordinary::body(a,device)}
 let engine=a.engine.as_ref().ok_or(UNKNOWN)?;
 let effect=Message3EffectOriginal::parse(&a.effect,a.binding.strong()?,&a.effect_digest).map_err(custody_status)?;
 engine.match_effect(a.binding.strong()?,&effect).map_err(custody_status)?;
 let initialization=engine.initialization_context().map_err(custody_status)?;
 let (source_abi,coordinates)=if initialization.is_none(){let(abi,coordinates)=engine.source_context().map_err(custody_status)?;
  (Some(hex(&abi)),Some(coordinates.map(|value|value.to_string())))}else{(None,None)};
 let b=engine.typed.as_slice();let integer=|at:usize|u64::from_be_bytes(b[at..at+8].try_into().expect("matched engine layout"));
 let f=&a.context.link.facts;
 if f.operation.is_empty()||f.operation.len()>128||!f.operation.bytes().all(|byte|(32..=126).contains(&byte))||f.nonce.iter().all(|byte|*byte==0){return Err(BOUND)}
 let body=crate::message_evidence::EngineCommitBody{version:1,purpose:"SOCIAL_FIRST_DEVICE_ENGINE_COMMIT_V1".into(),
  account:f.account.clone(),device:f.device.clone(),root_digest:hex(&device.root),registration_digest:hex(&device.registration),
  device_classic:B64.encode(device.classic),device_pq:B64.encode(device.pq),operation:f.operation.clone(),nonce:B64.encode(f.nonce),
  source_abi,coordinates,base_revision:integer(64).to_string(),next_revision:integer(72).to_string(),
  base_hash:hex(&b[80..112]),next_hash:hex(&b[112..144]),cipher_hash:hex(&b[144..176]),journal_digest:hex(&b[176..208]),
  source_head:hex(&b[208..240]),source_sequence:if initialization.is_none(){Some(integer(240).to_string())}else{None},initialization};
 if let Some(initialization)=&body.initialization{initialization.match_body(&body).map_err(|_|MISMATCH)?;}
 Ok(body)
}
fn validate_initialization(holder:*mut c_void,policy:*mut c_void,signed:bool)->Result<(),i32>{
 if with_attempt(holder,policy,|a|Ok(a.binding.is_ordinary()))?{return ordinary::validate(holder,policy,signed)}
 // Never invoke SDK/C/current callbacks while the SDK inventory is borrowed.
 let (resource,initialization,original)=with_attempt(holder,policy,|a|{
  Ok((a.resource,a.engine.as_ref().ok_or(UNKNOWN)?.initialization_context().map_err(custody_status)?,a.context.clone()))
 })?;
 let Some(initialization)=initialization else{return Ok(())};
 let wire=initialization.aad_wire().map_err(|_|MISMATCH)?;
 let aad=super::core_initialization_aad::InitializationAadV1::from_wire(&wire)?;
 super::core_initialization_aad::verify(policy,&aad)?;
 let mut participant:NativeCoreParticipantOriginalsV2=unsafe{std::mem::zeroed()};
 status(unsafe{ynx_sdk_native_core_participant_originals_v2(policy,&mut participant)})?;
 let source=&participant.origin[3];
 if source.size==0||source.size>1048576||region(source.data,source.size).is_none(){return Err(BOUND)}
 let exact_source=unsafe{std::slice::from_raw_parts(source.data,source.size)}.to_vec();
 with_attempt(holder,policy,|a|{if a.engine.as_ref().ok_or(UNKNOWN)?.source_frame.as_slice()!=exact_source{return Err(MISMATCH)}Ok(())})?;
 if !signed{
  // This runs before entering C signing/retirement, not recursively inside
  // its active guard. A16's reference is a fact, not an account permission.
  let mut actual=[0u8;32];status(unsafe{ynx_native_core_resource_driver_store_reference_v1(resource as *mut c_void,actual.as_mut_ptr())})?;
  if hex(&actual)!=initialization.store_reference{return Err(MISMATCH)}
 }else{
  let mut device:NativeCoreDeviceBindingV2=unsafe{std::mem::zeroed()};let mut generation=0;
  status(unsafe{ynx_sdk_native_core_storage_binding_v2(policy,original.classic.as_ptr(),original.pq.as_ptr(),&mut device,&mut generation)})?;
  let (expected,issuer,anchor)=with_attempt(holder,policy,|a|{
   if generation!=a.binding.storage_generation()||device.registration!=a.binding.registration(){return Err(MISMATCH)}
   Ok((encode(&engine_body(a,&device)?)?,a.originals[0].clone(),a.originals[1].clone()))
  })?;
  STARTUP_EVIDENCE.with(|r|{
   let r=r.try_borrow().map_err(|_|UNKNOWN)?;let held=r.get(&original.startup).ok_or(1)?;
   let body=crate::message_evidence::verify_engine_commit_originals(&held.source,&issuer,&anchor).map_err(|_|MISMATCH)?;
   if encode(&body)?!=expected{return Err(MISMATCH)}Ok(())
  })?;
 }
 let live=context(holder,policy)?;
 if live.startup!=original.startup||live.link.facts!=original.link.facts||live.classic!=original.classic||live.pq!=original.pq{return Err(MISMATCH)}
 Ok(())
}
fn prepare(holder:*mut c_void,policy:*mut c_void,resource:*mut c_void,started:&mut bool)->Result<usize,i32>{
 if holder.is_null()||policy.is_null()||resource.is_null(){return Err(BOUND)}
 // Reject a retained attempt before calling any current/authority callback.
 SDK_CUSTODY.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;
  let sdk=r.get(&(holder as usize)).ok_or(1)?;
  if sdk.engine_attempts.contains_key(&(policy as usize)){Err(DUPLICATE)}else{Ok(())}})?;
 let c=context(holder,policy)?;
 let mut profile=0;status(unsafe{ynx_sdk_native_core_storage_profile_v1(policy,&mut profile)})?;
 if profile==1{return ordinary::prepare(holder,policy,resource,c,started)}
 if profile!=2{return Err(MISMATCH)}
 let mut binding:Binding=unsafe{std::mem::zeroed()};
 status(unsafe{ynx_sdk_native_core_enforcing_binding_v2(policy,&mut binding)})?;
 if binding.version!=2||binding.purpose!=1{return Err(MISMATCH)}
 let mut device:NativeCoreDeviceBindingV2=unsafe{std::mem::zeroed()};let mut generation=0;
 status(unsafe{ynx_sdk_native_core_storage_binding_v2(policy,c.classic.as_ptr(),c.pq.as_ptr(),&mut device,&mut generation)})?;
 if generation!=binding.storage_generation||device.registration!=binding.registration{return Err(MISMATCH)}
 let startup=c.startup;
 SDK_CUSTODY.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let sdk=r.get_mut(&(holder as usize)).ok_or(1)?;
  if sdk.engine_attempts.contains_key(&(policy as usize)){return Err(DUPLICATE)}
  if sdk.engine_attempts.len()>=32{return Err(BOUND)}
  sdk.engine_attempts.insert(policy as usize,EngineAttempt{resource:resource as usize,context:c,binding:EngineBinding::Strong(binding),ordinary:None,engine:None,effect:Vec::new(),effect_digest:[0;32],domains:std::array::from_fn(|_|Vec::new()),body:Vec::new(),frames:std::array::from_fn(|_|Vec::new()),classic:std::array::from_fn(|_|Vec::new()),pq:std::array::from_fn(|_|Vec::new()),originals:std::array::from_fn(|_|Vec::new()),receipt:Vec::new(),readback:Vec::new(),phase:0,first:OK,successors:std::array::from_fn(|_|None),lifecycle_first:OK,device_proofs:BTreeMap::new()});
  *started=true;Ok(())})?;
 let mut facts:Effect=unsafe{std::mem::zeroed()};
 status(unsafe{ynx_native_core_resource_driver_message3_effect_facts(resource,1,&mut facts)})?;
 // This is an immediate copy from the original C loan, not a caller DTO.
 let copy=|s:Span,max:usize|->Result<Vec<u8>,i32>{if s.size==0||s.size>max||region(s.data,s.size).is_none(){return Err(BOUND)}Ok(unsafe{std::slice::from_raw_parts(s.data,s.size)}.to_vec())};
 let effect=copy(facts.effect_original,4192)?;
 let domains=[copy(facts.domain_originals[0],4096)?,copy(facts.domain_originals[1],4096)?];
 with_attempt(holder,policy,|a|{a.effect=effect;a.domains=domains;a.effect_digest=facts.effect_digest;effect_matches(a,&facts,1)})?;
 let (engine,read_status)=match unsafe{Message3EngineOriginal::read(resource)}{Ok(e)=>(e,OK),Err((e,partial))=>(partial,custody_status(e))};
 with_attempt(holder,policy,|a|{a.engine=Some(engine);Ok(())})?;status(read_status)?;
 context(holder,policy)?;
 validate_initialization(holder,policy,false)?;
 with_attempt(holder,policy,|a|{
  a.body=encode(&engine_body(a,&device)?)?;
  if a.body.is_empty()||a.body.len()>32768{return Err(BOUND)}
  a.frames=std::array::from_fn(|i|{let mut v=DOMAIN.to_vec();v.push(ROLES[i].len()as u8);v.extend(ROLES[i].as_bytes());v.extend((a.body.len()as u32).to_be_bytes());v.extend(&a.body);v});Ok(())
 })?;
 context(holder,policy)?;Ok(startup)
}
fn run(holder:*mut c_void,policy:*mut c_void,resource:*mut c_void,started:&mut bool)->Result<(),i32>{
 let startup=prepare(holder,policy,resource,started)?;
 status(unsafe{ynx_native_core_resource_driver_message3_enter(resource,holder,1)})?;
 with_attempt(holder,policy,|a|{a.phase=1;Ok(())})?;
 for role in 0..2{for pq in [false,true]{
  context(holder,policy)?;
  let frame=with_attempt(holder,policy,|a|{if a.resource!=resource as usize{return Err(MISMATCH)}Ok(a.frames[role].clone())})?;
  status(unsafe{ynx_native_core_resource_driver_message3_key_enter(resource,holder,1,role as u32,u32::from(pq))})?;
  let mut guard=KeyGuard{holder,policy,resource,kind:1,role,pq,frame,claimed:false,finished:false};
  if with_attempt(holder,policy,|a|Ok(a.binding.is_ordinary()))?{fixed_message_key_owner::sign_selected_ordinary_key(guard,startup,role)?;continue;}
  let signed=STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=r.get_mut(&startup).ok_or(UNKNOWN)?;selected_current(held)?;
   let pair=held.pairs[role].as_mut().ok_or(1)?;
   Ok::<_,i32>(pair.sign_engine_guard(&mut guard))
  });
  let(bytes,actual)=match signed{Ok((bytes,result))=>(bytes,result.err().map(custody_status).unwrap_or(OK)),Err(s)=>(Vec::new(),s)};
  guard.finish(bytes,actual)?;
 }}
 with_attempt(holder,policy,finish_public_parts)?;
 let mut readback=vec![0u8;4096];let mut written=0;
 let code=unsafe{ynx_native_core_resource_driver_message3_retire(resource,holder,1,readback.as_mut_ptr(),readback.len(),&mut written)};
 let bounded=written<=readback.len();if bounded{readback.truncate(written)}
 with_attempt(holder,policy,|a|{a.readback=readback;if !bounded{return Err(UNKNOWN)}if code==OK&&a.readback!=a.receipt{return Err(MISMATCH)}Ok(())})?;
 status(code)?;context(holder,policy)?;
 with_attempt(holder,policy,|a|{a.phase=3;Ok(())})
}
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_engine_commit_run_v1(holder:*mut c_void,policy:*mut c_void,resource:*mut c_void)->i32{
 let mut started=false;
 let result=catch_unwind(AssertUnwindSafe(||run(holder,policy,resource,&mut started))).unwrap_or(Err(UNKNOWN));
 finish_run_status(started,result,|cause|fail(holder,policy,cause))
}
fn finish_run_status(started:bool,result:Result<(),i32>,mark_failure:impl FnOnce(i32)->i32)->i32{
 match result{
  Ok(())=>OK,
  // Only this invocation's newly inserted attempt may be marked failed.
  Err(cause) if !started=>cause,
  Err(cause)=>mark_failure(cause),
 }
}


// Called only inside the participant's scoped completed DATA read. Locate the
// actual EngineAttempt through its original private ServerCoreLink; never use
// caller bytes or a public device DTO to select another attempt. This is an
// additional availability/identity gate, not signature, Source or device
// authorization; the actual producer and verifier still independently gate.
pub(crate)fn same_participant_completed_read_ready()->Result<(usize,usize),i32>{
 let selected=SELECTED_STARTUP.with(|s|s.get()).ok_or(1)?;
 SDK_CUSTODY.with(|inventory|{
  let inventory=inventory.try_borrow().map_err(|_|UNKNOWN)?;let mut matched=None;
  for(holder,sdk)in inventory.iter(){for(policy,attempt)in &sdk.engine_attempts{
   match attempt.context.link.completed_read_snapshot(){Ok(())=>{},Err(1|21)=>continue,Err(e)=>return Err(e)}
   if matched.is_some(){return Err(MISMATCH)}
   if sdk.unknown{return Err(if sdk.first!=OK{sdk.first}else{UNKNOWN})}
   if sdk.startup!=selected||attempt.context.startup!=selected{return Err(MISMATCH)}
   if sdk.message3_pins.get(policy).copied().unwrap_or(0)==0{return Err(1)}
   if attempt.first!=OK{return Err(attempt.first)}if attempt.lifecycle_first!=OK{return Err(attempt.lifecycle_first)}
   if attempt.phase!=3||attempt.resource==0||attempt.body.is_empty()||attempt.receipt.is_empty()||attempt.receipt!=attempt.readback||attempt.originals.iter().any(Vec::is_empty){return Err(1)}
   successors::server_read_ready(attempt.successors[0].as_ref(),2)?;
   successors::server_read_ready(attempt.successors[1].as_ref(),3)?;
   CORE_LOANS_V2.with(|loans|{let loans=loans.try_borrow().map_err(|_|UNKNOWN)?;let loan=loans.get(policy).ok_or(1)?;
    if loan.unknown{return Err(if loan.first!=OK{loan.first}else{UNKNOWN})}
    if loan.startup!=selected||loan.purpose!=CorePurposeV2::FirstDeviceCore||loan.children==0{return Err(MISMATCH)}
    let public=loan.first_public.as_ref().ok_or(1)?;let link=public.server_link.as_ref().ok_or(1)?;
    link.completed_read_snapshot()?;
    #[cfg(feature="source-server-collector")]
    if !link.same_participant(&attempt.context.link){return Err(MISMATCH)}
    if link.facts!=attempt.context.link.facts||public.account_nonce!=link.facts.nonce||public.classic!=attempt.context.classic||public.pq!=attempt.context.pq{return Err(MISMATCH)}
    Ok(())
   })?;
   matched=Some((*holder,*policy));
  }}
  matched.ok_or(1)
 })
}
// Read pin is an extra reference to the SAME existing SDK/core child. It is
// retained in the participant slot across size/copy, including short buffers
// and UNKNOWN, and released before the participant's physical close. It never
// invokes the pre-retirement current or authorizes another effect.
pub(crate)struct ServerEngineReadPin{holder:usize,policy:usize,active:bool}
impl ServerEngineReadPin{
 pub(crate)fn acquire(selected:(usize,usize))->Result<Self,i32>{
  let(holder,policy)=selected;
  SDK_CUSTODY.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let sdk=s.get_mut(&holder).ok_or(1)?;
   if sdk.unknown{return Err(if sdk.first!=OK{sdk.first}else{UNKNOWN})}
   let count=sdk.message3_pins.get(&policy).copied().filter(|n|*n>0).ok_or(1)?;
   let next=count.checked_add(1).ok_or(BOUND)?;
   CORE_LOANS_V2.with(|l|{let mut l=l.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=l.get_mut(&policy).ok_or(1)?;
    if loan.unknown{return Err(if loan.first!=OK{loan.first}else{UNKNOWN})}
    if loan.startup!=sdk.startup||loan.children==0{return Err(MISMATCH)}
    let children=loan.children.checked_add(1).ok_or(BOUND)?;
    sdk.message3_pins.insert(policy,next);loan.children=children;Ok(())
   })
  })?;
  Ok(Self{holder,policy,active:true})
 }
 pub(crate)fn matches(&self,selected:(usize,usize))->bool{self.active&&(self.holder,self.policy)==selected}
 pub(crate)fn close(&mut self)->i32{
  if !self.active{return OK}
  let code=unsafe{ynx_sdk_native_message3_release_v1(self.holder as *mut c_void,self.policy as *mut c_void)};
  if code==OK{self.active=false}code
 }
}
impl Drop for ServerEngineReadPin{fn drop(&mut self){
 // If publication into the participant slot unwinds, release this SAME
 // added lifetime pin through the existing no-current cleanup path. Failure
 // leaves the original SDK/core child pinned; it never authorizes a retry.
 if self.active{let _=self.close();}
}}

// GENUINE normal SDK attempt only. No pointer comes from a public packet, Node
// projection or another process; this exports public data, never a capability.
fn completed_public_packet(a:&EngineAttempt,resource:*mut c_void,operation:&[u8])->Result<Vec<u8>,i32>{
 if resource.is_null()||a.resource!=resource as usize{return Err(MISMATCH)}
 if a.first!=OK{return Err(a.first)}if a.lifecycle_first!=OK{return Err(a.lifecycle_first)}
 if a.phase!=3||a.receipt.is_empty()||a.receipt!=a.readback{return Err(MISMATCH)}
 let body:crate::message_evidence::EngineCommitBody=serde_json::from_slice(&a.body).map_err(|_|MISMATCH)?;
 if encode(&body)?!=a.body{return Err(MISMATCH)}
 crate::message_evidence::native_completed_public::match_initialization_operation(&body,operation).map_err(|_|MISMATCH)?;
 if u64::from_be_bytes(operation[24..32].try_into().map_err(|_|BOUND)?)!=a.binding.deadline(){return Err(MISMATCH)}
 let checkpoint=a.successors[0].as_ref().ok_or(1)?;let terminal=a.successors[1].as_ref().ok_or(1)?;
 let(cp,cp_receipt,cp_readback)=successors::completed_public_parts(checkpoint,2)?;
 let(t,terminal_receipt,terminal_readback)=successors::completed_public_parts(terminal,3)?;
 crate::message_evidence::native_completed_public::encode(operation,[&a.originals[0],&a.originals[1],cp[0],t[0],t[1]],[(&a.receipt,&a.readback),(cp_receipt,cp_readback),(terminal_receipt,terminal_readback)]).map_err(|_|MISMATCH)
}
// Data-only inspection inside the same participant's completed-read scope.
// This never runs current(), enters an effect, or accepts a caller identity.
#[cfg(all(feature="source-server-collector",all(unix,not(target_os="android"))))]
fn match_server_engine_identity(body:&crate::message_evidence::EngineCommitBody,facts:&crate::account_instance::ServerCoreFacts)->Result<(),i32>{
 if body.account!=facts.account||body.device!=facts.device||body.operation!=facts.operation||
  B64.decode(&body.nonce).map_err(|_|MISMATCH)?.as_slice()!=facts.nonce{return Err(MISMATCH)}Ok(())
}
#[cfg(all(feature="source-server-collector",all(unix,not(target_os="android"))))]
pub(super)fn server_device_engine_identity(holder:usize,policy:usize)->Result<(crate::account_instance::ServerCoreFacts,[u8;32]),i32>{
 with_attempt(holder as *mut c_void,policy as *mut c_void,|a|{
  a.context.link.completed_read_snapshot()?;
  let body:crate::message_evidence::EngineCommitBody=serde_json::from_slice(&a.body).map_err(|_|MISMATCH)?;
  let facts=&a.context.link.facts;
  match_server_engine_identity(&body,facts)?;
  let mut hash=Sha256::new();hash.update(a.context.classic);hash.update(a.context.pq.as_slice());
  Ok((facts.clone(),hash.finalize().into()))
 })
}
#[cfg(all(test,feature="source-server-collector",unix,not(target_os="android")))]
mod server_device_identity_controls{
 use super::*;
 #[test]fn sdk_original_body_cannot_cross_request_nonce_or_device(){
  let body:crate::message_evidence::EngineCommitBody=serde_json::from_slice(include_bytes!("message_evidence/fixtures/sdk-fd2-body.json")).unwrap();
  let nonce:[u8;32]=B64.decode(&body.nonce).unwrap().try_into().unwrap();
  let facts=crate::account_instance::ServerCoreFacts{account:body.account.clone(),identity:"PUBLIC".into(),device:body.device.clone(),operation:body.operation.clone(),nonce,issued_ms:1,expires_ms:2};
  assert!(match_server_engine_identity(&body,&facts).is_ok());
  for n in 0..4{let mut other=facts.clone();match n{0=>other.account.push('x'),1=>other.device.push('x'),2=>other.operation.push('x'),_=>other.nonce[0]^=1}assert_eq!(match_server_engine_identity(&body,&other),Err(MISMATCH));}
  // Fixture is public body DATA, not an admitted participant or signature.
 }
}
#[cfg(all(feature="source-server-collector",all(unix,not(target_os="android"))))]
pub(super)fn server_device_engine_match(holder:usize,policy:usize,operation:&[u8],terminal:&[u8],checkpoint:&[u8],completed:&[u8])->Result<(),i32>{
 with_attempt(holder as *mut c_void,policy as *mut c_void,|a|{
  a.context.link.completed_read_snapshot()?;
  if completed_public_packet(a,a.resource as *mut c_void,operation)?!=completed{return Err(MISMATCH)}
  let(cp,_,_)=successors::completed_public_parts(a.successors[0].as_ref().ok_or(1)?,2)?;
  let(t,_,_)=successors::completed_public_parts(a.successors[1].as_ref().ok_or(1)?,3)?;
  if cp[0]!=checkpoint||crate::message_evidence::EngineCommitCompanions::encode(t[0],t[1]).map_err(|_|MISMATCH)?.as_slice()!=terminal{return Err(MISMATCH)}
  Ok(())
 })
}
pub(crate)fn completed_public(holder:*mut c_void,policy:*mut c_void,resource:*mut c_void,operation:&[u8])->Result<Vec<u8>,i32>{
 if holder.is_null()||policy.is_null()||resource.is_null(){return Err(BOUND)}
 let original=context(holder,policy)?;
 validate_initialization(holder,policy,true)?;successors::completed_public_validate(holder,policy)?;
 let packet=with_attempt(holder,policy,|a|completed_public_packet(a,resource,operation))?;
 // No foreign callback while SDK inventory is borrowed. Verify the original
// context and all successful immutable parts again before publishing any byte.
 let live=context(holder,policy)?;
 if live.startup!=original.startup||live.link.facts!=original.link.facts||live.classic!=original.classic||live.pq!=original.pq{return Err(MISMATCH)}
 with_attempt(holder,policy,|a|{if completed_public_packet(a,resource,operation)?!=packet{return Err(MISMATCH)}Ok(())})?;
 Ok(packet)
}
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_completed_public_copy_v1(holder:*mut c_void,policy:*mut c_void,resource:*mut c_void,operation:*const u8,operation_size:usize,out:*mut u8,capacity:usize,written:*mut usize)->i32{
 if !matches!(operation_size,224|592)||capacity==0||capacity>crate::message_evidence::native_completed_public::MAX_COMPLETED_PUBLIC||written.is_null()||(written as usize)%std::mem::align_of::<usize>()!=0{return BOUND}
 let(Some(input),Some(output),Some(length))=(region(operation,operation_size),region(out,capacity),region(written.cast(),std::mem::size_of::<usize>()))else{return BOUND};
 if !disjoint(input,output)||!disjoint(input,length)||!disjoint(output,length)||unsafe{*written}!=0{return BOUND}
 let result=catch_unwind(AssertUnwindSafe(||{
  let operation=unsafe{std::slice::from_raw_parts(operation,operation_size)}.to_vec();
  let bytes=completed_public(holder,policy,resource,&operation)?;
  if bytes.len()>capacity{return Err(BOUND)}
  // Normal private C caller provides a new temporary allocation, not a view
// into retained SDK parts. Also reject aliases of all completed public originals.
  with_attempt(holder,policy,|a|{
   let snapshot=spans(a);for s in [snapshot.id,snapshot.body,snapshot.frames[0],snapshot.frames[1],snapshot.classic[0],snapshot.classic[1],snapshot.pq[0],snapshot.pq[1],snapshot.receipt,Span::of(&a.readback),Span::of(&a.originals[0]),Span::of(&a.originals[1])]{if s.size!=0{let r=region(s.data,s.size).ok_or(BOUND)?;if !disjoint(output,r)||!disjoint(length,r){return Err(BOUND)}}}
   for(index,kind)in[2u32,3].into_iter().enumerate(){let stage=a.successors[index].as_ref().ok_or(1)?;let(originals,receipt,readback)=successors::completed_public_parts(stage,kind)?;for raw in [originals[0],originals[1],receipt,readback]{if !raw.is_empty(){let r=region(raw.as_ptr(),raw.len()).ok_or(BOUND)?;if !disjoint(output,r)||!disjoint(length,r){return Err(BOUND)}}}}Ok(())
  })?;
  unsafe{std::ptr::copy_nonoverlapping(bytes.as_ptr(),out,bytes.len());std::ptr::write(written,bytes.len())};Ok(())
 }));match result{Ok(Ok(()))=>OK,Ok(Err(code))=>code,Err(_)=>UNKNOWN}
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn engine_producer_duplicate_preserves_success_and_originals(){
  let mut retained=(3u32,OK,b"PUBLIC-SIGNATURE".to_vec(),b"PUBLIC-RECEIPT".to_vec());
  let before=retained.clone();
  let code=finish_run_status(false,Err(DUPLICATE),|cause|{retained.0=4;retained.1=cause;cause});
  assert_eq!(code,DUPLICATE);assert_eq!(retained,before);
 }
 #[test]fn engine_producer_preinsert_failure_or_panic_does_not_touch_prior_attempt(){
  for cause in [UNKNOWN,MISMATCH,BOUND]{
   let mut called=false;
   assert_eq!(finish_run_status(false,Err(cause),|s|{called=true;s}),cause);
   assert!(!called);
  }
  let mut called=false;
  assert_eq!(finish_run_status(true,Ok(()),|s|{called=true;s}),OK);assert!(!called);
 }
 #[test]fn engine_producer_postinsert_failure_is_not_exempted_by_duplicate_status(){
  for cause in [DUPLICATE,UNKNOWN,MISMATCH]{
   let mut recorded=None;
   assert_eq!(finish_run_status(true,Err(cause),|s|{recorded=Some(s);s}),cause);
   assert_eq!(recorded,Some(cause));
  }
 }
 #[test]fn engine_producer_layout_is_existing_c_abi(){assert_eq!(std::mem::size_of::<Effect>(),160);assert_eq!(std::mem::size_of::<Snapshot>(),216);}
 #[test]fn engine_producer_foreign_snapshot_cannot_create_a_holder(){
  let facts:Effect=unsafe{std::mem::zeroed()};let mut out:Snapshot=unsafe{std::mem::zeroed()};
  assert_ne!(unsafe{ynx_sdk_native_message3_snapshot_v1(0x55usize as *mut c_void,0x66usize as *mut c_void,&facts,&mut out)},OK);
  assert_eq!(out.version,0);SDK_CUSTODY.with(|r|assert!(r.borrow().is_empty()));
 }
 #[test]fn engine_producer_snapshot_alias_refuses_before_write(){
  let mut words=[0x4545454545454545u64;32];let prior=words;
  assert_eq!(unsafe{ynx_sdk_native_message3_snapshot_v1(std::ptr::null_mut(),std::ptr::null_mut(),words.as_ptr().cast(),words.as_mut_ptr().cast())},BOUND);
  assert_eq!(words,prior);
 }
 #[test]fn engine_producer_envelope_matches_existing_c_grammar(){
  let bytes=encode(&Envelope{version:1,role:ROLES[0],body:B64.encode(b"{}"),signature:Signature{classic:B64.encode([1;64]),pq:B64.encode([2;4627])}}).unwrap();
  let expected=format!("{{\"version\":1,\"role\":\"{}\",\"body\":\"e30\",\"signature\":{{\"classic\":\"{}\",\"pq\":\"{}\"}}}}",ROLES[0],B64.encode([1;64]),B64.encode([2;4627]));
  assert_eq!(bytes,expected.as_bytes());
 }
 #[test]fn engine_producer_receipt_uses_original_bytes_not_unsigned_body(){
  let original=b"PUBLIC-ENVELOPE";let r=Receipt{version:1,id:"operation<&>",kind:"engineCommit",body_digest:hex(&Sha256::digest(b"PUBLIC-BODY")),originals:std::array::from_fn(|_|OriginalDescriptor{bytes:original.len(),sha256:hex(&Sha256::digest(original))})};
  let bytes=encode(&r).unwrap();let value:serde_json::Value=serde_json::from_slice(&bytes).unwrap();
  assert_eq!(value["originals"][0]["sha256"],hex(&Sha256::digest(original)));
  assert!(std::str::from_utf8(&bytes).unwrap().contains("operation\\u003c\\u0026\\u003e"));
 }
}

#[path="message3_fixed_key_owner.rs"]mod fixed_message_key_owner;
#[path="message3_device_possession.rs"]mod device_possession;
pub(crate)use device_possession::DeviceOperationProof;

pub(crate)use fixed_message_key_owner::operation_loan::Packet as OriginalOrdinaryMessageOperationPacket;

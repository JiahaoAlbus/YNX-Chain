//! Private selected-suite mathematics for the static Native SDK. This module
//! does not acquire/admit a custody owner. Only its held owner may call after
//! original current/role/preimage/once verification. No Java/JS key API.
#![allow(unsafe_code)]
#[path="r5_custody_inputs.rs"]mod r5_custody_inputs;
#[path="r5_source_policy.rs"]pub(crate)mod r5_source_policy;
#[path="r5_action_inputs.rs"]mod r5_action_inputs;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="message_association_factory.rs"]pub(crate)mod message_association_factory;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="message_presession_read.rs"]pub(crate)mod message_presession_read;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="contact_permission_ffi.rs"]mod contact_permission_ffi;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="prekey_request_ffi.rs"]mod prekey_request_ffi;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="prekey_server_original_ffi.rs"]mod prekey_server_original_ffi;
#[cfg(all(feature="source-server-collector",feature="abi5-final-native-link",feature="source-collector-bridge"))]
pub(crate)use prekey_server_original_ffi::issuer_keys::KeyGuard as PrekeyIssuerKeyGuard;
#[cfg(feature="abi5-final-native-link")]
#[path="prekey_public_proof_ffi.rs"]mod prekey_public_proof_ffi;
use crate::private_own_key::SerializedClassicOwnKey;
use std::panic::{catch_unwind,AssertUnwindSafe};
use zeroize::Zeroizing;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="message3_producer.rs"]
pub(crate) mod message3_producer;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="core_operation_identity.rs"]
mod core_operation_identity;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="core_business_seed_owner.rs"]
pub(crate)mod core_business_seed_owner;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="core_initialization_aad.rs"]pub(crate)mod core_initialization_aad;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="predevice-initial-prekeys-v1"))]
#[path="core_initial_set_aad.rs"]pub(crate)mod core_initial_set_aad;
const OK:i32=0;const BOUND:i32=2;const MISMATCH:i32=7;const UNKNOWN:i32=8;
fn region(p:*const u8,n:usize)->Option<(usize,usize)>{
 let start=p as usize;if start==0{return None}Some((start,start.checked_add(n)?))
}
fn disjoint(a:(usize,usize),b:(usize,usize))->bool{a.1<=b.0||b.1<=a.0}
// The server binds qualifyingData to the same canonical request accepted by
// the normal Native dispatcher. This mathematical intake creates no holder,
// resource, reservation or permission and does not dispatch the request.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_execution_original_validate_v1(raw:*const u8,n:usize)->i32{
 if n<80||n>4194304+80||region(raw,n).is_none(){return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  crate::message_execution::Request::original(unsafe{std::slice::from_raw_parts(raw,n)})
   .map(|_|()).map_err(|s|s)
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
// Same exclusive server-startup and actual captured immutable phase6 request.
// Signature/chain validation returns no capability or owning result.
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_server_retirement_originals_verify_v1(owner:*mut c_void,role:u32,raw:*const u8,n:usize)->i32{
 if !(1..=2).contains(&role)||n<80||n>4194304+80||region(raw,n).is_none(){return BOUND}
 match catch_unwind(AssertUnwindSafe(||SERVER_STARTUP_BORROWS.with(|r|{
  let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let original=r.get_mut(&(owner as usize)).ok_or(1)?;
  if original.role!=role{return Err(MISMATCH)}if original.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&original.startup).ok_or(UNKNOWN)?;
   if !held.sdk_held{return Err(MISMATCH)}
   if let Err(cause)=selected_current(held){if original.first==OK{original.first=cause}original.unknown=true;return Err(UNKNOWN)}
   let(request,_)=crate::message_execution::Request::original(unsafe{std::slice::from_raw_parts(raw,n)})?;
   request.verify_retirement_originals(&held.source)?;
   if let Err(cause)=selected_current(held){if original.first==OK{original.first=cause}original.unknown=true;return Err(UNKNOWN)}Ok(())
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
// Native caller owns all valid spans throughout this synchronous borrow. The
// output must not alias the borrowed protected key, public binding or frame.
// Upstream IdentityKeyPair has Copy/internal residency limitations inherited
// from the selected native key wrapper; this is not a hardware-only claim.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_classic_sign_native_v1(
 key:*const u8,key_n:usize,expected:*const u8,frame:*const u8,frame_n:usize,
 out:*mut u8,written:*mut usize)->i32{
 if written.is_null()||(written as usize)%std::mem::align_of::<usize>()!=0{return BOUND}
 let Some(k)=region(key,key_n)else{return BOUND};let Some(p)=region(expected,33)else{return BOUND};
 let Some(m)=region(frame,frame_n)else{return BOUND};let Some(o)=region(out,64)else{return BOUND};
 let Some(w)=region(written.cast(),std::mem::size_of::<usize>())else{return BOUND};
 if key_n==0||key_n>256||frame_n==0||frame_n>33280||!disjoint(o,k)||!disjoint(o,p)||!disjoint(o,m)||!disjoint(w,k)||!disjoint(w,p)||!disjoint(w,m)||!disjoint(w,o){return BOUND}
 unsafe{*written=0;std::ptr::write_bytes(out,0,64)};
 let result=catch_unwind(AssertUnwindSafe(||{
  let expected=unsafe{std::slice::from_raw_parts(expected,33)};if expected[0]!=5{return Err(MISMATCH)}
  let protected=Zeroizing::new(unsafe{std::slice::from_raw_parts(key,key_n)}.to_vec());
  let selected=SerializedClassicOwnKey::take_native_bytes(protected).and_then(|s|s.reload()).map_err(|_|MISMATCH)?;
  if selected.public_identity().serialize().as_ref()!=expected{return Err(MISMATCH)}
  let signature=selected.sign_pair_transcript(unsafe{std::slice::from_raw_parts(frame,frame_n)}).map_err(|_|UNKNOWN)?;
  if signature.len()!=64{return Err(UNKNOWN)}
  unsafe{std::ptr::copy_nonoverlapping(signature.as_ptr(),out,64);*written=64};Ok(())
 }));
 match result{Ok(Ok(()))=>OK,Ok(Err(s))=>{unsafe{std::ptr::write_bytes(out,0,64);*written=0};s},Err(_)=>{unsafe{std::ptr::write_bytes(out,0,64);*written=0};UNKNOWN}}
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_classic_verify_native_v1(
 public:*const u8,public_n:usize,frame:*const u8,frame_n:usize,
 signature:*const u8,signature_n:usize,verified:*mut i32)->i32{
 if verified.is_null()||(verified as usize)%std::mem::align_of::<i32>()!=0{return BOUND}
 let Some(p)=region(public,public_n)else{return BOUND};let Some(m)=region(frame,frame_n)else{return BOUND};
 let Some(s)=region(signature,signature_n)else{return BOUND};let Some(v)=region(verified.cast(),std::mem::size_of::<i32>())else{return BOUND};
 if public_n!=33||frame_n==0||frame_n>33280||signature_n!=64||!disjoint(v,p)||!disjoint(v,m)||!disjoint(v,s){return BOUND}
 unsafe{*verified=0};
 match catch_unwind(AssertUnwindSafe(||{
  let raw=unsafe{std::slice::from_raw_parts(public,public_n)};if raw[0]!=5{return Err(MISMATCH)}
  let public=libsignal_protocol::PublicKey::deserialize(raw).map_err(|_|MISMATCH)?;
  let result=public.verify_signature(unsafe{std::slice::from_raw_parts(frame,frame_n)},unsafe{std::slice::from_raw_parts(signature,signature_n)});
  unsafe{*verified=i32::from(result)};Ok(())
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}


// Fixed-startup mathematical evidence inventory. The C factory must still
// acquire genuine independent current/floor/key custody; this opaque value is
// never a signing capability and cannot be installed by JS.
use std::{cell::RefCell,collections::BTreeMap,ffi::c_void};
use crate::source_evidence::{FixedStartupSourceEvidence,Error as EvidenceError};
struct ServerRegisteredOriginals{association:Box<[u8]>,registration:Box<[u8]>,names:[[u8;34];3],certificate:Box<[u8]>,row:Box<[u8]>,kinds:[u32;3],administration:Option<crate::source_evidence::SelectedAdministrationPolicy>}
struct StartupEvidenceOwner{
 source:std::rc::Rc<FixedStartupSourceEvidence>,
 retired:std::rc::Rc<std::cell::Cell<bool>>,
 policy_preparation:Option<crate::source_evidence::native_core_rights_v2::RuntimePolicyMathematics>,
 core_plane:Option<crate::source_evidence::native_core_rights_v2::NativePurposeIdentityOwnerV2>,
 core_context:Option<NativeCoreContextV2>,
 enrollment:Option<crate::message_enrollment::OriginalEnrollmentRecords>,
 ordinary_enrollment:Option<crate::ordinary_role_enrollment::OwnedOrdinaryEnrollmentCurrent>,
 ordinary_approval:Option<Zeroizing<Vec<u8>>>,ordinary_operation:Option<[u8;32]>,
 account:Option<crate::account_instance::Bootstrap>,
 selected:bool,unknown:bool,first:i32,sdk_held:bool,core_borrows:usize,
 server_registered:[Option<ServerRegisteredOriginals>;2],
 pairs:[Option<crate::source_infrastructure::MessageCustodyPair>;2],
 clients:[Option<crate::source_infrastructure::MessageTransportClient>;2],
}
thread_local!{static STARTUP_EVIDENCE:RefCell<BTreeMap<usize,Box<StartupEvidenceOwner>>>=RefCell::new(BTreeMap::new());}
thread_local!{static SELECTED_STARTUP:std::cell::Cell<Option<usize>>=const{std::cell::Cell::new(None)};}
// Policy3's ONLY pre-sign parent alternative. The ordinary full-approval child
// does not use this branch. No unselected preparation enters SDK/Core intake.
pub(super)fn runtime_policy_parent_current(parent:usize)->Result<(),i32>{
 STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&parent).ok_or(BOUND)?;
  if held.policy_preparation.is_some(){runtime_policy_preparation::current(held)}else{
   if !held.selected||SELECTED_STARTUP.with(|s|s.get())!=Some(parent){return Err(MISMATCH)}
   selected_current(held)
  }
 })
}
pub(super)fn runtime_policy_parent_source(parent:usize)->Result<std::rc::Rc<FixedStartupSourceEvidence>,i32>{
 runtime_policy_parent_current(parent)?;
 let source=STARTUP_EVIDENCE.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;Ok::<_,i32>(std::rc::Rc::clone(&r.get(&parent).ok_or(BOUND)?.source))})?;
 runtime_policy_parent_current(parent)?;Ok(source)
}
pub(super)fn runtime_policy_parent_retain(parent:usize)->Result<(),i32>{
 runtime_policy_parent_current(parent)?;
 STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&parent).ok_or(BOUND)?;
  held.core_borrows=held.core_borrows.checked_add(1).ok_or(BOUND)?;Ok(())
 })
}
// Cleanup remains available after validation fails. Underflow never consumes
// an unrelated parent, clears first-cause state or silently repairs a debt.
pub(super)fn runtime_policy_parent_release(parent:usize)->Result<(),i32>{
 STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&parent).ok_or(BOUND)?;
  if held.policy_preparation.is_none()&&(!held.selected||SELECTED_STARTUP.with(|s|s.get())!=Some(parent)){return Err(MISMATCH)}
  held.core_borrows=held.core_borrows.checked_sub(1).ok_or(UNKNOWN)?;Ok(())
 })
}
#[path="message_custody_ffi/ordinary_startup.rs"]mod ordinary_startup;
#[path="message_custody_ffi/runtime_policy_preparation.rs"]mod runtime_policy_preparation;
#[cfg(feature="predevice-initial-prekeys-v1")]
#[path="message_custody_ffi/runtime_core_startup.rs"]mod runtime_core_startup;
#[cfg(feature="predevice-initial-prekeys-v1")]
pub(crate)use runtime_core_startup::RuntimeCoreStartup;
#[path="message_custody_ffi/prekey_startup_originals.rs"]mod prekey_startup_originals;
pub(crate)use prekey_startup_originals::{SelectedPrekeyStartupOriginals,with_selected_prekey_startup_originals};
fn check_startup_enrollment(source:&FixedStartupSourceEvidence,records:&crate::message_enrollment::OriginalEnrollmentRecords)->Result<(),EvidenceError>{
 use sha2::{Digest,Sha256};
 let digest=|raw:&[u8]|->String{Sha256::digest(raw).iter().map(|b|format!("{b:02x}")).collect()};
 let issuer_history:Vec<&[u8]>=records.issuer_predecessors.iter().map(|r|r.as_slice()).collect();
 let anchor_history:Vec<&[u8]>=records.anchor_predecessors.iter().map(|r|r.as_slice()).collect();
 let issuer=crate::message_enrollment::verify_startup(source,&records.issuer_current,&issuer_history,1,&digest(&records.issuer_current))?;
 let anchor=crate::message_enrollment::verify_startup(source,&records.anchor_current,&anchor_history,2,&digest(&records.anchor_current))?;
 // Distinct administrative custody is mandatory; a platform digest is not a
 // substitute for that proof and does not impose two hardware TPMs here.
 if issuer.registration.administration_domain==anchor.registration.administration_domain{return Err(EvidenceError::Binding)}
 issuer.recheck()?;anchor.recheck()?;
 let at=crate::source_evidence::now_ms()?;issuer.recheck_at(at)?;anchor.recheck_at(at)?;Ok(())
}
// Bounded public originals from the already selected same-thread startup.
// This cannot select startup or manufacture a Root, key or message grant.
#[cfg(feature="predevice-cold-v1")]
pub(crate)fn selected_original_message_enrollment_records(final_pair_current:impl FnOnce()->Result<(),i32>)->Result<crate::message_enrollment::OriginalEnrollmentRecords,i32>{
 let id=SELECTED_STARTUP.with(|s|s.get()).ok_or(1)?;
 STARTUP_EVIDENCE.with(|registry|{
  let mut registry=registry.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let held=registry.get_mut(&id).ok_or(1)?;
  if !held.selected{return Err(MISMATCH)}
  selected_current(held)?;
  let records=held.enrollment.as_ref().ok_or(1)?;
  let issuer_history:Vec<&[u8]>=records.issuer_predecessors.iter().map(|r|r.as_slice()).collect();
  let anchor_history:Vec<&[u8]>=records.anchor_predecessors.iter().map(|r|r.as_slice()).collect();
  let copied=crate::message_enrollment::OriginalEnrollmentRecords::copy_originals(&records.issuer_current,&issuer_history,&records.anchor_current,&anchor_history).map_err(evidence_status)?;
  selected_current(held)?;
  if SELECTED_STARTUP.with(|s|s.get())!=Some(id){return Err(MISMATCH)}
  final_pair_current()?;
  ordinary_startup::check(held).map_err(evidence_status)?;
  Ok(copied)
 })
}
fn evidence_status(e:EvidenceError)->i32{match e{EvidenceError::ProfileRequired=>1,EvidenceError::Bounds=>BOUND,_=>MISMATCH}}
fn public_span<'a>(p:*const u8,n:usize)->Result<&'a[u8],i32>{if n==0||n>1048576||region(p,n).is_none(){return Err(BOUND)}Ok(unsafe{std::slice::from_raw_parts(p,n)})}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_evidence_open_v1(
 manifest:*const u8,mn:usize,issuer:*const u8,in_:usize,anchor:*const u8,an:usize,selected:*const u8,sn:usize,out:*mut *mut c_void)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};
 for(p,n)in[(manifest,mn),(issuer,in_),(anchor,an),(selected,sn)]{let Some(r)=region(p,n)else{return BOUND};if !disjoint(o,r){return BOUND}}
 if unsafe{!(*out).is_null()}{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let m=public_span(manifest,mn)?;let i=public_span(issuer,in_)?;let a=public_span(anchor,an)?;
  if in_>65536||an>65536||mn.checked_add(in_).and_then(|n|n.checked_add(an)).and_then(|n|n.checked_add(sn)).filter(|n|*n<=1048576).is_none(){return Err(BOUND)}
  let selected=std::str::from_utf8(public_span(selected,sn)?).map_err(|_|BOUND)?;
  let evidence=Box::new(StartupEvidenceOwner{retired:std::rc::Rc::new(std::cell::Cell::new(false)),policy_preparation:None,source:std::rc::Rc::new(crate::source_evidence::verify_fixed_startup_source(m,i,a,selected).map_err(evidence_status)?),core_plane:None,core_context:None,enrollment:None,ordinary_enrollment:None,ordinary_approval:None,ordinary_operation:None,account:None,selected:false,unknown:false,first:OK,sdk_held:false,core_borrows:0,server_registered:[None,None],pairs:[None,None],clients:[None,None]});
  STARTUP_EVIDENCE.with(|registry|{let mut registry=registry.try_borrow_mut().map_err(|_|UNKNOWN)?;if registry.len()>=32{return Err(BOUND)}
   let p=(&*evidence as *const StartupEvidenceOwner)as usize;if registry.contains_key(&p){return Err(UNKNOWN)}registry.insert(p,evidence);unsafe{*out=p as *mut c_void};Ok(())})
 })){Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_evidence_recheck_v1(
 owner:*mut c_void,manifest:*const u8,mn:usize,issuer:*const u8,in_:usize,anchor:*const u8,an:usize)->i32{
 match catch_unwind(AssertUnwindSafe(||{
  let m=public_span(manifest,mn)?;let i=public_span(issuer,in_)?;let a=public_span(anchor,an)?;
  STARTUP_EVIDENCE.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let p=r.get(&(owner as usize)).ok_or(1)?;
   p.source.recheck_originals(m,i,a).map_err(evidence_status)?;
   if p.enrollment.is_some(){ordinary_startup::check(p).map_err(evidence_status)?;}
   if let Some(account)=&p.account{account.current().map_err(account_status)?;}Ok(())})
 })){Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}

#[repr(C)]
pub(crate)struct NativeOriginalSpan{data:*const u8,size:usize}
#[repr(C)]
pub(crate)struct NativeStartupOriginals{
 version:u32,approval_input_digest:[u8;32],
 root:NativeOriginalSpan,registration:NativeOriginalSpan,status_current:NativeOriginalSpan,
 status_predecessors:*const NativeOriginalSpan,status_predecessors_count:usize,
 issuer_credential:NativeOriginalSpan,anchor_credential:NativeOriginalSpan,
 issuer_enrollment_current:NativeOriginalSpan,
 issuer_enrollment_predecessors:*const NativeOriginalSpan,issuer_enrollment_predecessors_count:usize,
 anchor_enrollment_current:NativeOriginalSpan,
 anchor_enrollment_predecessors:*const NativeOriginalSpan,anchor_enrollment_predecessors_count:usize,
}
fn startup_span<'a>(raw:&NativeOriginalSpan,output:(usize,usize),limit:usize,total:&mut usize)->Result<&'a[u8],i32>{
 if raw.size>limit{return Err(BOUND)}let r=region(raw.data,raw.size).ok_or(BOUND)?;
 if !disjoint(r,output){return Err(BOUND)}
 *total=total.checked_add(raw.size).filter(|n|*n<=1048576).ok_or(BOUND)?;public_span(raw.data,raw.size)
}
fn startup_history<'a>(raw:*const NativeOriginalSpan,count:usize,output:(usize,usize),limit:usize,total:&mut usize)->Result<Vec<&'a[u8]>,i32>{
 if count>255{return Err(BOUND)}
 let slice=if count==0{&[][..]}else{
  let size=count.checked_mul(std::mem::size_of::<NativeOriginalSpan>()).ok_or(BOUND)?;
  if (raw as usize)%std::mem::align_of::<NativeOriginalSpan>()!=0||!disjoint(region(raw.cast(),size).ok_or(BOUND)?,output){return Err(BOUND)}
  unsafe{std::slice::from_raw_parts(raw,count)}
 };
 let mut result=Vec::new();result.try_reserve_exact(count).map_err(|_|BOUND)?;
 for original in slice{result.push(startup_span(original,output,limit,total)?);}Ok(result)
}
// Actual fixed startup intake of all twelve original fields. This is a Native
// private entry, not an N-API tuple or configurable Root selector. It publishes
// only fully matched/verified public evidence; protected factory still must
// obtain its named domain/current/floor/key resources independently.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_fixed_startup_open_v1(
 input:*const NativeStartupOriginals,manifest:*const u8,mn:usize,
 selected:*const u8,sn:usize,out:*mut *mut c_void)->i32{
 unsafe{fixed_startup_open_profile(input,manifest,mn,selected,sn,out,false,None,None)}
}
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_fixed_startup_open_initial_prekeys_v2(
 input:*const NativeStartupOriginals,manifest:*const u8,mn:usize,
 selected:*const u8,sn:usize,out:*mut *mut c_void)->i32{
 unsafe{fixed_startup_open_profile(input,manifest,mn,selected,sn,out,true,None,None)}
}
unsafe fn fixed_startup_open_profile(input:*const NativeStartupOriginals,manifest:*const u8,mn:usize,
 selected:*const u8,sn:usize,out:*mut *mut c_void,initial_prekeys:bool,core:Option<&NativeCoreStartupInputV2>,ordinary_policy:Option<&[u8]>)->i32{
 if core.is_some()&&ordinary_policy.is_some(){return BOUND}
 if out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0||input.is_null()||(input as usize)%std::mem::align_of::<NativeStartupOriginals>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};
 let Some(i)=region(input.cast(),std::mem::size_of::<NativeStartupOriginals>())else{return BOUND};
 if !disjoint(i,o)||unsafe{!(*out).is_null()}{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let input=unsafe{&*input};if input.version!=1{return Err(MISMATCH)}let mut total=0;
  let manifest=startup_span(&NativeOriginalSpan{data:manifest,size:mn},o,1048576,&mut total)?;
  let selected=std::str::from_utf8(startup_span(&NativeOriginalSpan{data:selected,size:sn},o,128,&mut total)?).map_err(|_|BOUND)?;
  let root=startup_span(&input.root,o,16384,&mut total)?;
  let registration=startup_span(&input.registration,o,16384,&mut total)?;
  let status=startup_span(&input.status_current,o,16384,&mut total)?;
  let account_history=startup_history(input.status_predecessors,input.status_predecessors_count,o,16384,&mut total)?;
  let issuer=startup_span(&input.issuer_credential,o,65536,&mut total)?;
  let anchor=startup_span(&input.anchor_credential,o,65536,&mut total)?;
  let issuer_current=startup_span(&input.issuer_enrollment_current,o,65536,&mut total)?;
  let issuer_history=startup_history(input.issuer_enrollment_predecessors,input.issuer_enrollment_predecessors_count,o,65536,&mut total)?;
  let anchor_current=startup_span(&input.anchor_enrollment_current,o,65536,&mut total)?;
  let anchor_history=startup_history(input.anchor_enrollment_predecessors,input.anchor_enrollment_predecessors_count,o,65536,&mut total)?;
  let account=crate::account_instance::Bootstrap::selected().map_err(account_status)?;
  let prefix:Vec<Zeroizing<Vec<u8>>>=account_history.iter().map(|v|Zeroizing::new(v.to_vec())).collect();
  account.match_startup_originals(root,registration,status,&prefix).map_err(account_status)?;
  let source=if initial_prekeys{
   crate::source_evidence::verify_fixed_startup_source_initial_prekeys(manifest,issuer,anchor,selected)
  }else{crate::source_evidence::verify_fixed_startup_source(manifest,issuer,anchor,selected)}.map_err(evidence_status)?;
  source.match_approval_input_digest(&input.approval_input_digest).map_err(evidence_status)?;
  let enrollment=crate::message_enrollment::OriginalEnrollmentRecords::copy_originals(issuer_current,&issuer_history,anchor_current,&anchor_history).map_err(evidence_status)?;
  if core.is_none()&&ordinary_policy.is_none(){check_startup_enrollment(&source,&enrollment).map_err(evidence_status)?;}
  account.current().map_err(account_status)?;
  let evidence=Box::new(StartupEvidenceOwner{retired:std::rc::Rc::new(std::cell::Cell::new(false)),policy_preparation:None,source:std::rc::Rc::new(source),core_plane:None,core_context:None,enrollment:Some(enrollment),ordinary_enrollment:None,ordinary_approval:None,ordinary_operation:None,account:Some(account),selected:false,unknown:false,first:OK,sdk_held:false,core_borrows:0,server_registered:[None,None],pairs:[None,None],clients:[None,None]});
  STARTUP_EVIDENCE.with(|registry|{let mut registry=registry.try_borrow_mut().map_err(|_|UNKNOWN)?;if registry.len()>=32{return Err(BOUND)}
   let p=(&*evidence as *const StartupEvidenceOwner)as usize;if registry.contains_key(&p){return Err(UNKNOWN)}registry.insert(p,evidence);unsafe{*out=p as *mut c_void};
   // Adopt the actual parent before authenticating/opening any Core/current
   // child. Non-null partials remain available to the original close path.
   if let Some(core)=core{ordinary_startup::install_core_before_selection(registry.get_mut(&p).ok_or(UNKNOWN)?,core)?;}
   if let Some(policy)=ordinary_policy{ordinary_startup::install_policy_before_selection(registry.get_mut(&p).ok_or(UNKNOWN)?,policy)?;}Ok(())})
 })){Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}
fn account_status(error:crate::account_instance::Error)->i32{
 match error{crate::account_instance::Error::Required=>1,crate::account_instance::Error::Bounds=>BOUND,crate::account_instance::Error::Unknown=>UNKNOWN,_=>MISMATCH}
}
// The fixed Native loader supplies the original account side of the twelve
// inputs. The selected account Root is independently release-owned; neither
// these originals nor the public manifest can populate its approval table.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_account_bind_v1(
 owner:*mut c_void,root:*const u8,rn:usize,registration:*const u8,gn:usize,
 status:*const u8,sn:usize,history:*const NativeOriginalSpan,count:usize)->i32{
 if count>255||rn>16384||gn>16384||sn>16384{return BOUND}
 if count!=0&&(history.is_null()||(history as usize)%std::mem::align_of::<NativeOriginalSpan>()!=0||region(history.cast(),match count.checked_mul(std::mem::size_of::<NativeOriginalSpan>()){Some(n)=>n,None=>return BOUND}).is_none()){return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let root=public_span(root,rn)?;let registration=public_span(registration,gn)?;let status=public_span(status,sn)?;
  // Empty genesis prefix is a real empty slice, never NULL from_raw_parts.
  let input=if count==0{&[][..]}else{unsafe{std::slice::from_raw_parts(history,count)}};
  let mut total=rn.checked_add(gn).and_then(|n|n.checked_add(sn)).ok_or(BOUND)?;
  let mut prefix=Vec::new();prefix.try_reserve_exact(count).map_err(|_|BOUND)?;
  for original in input{if original.size>16384{return Err(BOUND)}let raw=public_span(original.data,original.size)?;
   total=total.checked_add(raw.len()).ok_or(BOUND)?;if total>1048576{return Err(BOUND)}prefix.push(Zeroizing::new(raw.to_vec()));}
  STARTUP_EVIDENCE.with(|registry|{let mut registry=registry.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=registry.get_mut(&(owner as usize)).ok_or(1)?;
   if held.account.is_some(){return Err(MISMATCH)}
   let enrollment=held.enrollment.as_ref().ok_or(1)?;check_startup_enrollment(&held.source,enrollment).map_err(evidence_status)?;
   let selected=crate::account_instance::Bootstrap::selected().map_err(account_status)?;
   selected.match_startup_originals(root,registration,status,&prefix).map_err(account_status)?;
   check_startup_enrollment(&held.source,enrollment).map_err(evidence_status)?;
   selected.current().map_err(account_status)?;
   held.account=Some(selected);Ok(())})
 })){Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}

// Fixed Native startup loader supplies originals once, before custody acquire.
// This entry stores no self-referential borrow and cannot be called via N-API.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_enrollment_bind_v1(owner:*mut c_void,raw:*const u8,n:usize)->i32{
 match catch_unwind(AssertUnwindSafe(||{
  let records=crate::message_enrollment::OriginalEnrollmentRecords::parse(public_span(raw,n)?).map_err(evidence_status)?;
  STARTUP_EVIDENCE.with(|registry|{let mut registry=registry.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=registry.get_mut(&(owner as usize)).ok_or(1)?;
   if held.enrollment.is_some(){return Err(MISMATCH)}
   check_startup_enrollment(&held.source,&records).map_err(evidence_status)?;
   held.enrollment=Some(records);Ok(())})
 })){Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}

// One normal private startup entry: publish the evidence inventory only after
// both enrollment chains are installed. A cleanup refusal retains its exact
// original partial evidence; no caller may turn this into a signing owner.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_evidence_open_complete_v1(
 manifest:*const u8,mn:usize,issuer:*const u8,in_:usize,anchor:*const u8,an:usize,
 selected:*const u8,sn:usize,enrollment:*const u8,en:usize,out:*mut *mut c_void)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};
 for(p,n)in[(manifest,mn),(issuer,in_),(anchor,an),(selected,sn),(enrollment,en)]{
  let Some(r)=region(p,n)else{return BOUND};if !disjoint(o,r){return BOUND}
 }
 if unsafe{!(*out).is_null()}||mn.checked_add(in_).and_then(|n|n.checked_add(an)).and_then(|n|n.checked_add(sn)).and_then(|n|n.checked_add(en)).filter(|n|*n<=1048576).is_none(){return BOUND}
 let mut original=std::ptr::null_mut();
 let status=unsafe{ynx_sdk_startup_evidence_open_v1(manifest,mn,issuer,in_,anchor,an,selected,sn,&mut original)};
 if status!=OK{return status}
 let status=unsafe{ynx_sdk_startup_enrollment_bind_v1(original,enrollment,en)};
 if status!=OK{
  let before=original;
  let cleanup=unsafe{ynx_sdk_startup_evidence_close_v1(&mut original)};
  if (cleanup!=OK||!original.is_null())&&original!=before{std::process::abort()}
  if cleanup!=OK||!original.is_null(){unsafe{*out=original};return UNKNOWN}
  return status
 }
 unsafe{*out=original};OK
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_evidence_close_v1(owner:*mut *mut c_void)->i32{
 if owner.is_null()||(owner as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}let p=unsafe{*owner};if p.is_null(){return OK}
 match catch_unwind(AssertUnwindSafe(||STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  if !r.contains_key(&(p as usize)){return Err(1)}
  let held=r.get_mut(&(p as usize)).ok_or(1)?;
  if held.sdk_held||held.core_borrows!=0{return Err(MISMATCH)}
  ordinary_startup::close(held)?;
  for client in &mut held.clients{if let Some(original)=client.as_mut(){if let Err(cause)=original.close(){if held.first==OK{held.first=cause}held.unknown=true;return Err(UNKNOWN)}*client=None;}}
  for pair in &mut held.pairs{if let Some(original)=pair.as_mut(){if let Err(e)=original.close(){if held.first==OK{held.first=custody_status(e)}held.unknown=true;return Err(UNKNOWN)}*pair=None;}}
  if let Some(plane)=held.core_plane.as_mut(){if let Err(e)=plane.close_once_v2(){if held.first==OK{held.first=evidence_status(e)}held.unknown=true;return Err(UNKNOWN)}held.core_plane=None;held.core_context=None;}
  SELECTED_STARTUP.with(|selected|{if selected.get()==Some(p as usize){selected.set(None)}});
  r.remove(&(p as usize));unsafe{*owner=std::ptr::null_mut()};Ok(())}))){Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}

fn selected_current(held:&mut StartupEvidenceOwner)->Result<(),i32>{
 if held.retired.get(){if held.first==OK{held.first=MISMATCH}held.unknown=true;return Err(UNKNOWN)}
 if held.unknown{return Err(UNKNOWN)}
 let result=catch_unwind(AssertUnwindSafe(||{
  let enrollment=held.enrollment.as_ref().ok_or(1)?;
  let account=held.account.as_ref().ok_or(1)?;
  account.current().map_err(account_status)?;
  ordinary_startup::check(held).map_err(evidence_status)?;
  account.current().map_err(account_status)?;
  for client in &mut held.clients{if let Some(client)=client.as_mut(){client.current()?;}}
  for (index,pair) in held.pairs.iter_mut().enumerate(){if let Some(pair)=pair{
   let (raw,prefix)=if index==0{(&enrollment.issuer_current,&enrollment.issuer_predecessors)}else{(&enrollment.anchor_current,&enrollment.anchor_predecessors)};
   use sha2::{Digest,Sha256};let digest:String=Sha256::digest(raw.as_slice()).iter().map(|b|format!("{b:02x}")).collect();
   let prefix:Vec<&[u8]>=prefix.iter().map(|b|b.as_slice()).collect();
   let verified=crate::message_enrollment::verify_startup(&held.source,raw,&prefix,(index+1)as u8,&digest).map_err(evidence_status)?;
   pair.observe_current(&verified).map_err(custody_status)?;
  }}Ok(())
 })).unwrap_or(Err(UNKNOWN));
 if let Err(s)=result{if held.first==OK{held.first=s}held.unknown=true;return Err(UNKNOWN)}Ok(())
}
// Private normal backend startup consumes the complete original input entry.
// Selection retains the same owner until explicit close; no JS installer or
// manifest can replace it. A failed selection keeps the returned evidence for
// cleanup, including its first cause. This still does not acquire protected
// signing keys, a joint fence or an independent floor.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_fixed_startup_initialize_v1(
 inputs:*const NativeStartupOriginals,manifest:*const u8,mn:usize,
 selected:*const u8,sn:usize,out:*mut *mut c_void)->i32{
 unsafe{fixed_startup_initialize_profile(inputs,manifest,mn,selected,sn,out,false,None,None)}
}
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_fixed_startup_initialize_initial_prekeys_v2(
 inputs:*const NativeStartupOriginals,manifest:*const u8,mn:usize,
 selected:*const u8,sn:usize,out:*mut *mut c_void)->i32{
 unsafe{fixed_startup_initialize_profile(inputs,manifest,mn,selected,sn,out,true,None,None)}
}
unsafe fn fixed_startup_initialize_profile(inputs:*const NativeStartupOriginals,manifest:*const u8,mn:usize,
 selected:*const u8,sn:usize,out:*mut *mut c_void,initial_prekeys:bool,core:Option<&NativeCoreStartupInputV2>,ordinary_policy:Option<&[u8]>)->i32{
 if SELECTED_STARTUP.with(|s|s.get().is_some()){return MISMATCH}
 let status=unsafe{fixed_startup_open_profile(inputs,manifest,mn,selected,sn,out,initial_prekeys,core,ordinary_policy)};
 if status!=OK{return status}
 match catch_unwind(AssertUnwindSafe(||STARTUP_EVIDENCE.with(|r|{
  let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let id=unsafe{*out}as usize;let held=r.get_mut(&id).ok_or(UNKNOWN)?;
  selected_current(held)?;
  SELECTED_STARTUP.with(|selected|{if selected.get().is_some(){return Err(MISMATCH)}held.selected=true;selected.set(Some(id));Ok(())})
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
// Actual addon acquire preflight: only match the already selected Native
// originals. The scope retains the inventory borrow through both fences, so
// reentrant close/replace is refused rather than invalidating the held owner.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_selected_match_v1(manifest:*const u8,n:usize)->i32{
 match catch_unwind(AssertUnwindSafe(||{
  let manifest=public_span(manifest,n)?;
  let id=SELECTED_STARTUP.with(|s|s.get()).ok_or(1)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=r.get_mut(&id).ok_or(UNKNOWN)?;if !held.selected{return Err(UNKNOWN)}
   selected_current(held)?;
   held.source.match_selected_manifest(manifest).map_err(evidence_status)?;
   selected_current(held)
  })
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
fn custody_status(e:crate::source_infrastructure::SourceError)->i32{use crate::source_infrastructure::SourceError;match e{SourceError::Bounds=>BOUND,SourceError::Thread=>4,SourceError::Foreign(s)=>s,_=>UNKNOWN}}
// Normal private protection loader, never N-API: bind the actual encrypted
// pair to its original signed Message enrollment and selected public keys.
// A successfully loaded pair is primitive custody ONLY. No floor/enter/grant
// or SDK signing capability is returned to the caller.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_message_records_bind_v1(
 owner:*mut c_void,role:u32,alias:*const u8,alias_n:usize,generation:u64,
 pq:*const u8,pq_n:usize,classic:*const u8,classic_n:usize)->i32{
 use crate::source_infrastructure::{SourceRole,SourcePqRecord,SourceClassicRecord,MessageCustodyPair};
 if !(1..=2).contains(&role)||alias_n==0||alias_n>512||generation==0||pq_n!=std::mem::size_of::<SourcePqRecord>()||classic_n!=std::mem::size_of::<SourceClassicRecord>()||region(pq,pq_n).is_none()||region(classic,classic_n).is_none(){return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let alias=std::ffi::CString::new(public_span(alias,alias_n)?).map_err(|_|BOUND)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=r.get_mut(&(owner as usize)).ok_or(1)?;
   if !held.selected||SELECTED_STARTUP.with(|s|s.get())!=Some(owner as usize){return Err(1)}
   if held.sdk_held||held.core_borrows!=0{return Err(MISMATCH)}
   selected_current(held)?;let index=(role-1)as usize;if held.pairs[index].is_some(){return Err(MISMATCH)}
   let records=held.enrollment.as_ref().ok_or(1)?;
   let (raw,prefix)=if role==1{(&records.issuer_current,&records.issuer_predecessors)}else{(&records.anchor_current,&records.anchor_predecessors)};
   use sha2::{Digest,Sha256};let digest:String=Sha256::digest(raw.as_slice()).iter().map(|b|format!("{b:02x}")).collect();
   let prefix:Vec<&[u8]>=prefix.iter().map(|b|b.as_slice()).collect();
   let enrollment=crate::message_enrollment::verify_startup(&held.source,raw,&prefix,role as u8,&digest).map_err(evidence_status)?;
   let q=unsafe{std::ptr::read_unaligned(pq.cast::<SourcePqRecord>())};let c=unsafe{std::ptr::read_unaligned(classic.cast::<SourceClassicRecord>())};
   let result=MessageCustodyPair::open(&held.source,&enrollment,if role==1{SourceRole::Issuer}else{SourceRole::Anchor},&alias,generation,&q,&c);
   match result{Ok(pair)=>held.pairs[index]=Some(pair),Err((e,pair))=>{held.pairs[index]=Some(pair);if held.first==OK{held.first=custody_status(e)}held.unknown=true;return Err(UNKNOWN)}}
   selected_current(held)
  })
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Called on the actual normal addon acquire path before any resource allocation.
// OK here means exact public transport syntax ONLY; the SDK still acquires its
// independent release-selected profile and genuine resource/current/floor owner.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_manifest_validate_native_v1(raw:*const u8,n:usize)->i32{
 match catch_unwind(AssertUnwindSafe(||crate::source_evidence::validate_custody_selection(public_span(raw,n)?).map_err(evidence_status))){Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}

// Same-thread partial custody retained by the real addon acquire. This is an
// exclusive lease of already acquired Native keys, never a copy/identity grant.
// The independent reservation/retirement owner is not supplied by an ESAPI
// success or these public originals. Consequently no successful SDK capability
// is published until that actual owner can be acquired.
struct NativeCustodyOwner{startup:usize,first:i32,unknown:bool,
 #[cfg(feature="source-server-collector")]first_server_parent:Option<(usize,usize)>,
 execution:crate::message_execution::Execution,message3_pins:BTreeMap<usize,usize>,r5_source_policies:BTreeMap<usize,r5_source_policy::SourcePolicy>,
 #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
 engine_attempts:BTreeMap<usize,message3_producer::EngineAttempt>,
}
thread_local!{static SDK_CUSTODY:RefCell<BTreeMap<usize,Box<NativeCustodyOwner>>>=RefCell::new(BTreeMap::new());}
#[repr(C)]
pub(crate)struct NativeCustodyResult{public_bytes:[u8;4627],public_size:usize,verified:i32}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_custody_acquire(manifest:NativeOriginalSpan,out:*mut *mut c_void)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(output)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};
 let Some(input)=region(manifest.data,manifest.size)else{return BOUND};
 if !disjoint(output,input)||unsafe{!(*out).is_null()}{return BOUND}
 let result=match catch_unwind(AssertUnwindSafe(||{
  let manifest=public_span(manifest.data,manifest.size)?;
  let selected=SELECTED_STARTUP.with(|s|s.get()).ok_or(1)?;
  // The link was created by the actual same participant and physical startup;
  // check it outside both SDK and startup inventory borrows.
  #[cfg(feature="source-server-collector")]
  let attached=first_server_sdk_candidate(selected)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=r.get_mut(&selected).ok_or(UNKNOWN)?;
   #[cfg(feature="source-server-collector")]
   if !held.selected||if attached.is_some(){!held.sdk_held||held.core_borrows==0}else{held.sdk_held||held.core_borrows!=0}{return Err(MISMATCH)}
   #[cfg(not(feature="source-server-collector"))]
   if !held.selected||held.sdk_held||held.core_borrows!=0{return Err(MISMATCH)}
   selected_current(held)?;held.source.match_selected_manifest(manifest).map_err(evidence_status)?;
   // Missing actual key custody has no output. Public enrollment cannot fill it.
   if held.pairs.iter().any(Option::is_none){return Err(1)}
   SDK_CUSTODY.with(|sdk|{let mut sdk=sdk.try_borrow_mut().map_err(|_|UNKNOWN)?;
    if sdk.len()>=32{return Err(BOUND)}
    let records=held.enrollment.as_ref().ok_or(1)?;
    let digest=|raw:&[u8]|->String{use sha2::{Digest,Sha256};Sha256::digest(raw).iter().map(|b|format!("{b:02x}")).collect()};
    let issuer_history:Vec<&[u8]>=records.issuer_predecessors.iter().map(|p|p.as_slice()).collect();
    let anchor_history:Vec<&[u8]>=records.anchor_predecessors.iter().map(|p|p.as_slice()).collect();
    let issuer=crate::message_enrollment::verify_startup(&held.source,&records.issuer_current,&issuer_history,1,&digest(&records.issuer_current)).map_err(evidence_status)?;
    let anchor=crate::message_enrollment::verify_startup(&held.source,&records.anchor_current,&anchor_history,2,&digest(&records.anchor_current)).map_err(evidence_status)?;
    let execution=crate::message_execution::Execution::selected(&issuer,&anchor)?;
    let original=Box::new(NativeCustodyOwner{startup:selected,first:OK,unknown:false,
     #[cfg(feature="source-server-collector")]first_server_parent:attached,
     execution,message3_pins:BTreeMap::new(),r5_source_policies:BTreeMap::new(),
     #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
     engine_attempts:BTreeMap::new(),
    });
    let id=(&*original as *const NativeCustodyOwner)as usize;
    if sdk.contains_key(&id){return Err(UNKNOWN)}
    #[cfg(feature="source-server-collector")]
    if let Some((parent,_))=attached{
     FIRST_SERVER_STARTUPS.with(|parents|{let mut parents=parents.try_borrow_mut().map_err(|_|UNKNOWN)?;
      let owner=parents.get_mut(&parent).ok_or(UNKNOWN)?;
      if owner.startup!=selected||owner.unknown||owner.child.is_some(){return Err(MISMATCH)}
      CORE_LOANS_V2.with(|loans|{let mut loans=loans.try_borrow_mut().map_err(|_|UNKNOWN)?;
       let loan=loans.get_mut(&attached.ok_or(UNKNOWN)?.1).ok_or(UNKNOWN)?;
       if loan.startup!=selected||loan.unknown{return Err(MISMATCH)}
       let next=loan.children.checked_add(1).ok_or(BOUND)?;
       owner.child=Some(id);loan.children=next;Ok(())
      })})?;
    }
    held.sdk_held=true;sdk.insert(id,original);unsafe{*out=id as *mut c_void};
    // Retain the exact owner before any late refusal. Opening custody checks
    // real resources, not an operation grant that cannot exist until dispatch.
    let original=sdk.get_mut(&id).ok_or(UNKNOWN)?;
    for (role,slot) in held.clients.iter_mut().enumerate(){if let Some(client)=slot.take(){
     if let Err((status,client))=original.execution.retain_client_preserving(role,client){
      *slot=Some(client);if original.first==OK{original.first=status}original.unknown=true;return Err(UNKNOWN)
     }
    }}
    if let Err(status)=selected_current(held){if original.first==OK{original.first=if held.first==OK{status}else{held.first}}original.unknown=true;return Err(UNKNOWN)}
    let status=original.execution.custody_current();
    if status!=OK{let cause=original.execution.first_failure();if original.first==OK{original.first=if cause==OK{status}else{cause}}if status==UNKNOWN{original.unknown=true}return Err(status)}
    // A real transport-current callback can invalidate Source/account after the
    // first check. Never publish successful custody across that late change.
    if let Err(status)=selected_current(held){if original.first==OK{original.first=if held.first==OK{status}else{held.first}}original.unknown=true;return Err(UNKNOWN)}
    Ok(())
   })
  })
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN};
 #[cfg(feature="source-server-collector")]
 if result==OK&&!unsafe{*out}.is_null(){
  let id=unsafe{*out}as usize;
  if let Err(cause)=first_server_sdk_child_current(id){
   let _=SDK_CUSTODY.with(|s|{if let Ok(mut s)=s.try_borrow_mut(){if let Some(child)=s.get_mut(&id){if child.first==OK{child.first=cause}child.unknown=true}}});
   return UNKNOWN
  }
 }
 result
}
// Exact private copied fact ABI from ynx_native_message_custody_node.h.
// No fact field is a capability, selected key or registered owner.
#[repr(C)]struct NativeCustodyFact{kind:i32,bytes:*const u8,size:usize,children:*const NativeCustodyFact,count:usize,name:*const u8,name_size:usize}
#[repr(C)]struct NativeCustodyCall{arguments:*const NativeCustodyFact,count:usize}
unsafe fn custody_read_only_facts(action:i32,call:*const c_void,output:(usize,usize))->Result<Option<Vec<u8>>,i32>{
 if call.is_null()||(call as usize)%std::mem::align_of::<NativeCustodyCall>()!=0{return Err(BOUND)}
 if !disjoint(region(call.cast(),std::mem::size_of::<NativeCustodyCall>()).ok_or(BOUND)?,output){return Err(BOUND)}
 let call=unsafe{&*call.cast::<NativeCustodyCall>()};
 if action!=0{return if matches!(action,1|3)&&call.count==0{Ok(None)}else{Err(BOUND)}}
 if call.count!=1||call.arguments.is_null()||(call.arguments as usize)%std::mem::align_of::<NativeCustodyFact>()!=0{return Err(BOUND)}
 if !disjoint(region(call.arguments.cast(),std::mem::size_of::<NativeCustodyFact>()).ok_or(BOUND)?,output){return Err(BOUND)}
 let fact=unsafe{&*call.arguments};
 if fact.kind!=1||fact.count!=0||fact.name_size!=0||fact.size==0||fact.size>1048576{return Err(BOUND)}
 if !disjoint(region(fact.bytes,fact.size).ok_or(BOUND)?,output){return Err(BOUND)}
 Ok(Some(unsafe{std::slice::from_raw_parts(fact.bytes,fact.size)}.to_vec()))
}
unsafe fn custody_verification_facts(call:*const c_void,output:(usize,usize))->Result<(Vec<u8>,Vec<u8>,Vec<u8>),i32>{
 if call.is_null()||(call as usize)%std::mem::align_of::<NativeCustodyCall>()!=0{return Err(BOUND)}
 if !disjoint(region(call.cast(),std::mem::size_of::<NativeCustodyCall>()).ok_or(BOUND)?,output){return Err(BOUND)}
 let call=unsafe{&*call.cast::<NativeCustodyCall>()};if call.count!=3||call.arguments.is_null()||(call.arguments as usize)%std::mem::align_of::<NativeCustodyFact>()!=0{return Err(BOUND)}
 if !disjoint(region(call.arguments.cast(),3*std::mem::size_of::<NativeCustodyFact>()).ok_or(BOUND)?,output){return Err(BOUND)}
 let args=unsafe{std::slice::from_raw_parts(call.arguments,3)};
 let mut values=Vec::new();for(index,fact)in args.iter().enumerate(){
  if fact.kind!=if index==0{2}else{1}||fact.count!=0||fact.name_size!=0{return Err(BOUND)}
  let max=if index==0{3456}else if index==1{33280}else{4627};if fact.size==0||fact.size>max{return Err(BOUND)}
  let span=region(fact.bytes,fact.size).ok_or(BOUND)?;if !disjoint(span,output){return Err(BOUND)}
  values.push(unsafe{std::slice::from_raw_parts(fact.bytes,fact.size)}.to_vec());
 }
 let signature=values.pop().ok_or(BOUND)?;let frame=values.pop().ok_or(BOUND)?;let key=values.pop().ok_or(BOUND)?;Ok((key,frame,signature))
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_custody_call(owner:*mut c_void,action:i32,call:*const c_void,out:*mut NativeCustodyResult)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<NativeCustodyResult>()!=0{return BOUND}
 if !(0..=9).contains(&action){return BOUND}
 #[cfg(feature="source-server-collector")]
 if let Err(cause)=first_server_sdk_child_current(owner as usize){
  let _=SDK_CUSTODY.with(|rows|{if let Ok(mut rows)=rows.try_borrow_mut(){if let Some(held)=rows.get_mut(&(owner as usize)){
   if held.first==OK{held.first=cause}if cause!=1{held.unknown=true}
  }}});return cause
 }
 let original_inputs=if action==2{
  let Some(output)=region(out.cast(),std::mem::size_of::<NativeCustodyResult>())else{return BOUND};
  match unsafe{r5_custody_inputs::copy(call,output)}{Ok(value)=>Some(value),Err(status)=>return status}
 }else{None};
 let read_only_inputs=if matches!(action,0|1|3){
  let Some(output)=region(out.cast(),std::mem::size_of::<NativeCustodyResult>())else{return BOUND};
  match unsafe{custody_read_only_facts(action,call,output)}{Ok(value)=>Some(value),Err(status)=>return status}
 }else{None};
 let effect_inputs=if matches!(action,4|5|6|9){
  let Some(output)=region(out.cast(),std::mem::size_of::<NativeCustodyResult>())else{return BOUND};
  match unsafe{r5_action_inputs::copy(action,call,output)}{Ok(value)=>Some(value),Err(status)=>return status}
 }else{None};
 let verification_inputs=if matches!(action,7|8){
  let Some(output)=region(out.cast(),std::mem::size_of::<NativeCustodyResult>())else{return BOUND};
  match unsafe{custody_verification_facts(call,output)}{Ok(v)=>Some(v),Err(s)=>return s}
 }else{None};
 // Read-only and verification facts are copied only after alias/bounds denial,
 // before clearing output. No signing/effect permission is admitted by copying.
 unsafe{std::ptr::write(out,NativeCustodyResult{public_bytes:[0;4627],public_size:0,verified:0})};
 // Source-only effect runtime. Android/client builds keep the original server
 // feature split; this never introduces a client-side Root/signing fallback.
 if let Some(inputs)=original_inputs.as_ref(){
  #[cfg(all(feature="abi5-final-native-link",feature="source-server-collector"))]
  return match catch_unwind(AssertUnwindSafe(||r5_source_policy::operations::check_inputs(owner,inputs))){Ok(Ok(()))=>OK,Ok(Err(code))=>code,Err(_)=>UNKNOWN};
  #[cfg(not(all(feature="abi5-final-native-link",feature="source-server-collector")))]
  {let _=inputs;return 1}
 }
 if let Some(inputs)=effect_inputs{
  #[cfg(all(feature="abi5-final-native-link",feature="source-server-collector"))]
  return match catch_unwind(AssertUnwindSafe(||r5_source_policy::operations::dispatch(owner,inputs))){
   Ok(Ok(Some(bytes)))=>{if bytes.is_empty()||bytes.len()>4627{return BOUND}unsafe{(&mut(*out).public_bytes)[..bytes.len()].copy_from_slice(&bytes);(*out).public_size=bytes.len()};OK},
   Ok(Ok(None))=>OK,Ok(Err(code))=>code,Err(_)=>UNKNOWN,
  };
  #[cfg(not(all(feature="abi5-final-native-link",feature="source-server-collector")))]
  {let _=inputs;return 1}
 }

 match catch_unwind(AssertUnwindSafe(||SDK_CUSTODY.with(|sdk|{let mut sdk=sdk.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let original=sdk.get_mut(&(owner as usize)).ok_or(1)?;
  if original.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=r.get_mut(&original.startup).ok_or(UNKNOWN)?;
   if !held.sdk_held||SELECTED_STARTUP.with(|s|s.get())!=Some(original.startup){original.unknown=true;return Err(UNKNOWN)}
   if let Err(status)=selected_current(held){if original.first==OK{original.first=if held.first==OK{status}else{held.first}}original.unknown=true;return Err(UNKNOWN)}
   
   if matches!(action,0|1|3){
    if held.pairs.iter().any(Option::is_none){return Err(1)}
    let status=original.execution.custody_current();
    if status!=OK{let cause=original.execution.first_failure();if original.first==OK{original.first=if cause==OK{status}else{cause}}if status==UNKNOWN{original.unknown=true}return Err(status)}
    if action==0{
     let manifest=read_only_inputs.as_ref().and_then(Option::as_ref).ok_or(BOUND)?;
     // This is the exact already selected private Source, never a JS Root grant.
     held.source.match_selected_manifest(manifest).map_err(evidence_status)?;
    }
    // selected_current rechecks both independently registered enrollment domains,
    // the actual sealed pairs and account before AND after transport callbacks.
    if let Err(status)=selected_current(held){if original.first==OK{original.first=if held.first==OK{status}else{held.first}}original.unknown=true;return Err(UNKNOWN)}
    return Ok(())
   }
   if matches!(action,7|8){
    let(encoded,frame,signature)=verification_inputs.as_ref().ok_or(BOUND)?;
    use base64::{Engine as _,engine::general_purpose::STANDARD};
    let expected=STANDARD.decode(encoded).map_err(|_|BOUND)?;
    if STANDARD.encode(&expected).as_bytes()!=encoded.as_slice()||expected.len()!=if action==7{33}else{2592}{return Err(BOUND)}
    // Exactly one held role must own the requested original frame/key. A
    // caller-provided public key is comparison input, never key selection.
    let mut result=None;
    for pair in held.pairs.iter_mut().flatten(){
     match pair.verify_r5_original(action==8,&expected,&frame,&signature){Ok(v)=>{if result.is_some(){return Err(MISMATCH)}result=Some(v)},Err(crate::source_infrastructure::SourceError::Pair)=>{},Err(e)=>{let cause=custody_status(e);if original.first==OK{original.first=cause}original.unknown=true;return Err(UNKNOWN)}}
    }
    let verified=result.ok_or(MISMATCH)?;
    if let Err(cause)=selected_current(held){if original.first==OK{original.first=cause}original.unknown=true;return Err(UNKNOWN)}
    unsafe{(*out).verified=i32::from(verified)};return Ok(())
   }
   let status=original.execution.action_status(action);
   if status==OK{Ok(())}else{if original.first==OK{original.first=status}if status==UNKNOWN{original.unknown=true}Err(status)}
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_custody_close(owner:*mut *mut c_void)->i32{
 if owner.is_null()||(owner as usize)%std::mem::align_of::<*mut c_void>()!=0||region(owner.cast(),std::mem::size_of::<*mut c_void>()).is_none(){return BOUND}
 // The validated pointer is a caller-owned output SLOT, never the holder.
 // Resolve it once; keep the slot and actual SDK owner until full close below.
 let holder=unsafe{*owner};let id=holder as usize;if id==0{return OK}
 // Do not drain unrelated Source children while a real Message3/first-device
 // reader still pins this SDK. Refusal leaves all original children intact.
 let pin_status=catch_unwind(AssertUnwindSafe(||SDK_CUSTODY.with(|rows|{let rows=rows.try_borrow().map_err(|_|UNKNOWN)?;
  let held=rows.get(&id).ok_or(1)?;if !held.message3_pins.is_empty(){return Err(6)}Ok(())})));
 match pin_status{Ok(Ok(()))=>{},Ok(Err(code))=>return code,Err(_)=>return UNKNOWN}
 #[cfg(all(feature="abi5-final-native-link",feature="source-server-collector"))]
 match catch_unwind(AssertUnwindSafe(||r5_source_policy::operations::drain(holder))){
  Ok(Ok(()))=>{},Ok(Err(code))=>return code,Err(_)=>return UNKNOWN,
 }
 if let Err(status)=r5_source_policy::check_unborrowed(id){return status}
 match catch_unwind(AssertUnwindSafe(||SDK_CUSTODY.with(|sdk|{let mut sdk=sdk.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let original=sdk.get_mut(&id).ok_or(1)?;
  if !original.message3_pins.is_empty(){return Err(6)}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=r.get_mut(&original.startup).ok_or(UNKNOWN)?;
   if !held.sdk_held{original.unknown=true;return Err(UNKNOWN)}
   // A real core operation retains this startup's signing material. Refuse
   // disposal before touching transport or keys; the child must close first.
   #[cfg(feature="source-server-collector")]
   let attached=original.first_server_parent;
   #[cfg(not(feature="source-server-collector"))]
   if held.core_borrows!=0{return Err(6)}
   #[cfg(feature="source-server-collector")]
   if let Some((parent,policy))=attached{
    if held.core_borrows!=1{return Err(6)}
    FIRST_SERVER_STARTUPS.with(|parents|{let parents=parents.try_borrow().map_err(|_|UNKNOWN)?;
     let actual=parents.get(&parent).ok_or(UNKNOWN)?;if actual.child!=Some(id)||actual.startup!=original.startup{return Err(MISMATCH)}
     CORE_LOANS_V2.with(|loans|{let loans=loans.try_borrow().map_err(|_|UNKNOWN)?;let loan=loans.get(&policy).ok_or(UNKNOWN)?;
      if loan.children!=1||loan.startup!=original.startup{return Err(6)}Ok(())})})?;
   }else if held.core_borrows!=0{return Err(6)}
   // Ambiguous independent lease is retained BEFORE releasing signing keys.
   if let Err(cause)=original.execution.close_local(){
    let first=original.execution.first_failure();
    let first=if first==OK{cause}else{first};
    if held.first==OK{held.first=first}held.unknown=true;
    if original.first==OK{original.first=first}original.unknown=true;
    #[cfg(feature="source-server-collector")]
    if let Some((parent,_))=attached{let _=FIRST_SERVER_STARTUPS.with(|r|{if let Ok(mut r)=r.try_borrow_mut(){if let Some(owner)=r.get_mut(&parent){if owner.first==OK{owner.first=first}owner.unknown=true}}});}
    return Err(UNKNOWN)
   }
   #[cfg(feature="source-server-collector")]
   if let Some((parent,policy))=attached{
    // Parent owns the actual selected pairs. Release only this child and its
    // exact core lifetime reference; never close or replace the parent's keys.
    FIRST_SERVER_STARTUPS.with(|parents|{let mut parents=parents.try_borrow_mut().map_err(|_|UNKNOWN)?;
     let actual=parents.get_mut(&parent).ok_or(UNKNOWN)?;if actual.child!=Some(id){return Err(UNKNOWN)}
     CORE_LOANS_V2.with(|loans|{let mut loans=loans.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=loans.get_mut(&policy).ok_or(UNKNOWN)?;
      if loan.children!=1{return Err(UNKNOWN)}loan.children-=1;actual.child=None;Ok(())})})?;
    return Ok(())
   }
   for pair in &mut held.pairs{
    if let Some(pair)=pair.as_mut(){if let Err(cause)=catch_unwind(AssertUnwindSafe(||pair.close())).unwrap_or(Err(crate::source_infrastructure::SourceError::Foreign(UNKNOWN))).map_err(custody_status){if held.first==OK{held.first=cause}held.unknown=true;if original.first==OK{original.first=cause}original.unknown=true;return Err(UNKNOWN)}}
    *pair=None;
   }
   // Pair cleanup cannot dispose an ambiguous independent execution lease.
   held.sdk_held=false;Ok(())
  })?;
  sdk.remove(&id);unsafe{*owner=std::ptr::null_mut()};Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Fixed Native protection loader, not N-API acquire arguments. The public
// certificate and named private client object are independent of both role
// wrapping objects. This acquires transport custody only, NEVER store grant.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_startup_transport_client_bind_v1(
 owner:*mut c_void,role:u32,input:*const crate::source_infrastructure::MessageSealedRawInput,
 certificate:NativeOriginalSpan,certificate_digest:*const u8)->i32{
 if !(1..=2).contains(&role)||input.is_null()||(input as usize)%std::mem::align_of::<crate::source_infrastructure::MessageSealedRawInput>()!=0||region(input.cast(),std::mem::size_of::<crate::source_infrastructure::MessageSealedRawInput>()).is_none()||region(certificate_digest,32).is_none(){return BOUND}
 match catch_unwind(AssertUnwindSafe(||STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let held=r.get_mut(&(owner as usize)).ok_or(1)?;if !held.selected||held.sdk_held||held.core_borrows!=0||held.clients[(role-1)as usize].is_some(){return Err(MISMATCH)}
  selected_current(held)?;let input=unsafe{&*input};
  for field in &input.fields{if field.size==0||field.size>4096||region(field.raw,field.size).is_none(){return Err(BOUND)}}
  let object=unsafe{std::slice::from_raw_parts(input.fields[8].raw,input.fields[8].size)};
  let enrollment=held.enrollment.as_ref().ok_or(1)?;
  for (raw,prefix,role) in [(&enrollment.issuer_current,&enrollment.issuer_predecessors,1),(&enrollment.anchor_current,&enrollment.anchor_predecessors,2)]{
   use sha2::{Digest,Sha256};let digest:String=Sha256::digest(raw.as_slice()).iter().map(|b|format!("{b:02x}")).collect();let prefix:Vec<&[u8]>=prefix.iter().map(|b|b.as_slice()).collect();
   let verified=crate::message_enrollment::verify_startup(&held.source,raw,&prefix,role,&digest).map_err(evidence_status)?;
   let reused=verified.with_sealed_custody_input(|selected|unsafe{std::slice::from_raw_parts(selected.fields[8].raw,selected.fields[8].size)}==object).map_err(evidence_status)?;
   if reused{return Err(MISMATCH)}
  }
  let certificate=public_span(certificate.data,certificate.size)?;if certificate.len()>65536{return Err(BOUND)}
  let digest:&[u8;32]=unsafe{std::slice::from_raw_parts(certificate_digest,32)}.try_into().map_err(|_|BOUND)?;
  let status=match crate::source_infrastructure::MessageTransportClient::open(input,certificate,digest){Ok(client)=>{held.clients[(role-1)as usize]=Some(client);OK},Err((status,client))=>{held.clients[(role-1)as usize]=Some(client);status}};
  // Adopt partial resource before any late Source/account current failure.
  let late=selected_current(held);if status!=OK{if held.first==OK{held.first=status}if status!=1{held.unknown=true}return Err(status)}late?;Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(st))=>st,Err(_)=>UNKNOWN}
}
// Static Native normal execution entry. No Java/JS export, permission output,
// function-pointer installer or public Expected. Exact wire comes from the
// retained original driver; observations remain unadmitted in this SDK owner.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_custody_execution_dispatch_v1(owner:*mut c_void,role:u32,original:NativeOriginalSpan,budget_ns:u64)->i32{
 if !(1..=2).contains(&role)||budget_ns==0||budget_ns>30000000000{return BOUND}
 match catch_unwind(AssertUnwindSafe(||SDK_CUSTODY.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let owned=r.get_mut(&(owner as usize)).ok_or(1)?;
  if original.size==0||original.size>4194304+80||region(original.data,original.size).is_none(){return Err(if owned.unknown{UNKNOWN}else{BOUND})}
  let raw=unsafe{std::slice::from_raw_parts(original.data,original.size)};
  let(request,expected)=crate::message_execution::Request::original(raw).map_err(|s|if owned.unknown{UNKNOWN}else{s})?;
  // Observation of the retained original is permitted only while its actual
  // startup/key owners still pass current. It cannot replay or clear UNKNOWN.
  if owned.unknown&&request.action!=crate::message_execution::Action::QueryClose{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let startup=r.get_mut(&owned.startup).ok_or(UNKNOWN)?;
   if !startup.sdk_held||SELECTED_STARTUP.with(|s|s.get())!=Some(owned.startup){return Err(UNKNOWN)}
   selected_current(startup)?;
   let outcome=owned.execution.dispatch((role-1)as usize,request,&expected,std::time::Duration::from_nanos(budget_ns));
   // Hold response first, then recheck actual account/credential/key owners.
   let late=selected_current(startup);if let Err(st)=outcome{if owned.first==OK{owned.first=st}if st!=1{owned.unknown=true}return Err(if owned.unknown{UNKNOWN}else{st})}
   if let Err(st)=late{if owned.first==OK{owned.first=st}owned.unknown=true;return Err(UNKNOWN)}
   if owned.unknown{return Err(UNKNOWN)}Ok(())
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(st))=>st,Err(_)=>UNKNOWN}
}

// Server startup borrowing is independent of remote SDK admission: it cannot
// call SDK acquire to obtain the Source keys needed to bootstrap that acquire.
// This lease only pins actual private pairs; it does NOT admit a floor/store.
struct ServerStartupBorrow{startup:usize,role:u32,first:i32,unknown:bool,prekey_original:Option<usize>}
thread_local!{static SERVER_STARTUP_BORROWS:RefCell<BTreeMap<usize,Box<ServerStartupBorrow>>>=RefCell::new(BTreeMap::new());}
// A first-device tag is created only by the actual first-server C owner after
// acquiring its real exclusive startup. A pointer, Root, or JS selector cannot
// install this parent. The future same-participant child remains separately
// counted; neither this map nor its absence grants Source rights.
#[cfg(feature="source-server-collector")]
struct FirstServerStartupParent{startup:usize,child:Option<usize>,first:i32,unknown:bool}
#[cfg(feature="source-server-collector")]
thread_local!{static FIRST_SERVER_STARTUPS:RefCell<BTreeMap<usize,FirstServerStartupParent>>=RefCell::new(BTreeMap::new());}
#[cfg(feature="source-server-collector")]
pub(crate)fn selected_first_server_startup()->Result<usize,i32>{
 let selected=SELECTED_STARTUP.with(|v|v.get()).ok_or(1)?;
 FIRST_SERVER_STARTUPS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;
  let mut found=r.iter().filter(|(_,p)|p.startup==selected);
  let(id,p)=found.next().ok_or(1)?;if found.next().is_some(){return Err(MISMATCH)}
  if p.unknown{return Err(if p.first==OK{UNKNOWN}else{p.first})}
  SERVER_STARTUP_BORROWS.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;
   let physical=s.get(id).ok_or(UNKNOWN)?;
   if physical.startup!=selected||physical.unknown||physical.prekey_original.is_some(){return Err(MISMATCH)}Ok(*id)
  })
 })
}


// Select only an already-verified FirstDeviceCore linked to the physical
// first-server startup. No public label, nonce or pointer creates this join.
#[cfg(feature="source-server-collector")]
fn first_server_sdk_candidate(selected:usize)->Result<Option<(usize,usize)>,i32>{
 let parent=FIRST_SERVER_STARTUPS.with(|p|{let p=p.try_borrow().map_err(|_|UNKNOWN)?;
  let mut found=p.iter().filter(|(_,v)|v.startup==selected);
  let Some((id,v))=found.next()else{return Ok(None)};
  if found.next().is_some()||v.child.is_some(){return Err(MISMATCH)}
  if v.unknown{return Err(if v.first==OK{UNKNOWN}else{v.first})}Ok(Some(*id))
 })?;
 let Some(parent)=parent else{return Ok(None)};
 let (policy,link)=CORE_LOANS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;
  let mut found=None;
  for(id,loan)in r.iter(){if loan.startup!=selected||loan.purpose!=CorePurposeV2::FirstDeviceCore{continue}
   let Some(link)=loan.first_public.as_ref().and_then(|p|p.server_link.as_ref())else{continue};
   if link.first_server_startup()!=parent{continue}
   if found.is_some(){return Err(MISMATCH)}
   if loan.unknown{return Err(if loan.first==OK{UNKNOWN}else{loan.first})}
   found=Some((*id,link.clone()));
  }found.ok_or(1)
 })?;
 link.current()?;
 if selected_first_server_startup()?!=parent{return Err(MISMATCH)}
 Ok(Some((parent,policy)))
}
#[cfg(feature="source-server-collector")]
fn first_server_sdk_child_current(holder:usize)->Result<(),i32>{
 let parent=SDK_CUSTODY.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;
  let held=s.get(&holder).ok_or(1)?;if held.unknown{return Err(if held.first==OK{UNKNOWN}else{held.first})}Ok(held.first_server_parent)})?;
 let Some((parent,policy))=parent else{return Ok(())};
 FIRST_SERVER_STARTUPS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;
  let held=r.get(&parent).ok_or(UNKNOWN)?;if held.unknown{return Err(if held.first==OK{UNKNOWN}else{held.first})}
  if held.child!=Some(holder){return Err(MISMATCH)}Ok(())})?;
 let link=CORE_LOANS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&policy).ok_or(UNKNOWN)?;
  if loan.unknown{return Err(if loan.first==OK{UNKNOWN}else{loan.first})}
  let link=loan.first_public.as_ref().and_then(|p|p.server_link.as_ref()).ok_or(1)?;
  if link.first_server_startup()!=parent{return Err(MISMATCH)}Ok(link.clone())})?;
 link.current()?;
 FIRST_SERVER_STARTUPS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let held=r.get(&parent).ok_or(UNKNOWN)?;
  if held.unknown||held.child!=Some(holder){return Err(UNKNOWN)}Ok(())})
}

// Recognition for a one-time native C ownership move. This does not clear
// uncertainty, test current or grant execution; foreign references are rejected
// before dereference. The exclusive same selected startup remains pinned.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_startup_recognize_v1(owner:*mut c_void,role:u32)->i32{
 if !(1..=2).contains(&role){return BOUND}
 match catch_unwind(AssertUnwindSafe(||SERVER_STARTUP_BORROWS.with(|r|{
  let r=r.try_borrow().map_err(|_|UNKNOWN)?;let original=r.get(&(owner as usize)).ok_or(1)?;
  if original.role!=role{return Err(MISMATCH)}
  STARTUP_EVIDENCE.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;let held=s.get(&original.startup).ok_or(UNKNOWN)?;
   if !held.sdk_held||!held.selected||SELECTED_STARTUP.with(|s|s.get())!=Some(original.startup){return Err(MISMATCH)}Ok(())})
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_startup_borrow_v1(role:u32,out:*mut *mut c_void)->i32{
 if !(1..=2).contains(&role)||out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 if unsafe{!(*out).is_null()}{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let selected=SELECTED_STARTUP.with(|s|s.get()).ok_or(1)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&selected).ok_or(1)?;
   if !held.selected||held.sdk_held||held.core_borrows!=0{return Err(MISMATCH)}
   selected_current(held)?;if held.pairs.iter().any(Option::is_none){return Err(1)}
   SERVER_STARTUP_BORROWS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
    if r.len()>=2{return Err(BOUND)}
    let original=Box::new(ServerStartupBorrow{startup:selected,role,first:OK,unknown:false,prekey_original:None});
    let id=(&*original as *const ServerStartupBorrow)as usize;if r.contains_key(&id){return Err(UNKNOWN)}
    held.sdk_held=true;r.insert(id,original);unsafe{*out=id as *mut c_void};
    if let Err(cause)=selected_current(held){let original=r.get_mut(&id).ok_or(UNKNOWN)?;original.first=cause;original.unknown=true;return Err(UNKNOWN)}Ok(())
   })
  })
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
// Actual first-server C factory only. Adopt any real partial before returning
// its status; this tag identifies lifetime, not a grant or a second startup.
#[cfg(feature="source-server-collector")]
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_first_server_startup_borrow_v1(role:u32,out:*mut *mut c_void)->i32{
 if !(1..=2).contains(&role)||out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 // A pre-existing pointer belongs to its caller, never this factory. Do not
 // mistake a generic borrow's BOUND result for a newly published partial.
 if unsafe{!(*out).is_null()}{return BOUND}
 let status=unsafe{ynx_sdk_server_startup_borrow_v1(role,out)};
 let id=unsafe{*out}as usize;if id==0{return status}
 let captured=catch_unwind(AssertUnwindSafe(||{
  let startup=SERVER_STARTUP_BORROWS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;
   let held=r.get(&id).ok_or(UNKNOWN)?;if held.role!=role||held.prekey_original.is_some(){return Err(MISMATCH)}Ok(held.startup)})?;
  FIRST_SERVER_STARTUPS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
   if r.contains_key(&id)||r.values().any(|p|p.startup==startup){return Err(MISMATCH)}
   r.insert(id,FirstServerStartupParent{startup,child:None,first:if status==OK{OK}else{status},unknown:status!=OK});Ok(())
  })
 }));
 match captured{Ok(Ok(()))=>status,_=>UNKNOWN}
}
#[cfg(feature="source-server-collector")]
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_first_server_startup_children_can_close_v1(owner:*mut c_void)->i32{
 match catch_unwind(AssertUnwindSafe(||FIRST_SERVER_STARTUPS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;
  let id=owner as usize;
  if let Some(parent)=r.get(&id){if parent.child.is_some(){return Err(6)}}else{
   // A late failure can leave the real exclusive borrow published before its
   // tag was installed. Permit only physical cleanup after independently
   // proving that no SDK/core child exists for that same selected startup.
   let startup=SERVER_STARTUP_BORROWS.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;
    let original=s.get(&id).ok_or(UNKNOWN)?;if original.prekey_original.is_some(){return Err(UNKNOWN)}Ok(original.startup)})?;
   if r.values().any(|p|p.startup==startup){return Err(UNKNOWN)}
   SDK_CUSTODY.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;
    if s.values().any(|child|child.startup==startup){return Err(6)}Ok(())})?;
   return CORE_LOANS_V2.with(|l|{let l=l.try_borrow().map_err(|_|UNKNOWN)?;
    if l.values().any(|loan|loan.startup==startup){return Err(6)}Ok(())});
  }
  CORE_LOANS_V2.with(|loans|{let loans=loans.try_borrow().map_err(|_|UNKNOWN)?;
   if loans.values().any(|loan|loan.first_public.as_ref().and_then(|p|p.server_link.as_ref()).is_some_and(|link|link.first_server_startup()==owner as usize)){return Err(6)}Ok(())})
 }))){Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}

#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_startup_current_v1(owner:*mut c_void,role:u32)->i32{
 match catch_unwind(AssertUnwindSafe(||SERVER_STARTUP_BORROWS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let original=r.get_mut(&(owner as usize)).ok_or(1)?;if original.role!=role{return Err(MISMATCH)}if original.unknown{return Err(UNKNOWN)}
  if let Some(parent)=original.prekey_original{let s=prekey_server_original_ffi::startup_parent_current(parent,original.startup,role);if s!=OK{if original.first==OK{original.first=s}original.unknown=true;return Err(UNKNOWN)}}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&original.startup).ok_or(UNKNOWN)?;
   if !held.sdk_held||SELECTED_STARTUP.with(|s|s.get())!=Some(original.startup){if original.first==OK{original.first=UNKNOWN}original.unknown=true;return Err(UNKNOWN)}
   if let Err(cause)=selected_current(held){if original.first==OK{original.first=cause}original.unknown=true;return Err(UNKNOWN)}Ok(())
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
fn server_endpoint_original(owner:*mut c_void,role:u32)->Result<String,i32>{
 let selected=SERVER_STARTUP_BORROWS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let original=r.get(&(owner as usize)).ok_or(1)?;if original.role!=role||original.unknown{return Err(UNKNOWN)}Ok(original.startup)})?;
 STARTUP_EVIDENCE.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let held=r.get(&selected).ok_or(UNKNOWN)?;
  let records=held.enrollment.as_ref().ok_or(1)?;let (raw,history)=if role==1{(&records.issuer_current,&records.issuer_predecessors)}else{(&records.anchor_current,&records.anchor_predecessors)};
  use sha2::{Digest,Sha256};let digest:String=Sha256::digest(raw).iter().map(|b|format!("{b:02x}")).collect();let prefix:Vec<&[u8]>=history.iter().map(|b|b.as_slice()).collect();
  let verified=crate::message_enrollment::verify_startup(&held.source,raw,&prefix,role as u8,&digest).map_err(evidence_status)?;Ok(verified.registration.protected_service_endpoint.clone())
 })
}
// Routing observation from the SAME exclusive original. It grants neither
// administration admission nor TLS/storage/floor custody and cannot pick Root.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_endpoint_port_v1(owner:*mut c_void,role:u32,out:*mut u16)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<u16>()!=0||!(1..=2).contains(&role){return BOUND}
 unsafe{*out=0};let current=unsafe{ynx_sdk_server_startup_current_v1(owner,role)};if current!=OK{return current}
 match catch_unwind(AssertUnwindSafe(||{
  let endpoint=server_endpoint_original(owner,role)?;
  let port=(||{
   let authority=endpoint.strip_prefix("https://").ok_or(MISMATCH)?.split('/').next().ok_or(MISMATCH)?;
   let port_text=if authority.starts_with('['){let (_,suffix)=authority.split_once(']').ok_or(MISMATCH)?;if suffix.is_empty(){None}else{Some(suffix.strip_prefix(':').ok_or(MISMATCH)?)}}
    else{let mut parts=authority.split(':');let host=parts.next().ok_or(MISMATCH)?;if host.is_empty(){return Err(MISMATCH)}let port=parts.next();if parts.next().is_some(){return Err(MISMATCH)}port};
   match port_text{None=>Ok(443),Some(text)=>{let n=text.parse::<u16>().map_err(|_|BOUND)?;if n==0||n.to_string()!=text{return Err(MISMATCH)}Ok(n)}}
  })()?;
  let late=unsafe{ynx_sdk_server_startup_current_v1(owner,role)};if late!=OK{return Err(late)}unsafe{*out=port};Ok(())
 })){Ok(Ok(()))=>OK,Ok(Err(st))=>st,Err(_)=>UNKNOWN}
}
fn server_request_header_shape(endpoint:&str,header:&str)->Result<usize,i32>{
 let tail=endpoint.strip_prefix("https://").ok_or(MISMATCH)?;
  let (authority,path)=match tail.split_once('/') {Some((a,p))=>(a,format!("/{p}")),None=>(tail,"/".into())};
  if authority.starts_with('['){return Err(MISMATCH)}let mut parts=authority.split(':');let host=parts.next().ok_or(MISMATCH)?;let _port=parts.next();if parts.next().is_some()||host.is_empty()||!host.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||matches!(b,b'.'|b'-')){return Err(MISMATCH)}
  let begin=format!("POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/octet-stream\r\nContent-Length: ");
  let text=header.strip_prefix(&begin).and_then(|v|v.strip_suffix("\r\nConnection: close\r\n\r\n")).ok_or(MISMATCH)?;
  let size=text.parse::<usize>().map_err(|_|BOUND)?;if size.to_string()!=text||!(516..=4194384).contains(&size){return Err(BOUND)}
 Ok(size)
}
// Exact normal private HTTP framing; no aliases/extra headers/pipelining. This
// binds only transport routing and byte capture, never permissions from Host.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_request_header_validate_v1(owner:*mut c_void,role:u32,raw:NativeOriginalSpan,out:*mut usize)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<usize>()!=0||!(1..=2).contains(&role)||raw.size==0||raw.size>16384{return BOUND}
 unsafe{*out=0};let current=unsafe{ynx_sdk_server_startup_current_v1(owner,role)};if current!=OK{return current}
 match catch_unwind(AssertUnwindSafe(||{
  let bytes=public_span(raw.data,raw.size)?;let header=std::str::from_utf8(bytes).map_err(|_|MISMATCH)?;
  let endpoint=server_endpoint_original(owner,role)?;let size=server_request_header_shape(&endpoint,header)?;
  let late=unsafe{ynx_sdk_server_startup_current_v1(owner,role)};if late!=OK{return Err(late)}unsafe{*out=size};Ok(())
 })){Ok(Ok(()))=>OK,Ok(Err(st))=>st,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_startup_release_v1(owner:*mut *mut c_void)->i32{
 if owner.is_null()||(owner as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let id=unsafe{*owner}as usize;if id==0{return OK}
 #[cfg(feature="source-server-collector")]
 {let tagged=catch_unwind(AssertUnwindSafe(||FIRST_SERVER_STARTUPS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;Ok::<_,i32>(r.contains_key(&id))})));
  let tagged=match tagged{Ok(Ok(v))=>v,Ok(Err(code))=>return code,Err(_)=>return UNKNOWN};
  if tagged{let code=unsafe{ynx_sdk_first_server_startup_children_can_close_v1(id as *mut c_void)};if code!=OK{return code}}}
 match catch_unwind(AssertUnwindSafe(||SERVER_STARTUP_BORROWS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let original=r.get(&id).ok_or(1)?;
  // Reserve the tag registry before touching physical parent state; failure
  // cannot leave sdk_held cleared while the original tag is still retained.
  let finish=||STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=s.get_mut(&original.startup).ok_or(UNKNOWN)?;
   if !held.sdk_held{return Err(UNKNOWN)}
   if original.unknown{if held.first==OK{held.first=original.first}held.unknown=true;}
   let last=match original.prekey_original{Some(parent)=>prekey_server_original_ffi::release_startup_child(parent,original.startup,original.role)?,None=>true};
   if last{held.sdk_held=false;}Ok(())
  });
  #[cfg(feature="source-server-collector")]
  FIRST_SERVER_STARTUPS.with(|tags|{let mut tags=tags.try_borrow_mut().map_err(|_|UNKNOWN)?;
   finish()?;tags.remove(&id);Ok::<_,i32>(())})?;
  #[cfg(not(feature="source-server-collector"))]
  finish()?;
  r.remove(&id);unsafe{*owner=std::ptr::null_mut()};Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

fn server_resource_names_shape(names:&[[u8;34];3])->Result<(),i32>{
 for(i,name)in names.iter().enumerate(){if name[..2]!=[0,11]||name[2..].iter().all(|v|*v==0)||names[..i].iter().any(|prior|prior==name){return Err(MISMATCH)}}Ok(())
}
fn server_resource_not_wrapping(names:&[[u8;34];3],wrapping:&[u8])->Result<(),i32>{
 if wrapping.len()!=34||names.iter().any(|name|name.as_slice()==wrapping){return Err(MISMATCH)}Ok(())
}
// PRIVATE retention format, never a signed grant. Fifteen complete originals,
// fixed positional semantic slots; lengths are BE32 and no trailing bytes.
const SERVER_ROW_FIELDS:usize=15;
fn server_registered_row<'a>(raw:&'a[u8],role:u32,kinds:[u32;3])->Result<[&'a[u8];SERVER_ROW_FIELDS],i32>{
 if raw.len()<28||raw.len()>28+SERVER_ROW_FIELDS*(4+65536)||&raw[..8]!=b"YNXREG1\0"{return Err(BOUND)}
 let word=|n:usize|u32::from_be_bytes(raw[n..n+4].try_into().unwrap());
 if word(8)!=role||word(12)!=SERVER_ROW_FIELDS as u32{return Err(MISMATCH)}
 for i in 0..3{if !(1..=2).contains(&kinds[i])||word(16+i*4)!=kinds[i]{return Err(MISMATCH)}}
 let mut fields=[&raw[..0];SERVER_ROW_FIELDS];let mut cursor=28usize;
 for field in &mut fields{if raw.len()-cursor<4{return Err(BOUND)}let n=u32::from_be_bytes(raw[cursor..cursor+4].try_into().unwrap())as usize;cursor+=4;
  if n==0||n>65536||n>raw.len()-cursor{return Err(BOUND)}*field=&raw[cursor..cursor+n];cursor+=n;}
 if cursor!=raw.len(){return Err(MISMATCH)}Ok(fields)
}
fn server_typed_names_shape(names:&[[u8;34];3],kinds:[u32;3])->Result<(),i32>{
 for i in 0..3{match kinds[i]{1=>{if names[i][..2]!=[0,11]||names[i][2..].iter().all(|v|*v==0){return Err(MISMATCH)}
 for j in 0..i{if kinds[j]==1&&names[j]==names[i]{return Err(MISMATCH)}}},2=>{if names[i].iter().any(|v|*v!=0){return Err(MISMATCH)}},_=>return Err(MISMATCH)}}Ok(())
}
fn server_registered_prefix_matches(raw:&[u8],originals:&[&[u8]])->Result<(),i32>{
 if raw.len()<2||originals.len()>255||u16::from_be_bytes(raw[..2].try_into().unwrap())as usize!=originals.len(){return Err(MISMATCH)}
 let mut at=2usize;for original in originals{if raw.len()-at<4{return Err(BOUND)}let n=u32::from_be_bytes(raw[at..at+4].try_into().unwrap())as usize;at+=4;
  if n==0||n>65536||n>raw.len()-at{return Err(BOUND)}if &raw[at..at+n]!=*original{return Err(MISMATCH)}at+=n;}
 if at!=raw.len(){return Err(MISMATCH)}Ok(())
}
#[repr(C)]
pub(crate) struct NativeServerRegisteredOriginals{
 version:u32,role:u32,association:NativeOriginalSpan,registration:NativeOriginalSpan,
 names:[[u8;34];3],certificate:NativeOriginalSpan,row:NativeOriginalSpan,kinds:[u32;3],
}
// Fixed private Native loader only. These are retained originals/references,
// NOT a registration verifier or a capability installer. No JS entry is exposed.
// Actual Root coverage of the DISTINCT objects remains a constructor obligation.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_registered_originals_retain_v1(owner:*mut c_void,input:*const NativeServerRegisteredOriginals)->i32{
 if input.is_null()||(input as usize)%std::mem::align_of::<NativeServerRegisteredOriginals>()!=0{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let input=unsafe{&*input};if input.version!=1||!(1..=2).contains(&input.role){return Err(BOUND)}
  let association=public_span(input.association.data,input.association.size)?;
  let registration=public_span(input.registration.data,input.registration.size)?;
  let certificate=public_span(input.certificate.data,input.certificate.size)?;
  if association.len()>65536||registration.len()>65536||certificate.len()>16384{return Err(BOUND)}
  let row=public_span(input.row.data,input.row.size)?;
  let fields=server_registered_row(&row,input.role,input.kinds)?;
  // association/client-registration/certificate are matching complete raw inputs.
  if fields[14]!=association||fields[12]!=registration||fields[13]!=certificate{return Err(MISMATCH)}
  server_typed_names_shape(&input.names,input.kinds)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&(owner as usize)).ok_or(1)?;
   if !held.selected||held.sdk_held||held.core_borrows!=0||SELECTED_STARTUP.with(|s|s.get())!=Some(owner as usize){return Err(MISMATCH)}
   selected_current(held)?;let index=(input.role-1)as usize;if held.server_registered[index].is_some(){return Err(MISMATCH)}
   held.source.match_registered_role_original(input.role as u8,fields[2]).map_err(evidence_status)?;
   // No table reference may alias either Source signing/wrapping object.
   let records=held.enrollment.as_ref().ok_or(1)?;
   let (selected_current_original,selected_prefix)=if input.role==1{(&records.issuer_current,&records.issuer_predecessors)}else{(&records.anchor_current,&records.anchor_predecessors)};
   if fields[7]!=selected_current_original.as_slice(){return Err(MISMATCH)}
   let selected_prefix:Vec<&[u8]>=selected_prefix.iter().map(|v|v.as_slice()).collect();
   server_registered_prefix_matches(fields[8],&selected_prefix)?;
   for source_role in 1..=2{
    let raw=if source_role==1{&records.issuer_current}else{&records.anchor_current};
    let history=if source_role==1{&records.issuer_predecessors}else{&records.anchor_predecessors};
    use sha2::{Digest,Sha256};let digest:String=Sha256::digest(raw).iter().map(|b|format!("{b:02x}")).collect();
    let history:Vec<&[u8]>=history.iter().map(|b|b.as_slice()).collect();
    let original=crate::message_enrollment::verify_startup(&held.source,raw,&history,source_role,&digest).map_err(evidence_status)?;
    use base64::{Engine as _,engine::general_purpose::URL_SAFE_NO_PAD};
    let wrapping=URL_SAFE_NO_PAD.decode(&original.registration.object_name).map_err(|_|MISMATCH)?;
    for i in 0..3{if input.kinds[i]==1&&input.names[i].as_slice()==wrapping.as_slice(){return Err(MISMATCH)}}
   }
   held.server_registered[index]=Some(ServerRegisteredOriginals{association:association.into(),registration:registration.into(),names:input.names,certificate:certificate.into(),row:row.into(),kinds:input.kinds,administration:None});
   selected_current(held)?;
   // Preserve retained originals even when release-owned administration policy
   // is absent. A selected witness never substitutes live resource acquisition.
   let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|UNKNOWN)?.as_millis();
   let now=i64::try_from(now).map_err(|_|BOUND)?;
   let policy=held.source.select_administration_policy(input.role as u8,crate::source_evidence::AdministrationOperation::Register,&fields,now).map_err(evidence_status)?;
   held.server_registered[index].as_mut().ok_or(UNKNOWN)?.administration=Some(policy);
   // Protected registry/current-head transaction must still be acquired and
   // consumed; policy selection alone cannot publish an admitted row.
   Err(1)
  })
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[repr(C)]
pub(crate) struct NativeServerOriginalBorrow{association:NativeOriginalSpan,registration:NativeOriginalSpan,names:[[u8;34];3],certificate:NativeOriginalSpan,row:NativeOriginalSpan,kinds:[u32;3]}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_registered_originals_borrow_v1(owner:*mut c_void,out:*mut NativeServerOriginalBorrow)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<NativeServerOriginalBorrow>()!=0{return BOUND}
 let Some(output)=region(out.cast(),std::mem::size_of::<NativeServerOriginalBorrow>())else{return BOUND};
 match catch_unwind(AssertUnwindSafe(||SERVER_STARTUP_BORROWS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let original=r.get_mut(&(owner as usize)).ok_or(1)?;if original.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&original.startup).ok_or(UNKNOWN)?;
   if !held.sdk_held{return Err(UNKNOWN)}if let Err(cause)=selected_current(held){if original.first==OK{original.first=cause}original.unknown=true;return Err(UNKNOWN)}
   let records=held.server_registered[(original.role-1)as usize].as_ref().ok_or(1)?;
   if let Some(policy)=&records.administration{
    let fields=server_registered_row(&records.row,original.role,records.kinds)?;
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|UNKNOWN)?.as_millis();
    let now=i64::try_from(now).map_err(|_|BOUND)?;
    if let Err(cause)=policy.recheck(&held.source,original.role as u8,crate::source_evidence::AdministrationOperation::Register,&fields,now){if original.first==OK{original.first=evidence_status(cause)}original.unknown=true;return Err(UNKNOWN)}
    // Original head expectation remains private; its equality must be consumed
    // by a real protected registry transaction, never this public-original loan.
    let _protected_head=policy.protected_head_expectation();
   }

   for b in [&records.association,&records.registration,&records.certificate,&records.row]{if !disjoint(region(b.as_ptr(),b.len()).ok_or(BOUND)?,output){return Err(BOUND)}}
   // Fixed immutable Boxes cannot move/replace while this actual exclusive
   // startup lease is held. Only the same Native caller borrows these originals.
   let value=NativeServerOriginalBorrow{association:NativeOriginalSpan{data:records.association.as_ptr(),size:records.association.len()},registration:NativeOriginalSpan{data:records.registration.as_ptr(),size:records.registration.len()},names:records.names,certificate:NativeOriginalSpan{data:records.certificate.as_ptr(),size:records.certificate.len()},row:NativeOriginalSpan{data:records.row.as_ptr(),size:records.row.len()},kinds:records.kinds};
   if let Err(cause)=selected_current(held){if original.first==OK{original.first=cause}original.unknown=true;return Err(UNKNOWN)}unsafe{out.write(value)};Ok(())
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Private provisioning policy observation from the SAME exclusive original
// startup. These coordinates do not constitute a protected registry owner.
#[repr(C)]
pub(crate) struct NativeAdministrationPolicyHead{generation:u64,head:[u8;32]}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_server_administration_policy_current_v1(owner:*mut c_void,role:u32,out:*mut NativeAdministrationPolicyHead)->i32{
 if !(1..=2).contains(&role)||out.is_null()||(out as usize)%std::mem::align_of::<NativeAdministrationPolicyHead>()!=0{return BOUND}
 let Some(output)=region(out.cast::<u8>(),std::mem::size_of::<NativeAdministrationPolicyHead>())else{return BOUND};
 let prior=unsafe{ynx_sdk_server_startup_current_v1(owner,role)};if prior!=OK{return prior}
 match catch_unwind(AssertUnwindSafe(||SERVER_STARTUP_BORROWS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let original=r.get_mut(&(owner as usize)).ok_or(1)?;if original.role!=role{return Err(MISMATCH)}if original.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&original.startup).ok_or(UNKNOWN)?;
   let records=held.server_registered[(role-1)as usize].as_ref().ok_or(1)?;
   // A private caller still cannot place its output on retained immutable
   // originals. Validate the entire region BEFORE clearing or publishing it.
   for b in [&records.association,&records.registration,&records.certificate,&records.row]{if !disjoint(region(b.as_ptr(),b.len()).ok_or(BOUND)?,output){return Err(BOUND)}}
   unsafe{out.write(NativeAdministrationPolicyHead{generation:0,head:[0;32]})};
   let policy=records.administration.as_ref().ok_or(1)?;
   let fields=server_registered_row(&records.row,role,records.kinds)?;
   let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|UNKNOWN)?.as_millis();let now=i64::try_from(now).map_err(|_|BOUND)?;
   if let Err(e)=policy.recheck(&held.source,role as u8,crate::source_evidence::AdministrationOperation::Register,&fields,now){if original.first==OK{original.first=evidence_status(e)}original.unknown=true;return Err(UNKNOWN)}
   let (generation,head)=policy.protected_head_expectation();
   if let Err(e)=selected_current(held){if original.first==OK{original.first=e}original.unknown=true;return Err(UNKNOWN)}
   unsafe{out.write(NativeAdministrationPolicyHead{generation,head})};Ok(())
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

fn core_origin_span<'a>(raw:&NativeOriginalSpan,output:(usize,usize),limit:usize,total:&mut usize)->Result<&'a[u8],i32>{
 if raw.size>limit{return Err(BOUND)}let r=region(raw.data,raw.size).ok_or(BOUND)?;
 if !disjoint(r,output){return Err(BOUND)}
 *total=total.checked_add(raw.size).filter(|n|*n<=6062112).ok_or(BOUND)?;public_span(raw.data,raw.size)
}
fn core_origin_history<'a>(raw:*const NativeOriginalSpan,count:usize,output:(usize,usize),limit:usize,total:&mut usize)->Result<Vec<&'a[u8]>,i32>{
 if count>255{return Err(BOUND)}
 let slice=if count==0{&[][..]}else{
  let size=count.checked_mul(std::mem::size_of::<NativeOriginalSpan>()).ok_or(BOUND)?;
  if (raw as usize)%std::mem::align_of::<NativeOriginalSpan>()!=0||!disjoint(region(raw.cast(),size).ok_or(BOUND)?,output){return Err(BOUND)}
  unsafe{std::slice::from_raw_parts(raw,count)}
 };
 let mut result=Vec::new();result.try_reserve_exact(count).map_err(|_|BOUND)?;
 for original in slice{result.push(core_origin_span(original,output,limit,total)?);}Ok(result)
}
// A private startup/policy loan pins exact Native provenance. It is deliberately
// NOT a qualified core/store owner; no public caller can publish it as one.
#[repr(C)]
struct NativeCoreOriginInput {
 root:NativeOriginalSpan,registration:NativeOriginalSpan,status:NativeOriginalSpan,
 source:NativeOriginalSpan,namespace_prefix:NativeOriginalSpan,request:NativeOriginalSpan,
 nonce:*const u8,nonce_size:usize,history:*const NativeOriginalSpan,history_count:usize,
 classic:[u8;33],pq:[u8;2592],source_nonce:[u8;32],monotonic_deadline_ns:u64,
}
struct NativeCorePolicyLoan {
 startup:usize,policy:crate::source_evidence::SelectedNativeCorePolicy,
 originals:[Box<[u8]>;6],classic:[u8;33],pq:[u8;2592],source_nonce:[u8;32],account_nonce:[u8;32],
 first:i32,unknown:bool,resource_borrows:usize,deadline:u64,
}
thread_local!{static CORE_POLICY_LOANS:RefCell<BTreeMap<usize,Box<NativeCorePolicyLoan>>>=RefCell::new(BTreeMap::new());}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_policy_borrow_v1(input:*const NativeCoreOriginInput,out:*mut *mut c_void)->i32 {
 if input.is_null()||(input as usize)%std::mem::align_of::<NativeCoreOriginInput>()!=0||out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};
 let Some(i)=region(input.cast(),std::mem::size_of::<NativeCoreOriginInput>())else{return BOUND};if !disjoint(o,i)||unsafe{!(*out).is_null()}{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let input=unsafe{&*input};if input.nonce_size!=32||input.monotonic_deadline_ns==0{return Err(BOUND)}
  let mut now=0u64;let s=unsafe{ynx_source_monotonic_now_v1(&mut now)};if s!=OK{return Err(s)}if now>=input.monotonic_deadline_ns{return Err(5)}let mut total=0;
  let spans=[&input.root,&input.registration,&input.status,&input.source,&input.namespace_prefix,&input.request];
  let limits=[16384,16384,16384,393216,393216,1048576];let mut raw=Vec::with_capacity(6);
  for (span,limit) in spans.into_iter().zip(limits){raw.push(core_origin_span(span,o,limit,&mut total)?);}
  let nonce=core_origin_span(&NativeOriginalSpan{data:input.nonce,size:32},o,32,&mut total)?;
  let prefix:Vec<Zeroizing<Vec<u8>>>=core_origin_history(input.history,input.history_count,o,16384,&mut total)?.into_iter().map(|raw|Zeroizing::new(raw.to_vec())).collect();
  let account_nonce:[u8;32]=nonce.try_into().map_err(|_|BOUND)?;
  let selected=SELECTED_STARTUP.with(|s|s.get()).ok_or(1)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&selected).ok_or(1)?;
   if !held.selected||held.sdk_held||held.core_borrows>=32{return Err(MISMATCH)}selected_current(held)?;
   held.account.as_ref().ok_or(1)?.match_startup_originals(raw[0],raw[1],raw[2],&prefix).map_err(account_status)?;
   let originals:[&[u8];6]=raw.try_into().map_err(|_|BOUND)?;
   let purpose=crate::source_evidence::NativeCorePurpose::FirstDeviceCore;
   let policy=held.source.select_native_core_policy(purpose,&originals,&input.classic,&input.pq,input.source_nonce,account_nonce,crate::source_evidence::now_ms().map_err(evidence_status)?).map_err(evidence_status)?;
   selected_current(held)?;
   CORE_POLICY_LOANS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;if r.len()>=32{return Err(BOUND)}
    let loan=Box::new(NativeCorePolicyLoan{startup:selected,policy,originals:std::array::from_fn(|i|originals[i].into()),classic:input.classic,pq:input.pq,source_nonce:input.source_nonce,account_nonce,first:OK,unknown:false,resource_borrows:0,deadline:input.monotonic_deadline_ns});
    let id=(&*loan as *const NativeCorePolicyLoan)as usize;if r.contains_key(&id){return Err(UNKNOWN)}
    r.insert(id,loan);held.core_borrows+=1;unsafe{*out=id as *mut c_void};Ok(())})
  })
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_policy_current_v1(owner:*mut c_void)->i32 {
 match catch_unwind(AssertUnwindSafe(||CORE_POLICY_LOANS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&(owner as usize)).ok_or(1)?;if loan.unknown{return Err(UNKNOWN)}
  let result=(||{let mut now=0u64;let s=unsafe{ynx_source_monotonic_now_v1(&mut now)};if s!=OK{return Err(s)}if now>=loan.deadline{return Err(5)}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&loan.startup).ok_or(UNKNOWN)?;
   if !held.selected||held.core_borrows==0||SELECTED_STARTUP.with(|s|s.get())!=Some(loan.startup){return Err(MISMATCH)}selected_current(held)?;
   let originals=std::array::from_fn(|i|loan.originals[i].as_ref());loan.policy.recheck(&held.source,crate::source_evidence::NativeCorePurpose::FirstDeviceCore,&originals,&loan.classic,&loan.pq,&loan.source_nonce,&loan.account_nonce,crate::source_evidence::now_ms().map_err(evidence_status)?).map_err(evidence_status)?;
   selected_current(held)
  })})();if let Err(s)=result{if loan.first==OK{loan.first=s}loan.unknown=true;return Err(UNKNOWN)}Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_policy_close_v1(owner:*mut *mut c_void)->i32 {
 if owner.is_null()||(owner as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}let id=unsafe{*owner}as usize;if id==0{return OK}
 match catch_unwind(AssertUnwindSafe(||CORE_POLICY_LOANS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get(&id).ok_or(1)?;if loan.resource_borrows!=0{return Err(MISMATCH)}
  STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=s.get_mut(&loan.startup).ok_or(UNKNOWN)?;if held.core_borrows==0{return Err(UNKNOWN)}held.core_borrows-=1;Ok(())})?;
  let unknown=loan.unknown;r.remove(&id);unsafe{*owner=std::ptr::null_mut()};if unknown{Err(UNKNOWN)}else{Ok(())}
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Exact PRIVATE association expectation only. This is not registered-resource
// authentication, current/floor admission, or a store capability constructor.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_association_matches_v1(owner:*mut c_void,raw:*const u8,n:usize)->i32 {
 if n==0||n>65536||region(raw,n).is_none(){return BOUND}
 let current=unsafe{ynx_sdk_native_core_policy_current_v1(owner)};if current!=OK{return current}
 match catch_unwind(AssertUnwindSafe(||CORE_POLICY_LOANS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(owner as usize)).ok_or(1)?;
  use sha2::{Digest,Sha256};let digest:[u8;32]=Sha256::digest(unsafe{std::slice::from_raw_parts(raw,n)}).into();
  if digest!=loan.policy.resource_association(){return Err(MISMATCH)}Ok(())
 }))){Ok(Ok(()))=>unsafe{ynx_sdk_native_core_policy_current_v1(owner)},Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Child ownership accounting only: neither count nor recognition admits Core.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_resource_retain_v1(owner:*mut c_void)->i32 {
 let s=unsafe{ynx_sdk_native_core_policy_current_v1(owner)};if s!=OK{return s}
 match catch_unwind(AssertUnwindSafe(||CORE_POLICY_LOANS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&(owner as usize)).ok_or(1)?;if loan.resource_borrows>=32{return Err(BOUND)}loan.resource_borrows+=1;Ok(())}))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_resource_release_v1(owner:*mut c_void)->i32 {
 // Cleanup-only: no business current/renewal/reacquisition requirement.
 match catch_unwind(AssertUnwindSafe(||CORE_POLICY_LOANS.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&(owner as usize)).ok_or(1)?;if loan.resource_borrows==0{return Err(MISMATCH)}loan.resource_borrows-=1;Ok(())}))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

unsafe extern "C"{fn ynx_source_monotonic_now_v1(out:*mut u64)->i32;}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_deadline_borrow_v1(owner:*mut c_void,out:*mut u64)->i32 {
 if out.is_null()||(out as usize)%std::mem::align_of::<u64>()!=0{return BOUND}unsafe{*out=0};let s=unsafe{ynx_sdk_native_core_policy_current_v1(owner)};if s!=OK{return s}
 match catch_unwind(AssertUnwindSafe(||CORE_POLICY_LOANS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(owner as usize)).ok_or(1)?;unsafe{*out=loan.deadline};Ok(())}))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// PRIVATE v2 normal NativeCore permission boundary; no public importer or
// callback approval. IDs recognize this worker's retained original record only.
use crate::source_evidence::native_core_rights_v2::{CorePurposeV2,CoreOperationV2,CoreOriginalIntakeV2};
#[derive(Clone)]
struct NativeCoreAuthenticatedPlaneOriginalsV2{approval:Box<[u8]>,issuer_current:Box<[u8]>,anchor_current:Box<[u8]>}
struct NativeCoreContextV2{authenticated:NativeCoreAuthenticatedPlaneOriginalsV2,association:Box<[u8]>,account:Box<[u8]>,storage_generation:u64,origin:Option<NativeCoreRetainedOriginV2>,relation:Option<Box<[u8]>>}
struct NativeCoreRetainedOriginV2{originals:[Box<[u8]>;6]}
#[repr(C)]pub(crate) struct NativeCoreBorrowRequestV2{version:u32,size:u32,purpose:u32,operation:u32,key_uses:u32,required_operations:u32,context_id:u64,context_generation:u64,deadline:u64,intent_digest:[u8;32]}
#[repr(C)]pub(crate) struct NativeCoreRightsRefV2{version:u32,size:u32,purpose:u32,operation:u32,borrow_id:u64,parent_generation:u64}
// Private same-candidate carrier extension; not an SDK authority operand.
#[repr(C)]pub(crate) struct NativeCoreOriginalInputV2{request:NativeCoreBorrowRequestV2,original:NativeCoreOriginInput,android_own_key_platform:*mut c_void}
// Public originals from the very same successful native intake. This is not a
// proof, authority or permission. Never fill it from a later JS/Java sign call.
struct NativeCoreFirstPublicOriginalV2{
 classic:[u8;33],pq:Box<[u8;2592]>,account_nonce:[u8;32],source_nonce:[u8;32],
 origin:[Box<[u8]>;6],
 #[cfg(feature="source-collector-bridge")]
 server_link:Option<crate::source_infrastructure::ServerCoreLink>,
}
impl NativeCoreFirstPublicOriginalV2{
 fn match_device(&self,expected:&[u8;32])->Result<(),i32>{
  use sha2::{Digest,Sha256};
  let mut hash=Sha256::new();hash.update(self.classic);hash.update(self.pq.as_ref());
  if self.classic[0]!=5||<[u8;32]>::from(hash.finalize())!=*expected{return Err(MISMATCH)}
  Ok(())
 }
}
#[cfg(feature="abi5-final-native-link")]#[path="own_records_context.rs"]pub(crate)mod own_records_context;
struct NativeCoreLoanV2{startup:usize,id:[u8;32],operation_original:Box<[u8]>,purpose:CorePurposeV2,operation:CoreOperationV2,first:i32,unknown:bool,deadline:u64,children:usize,session_parent:Option<usize>,
 #[cfg(feature="abi5-final-native-link")]own_records_parent:Option<usize>,
 authenticated_originals:Option<NativeCoreAuthenticatedPlaneOriginalsV2>,
 first_public:Option<NativeCoreFirstPublicOriginalV2>,
 #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
 business_seed:Option<crate::private_custodian_ffi::NativeFirstDeviceBusinessSeed>,
 #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="predevice-initial-prekeys-v1"))]
 registered_initial_seed:Option<crate::private_custodian_ffi::RegisteredInitializationSeed>,
}
#[cfg(test)]mod first_public_original_controls{
 use super::*;
 fn original()->NativeCoreFirstPublicOriginalV2{
  let mut classic=[1;33];classic[0]=5;
  NativeCoreFirstPublicOriginalV2{classic,pq:Box::new([2;2592]),account_nonce:[3;32],source_nonce:[4;32],origin:std::array::from_fn(|i|vec![i as u8;8].into_boxed_slice()),#[cfg(feature="source-collector-bridge")]server_link:None}
 }
 fn digest(v:&NativeCoreFirstPublicOriginalV2)->[u8;32]{
  use sha2::{Digest,Sha256};let mut h=Sha256::new();h.update(v.classic);h.update(v.pq.as_ref());h.finalize().into()
 }
 #[test]fn retained_device_bytes_match_only_original_binding(){
  let mut v=original();let expected=digest(&v);assert_eq!(v.match_device(&expected),Ok(()));
  v.pq[100]^=1;assert_eq!(v.match_device(&expected),Err(MISMATCH));
  v.pq[100]^=1;v.classic[4]^=1;assert_eq!(v.match_device(&expected),Err(MISMATCH));
  assert_eq!(v.account_nonce,[3;32]);assert_eq!(v.source_nonce,[4;32]);
 }
 #[test]fn invalid_classic_encoding_is_not_admitted_by_digest_match(){
  let mut v=original();v.classic[0]=0;assert_eq!(v.match_device(&digest(&v)),Err(MISMATCH));
 }
 #[test]fn nonce_span_bounds_and_output_alias_are_rejected_before_copy(){
  let mut total=0;let output=(100usize,108usize);
  assert!(core_origin_span(&NativeOriginalSpan{data:std::ptr::null(),size:32},output,32,&mut total).is_err());
  assert!(core_origin_span(&NativeOriginalSpan{data:100usize as *const u8,size:32},output,32,&mut total).is_err());
 }
 #[test]fn first_request_originals_are_not_replaced_by_a_later_context(){
  let mut later=original();let mut held=original();
  held.origin=later.origin.clone();later.origin[5]=b"later request".to_vec().into_boxed_slice();
  later.origin[2]=b"later status".to_vec().into_boxed_slice();
  assert_eq!(held.origin[5].as_ref(),&[5u8;8]);
  assert_eq!(held.origin[2].as_ref(),&[2u8;8]);
  assert_ne!(held.origin[5],later.origin[5]);
 }
}
fn is_own_records_loan(loan:&NativeCoreLoanV2)->bool{
 #[cfg(feature="abi5-final-native-link")]{loan.own_records_parent.is_some()}
 #[cfg(not(feature="abi5-final-native-link"))]{let _=loan;false}
}
thread_local!{static CORE_LOANS_V2:RefCell<BTreeMap<usize,Box<NativeCoreLoanV2>>>=RefCell::new(BTreeMap::new());}

// Same-thread borrowed locator, not a constructor or signing permission. The
// normal caller pins it with message3_retain for the synchronous EngineCommit
// run, then releases that temporary pin. The C enter independently retains its
// own attempt until durable cleanup; later kinds reuse that retained holder.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_engine_commit_holder_borrow_v1(policy:*mut c_void,out:*mut *mut c_void)->i32{
 if policy.is_null()||out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};
 let Some(p)=region(policy.cast(),std::mem::size_of::<NativeCoreLoanV2>())else{return BOUND};
 if !disjoint(o,p)||unsafe{!(*out).is_null()}{return BOUND}
 let current=unsafe{ynx_sdk_native_core_rights_current_v2(policy)};if current!=OK{return current}
 let result=catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{
  let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(policy as usize)).ok_or(1)?;
  if loan.unknown||loan.children==0||loan.purpose!=CorePurposeV2::FirstDeviceCore{return Err(MISMATCH)}
  if SELECTED_STARTUP.with(|s|s.get())!=Some(loan.startup){return Err(MISMATCH)}
  SDK_CUSTODY.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;
   let mut matches=s.iter().filter(|(_,v)|v.startup==loan.startup);
   let(id,sdk)=matches.next().ok_or(1)?;
   if matches.next().is_some()||sdk.unknown{return Err(MISMATCH)}
   let sdk_region=region((*id as *mut c_void).cast(),std::mem::size_of::<NativeCustodyOwner>()).ok_or(BOUND)?;
   if !disjoint(o,sdk_region){return Err(BOUND)}
   Ok(*id)
  })
 })));
 match result{Ok(Ok(id))=>{let code=unsafe{ynx_sdk_native_core_rights_current_v2(policy)};if code==OK{unsafe{*out=id as *mut c_void}}code},Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Private A3 lifetime contract. These functions retain existing recognized
// owners only. They neither construct Message3 originals nor authorize a key.
// Keep SDK -> core -> startup borrow order; make no C callback while borrowed.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_message3_retain_v1(holder:*mut c_void,policy:*mut c_void)->i32{
 if holder.is_null()||policy.is_null(){return BOUND}
 // Recheck the original policy outside any SDK inventory borrow. No public
 // fact, observed receipt or pair of pointer-shaped values can replace it.
 let current=unsafe{ynx_sdk_native_core_rights_current_v2(policy)};
 if current!=OK{return current}
 match catch_unwind(AssertUnwindSafe(||SDK_CUSTODY.with(|sdk|{
  let mut sdk=sdk.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let parent=sdk.get_mut(&(holder as usize)).ok_or(1)?;
  if parent.unknown{return Err(UNKNOWN)}
  CORE_LOANS_V2.with(|loans|{
   let mut loans=loans.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let loan=loans.get_mut(&(policy as usize)).ok_or(1)?;
   if loan.unknown{return Err(UNKNOWN)}
   if loan.startup!=parent.startup||loan.purpose!=CorePurposeV2::FirstDeviceCore||
    SELECTED_STARTUP.with(|s|s.get())!=Some(parent.startup){return Err(MISMATCH)}
   STARTUP_EVIDENCE.with(|startup|{
    let mut startup=startup.try_borrow_mut().map_err(|_|UNKNOWN)?;
    let held=startup.get_mut(&parent.startup).ok_or(UNKNOWN)?;
    if !held.sdk_held||held.core_borrows==0{return Err(MISMATCH)}
    selected_current(held)?;
    let count=parent.message3_pins.get(&(policy as usize)).copied().unwrap_or(0);
    // At most one retained attempt per existing Engine/Checkpoint/Terminal.
    // The C owner enforces kind uniqueness; this is just a bounded parent pin.
    if count>=3||parent.message3_pins.len()>=32&&count==0{return Err(BOUND)}
    let children=loan.children.checked_add(1).ok_or(BOUND)?;
    parent.message3_pins.insert(policy as usize,count+1);
    loan.children=children;
    Ok(())
   })
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_message3_release_v1(holder:*mut c_void,policy:*mut c_void)->i32{
 if holder.is_null()||policy.is_null(){return BOUND}
 match catch_unwind(AssertUnwindSafe(||SDK_CUSTODY.with(|sdk|{
  let mut sdk=sdk.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let parent=sdk.get_mut(&(holder as usize)).ok_or(1)?;
  CORE_LOANS_V2.with(|loans|{
   let mut loans=loans.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let loan=loans.get_mut(&(policy as usize)).ok_or(1)?;
   let count=parent.message3_pins.get(&(policy as usize)).copied().ok_or(MISMATCH)?;
   if loan.startup!=parent.startup||count==0||loan.children==0{return Err(MISMATCH)}
   // C calls only after its independent durable cleanup checks. Releasing a
   // lifetime pin must also work after expiry/refusal; it must never reset the
   // original first cause, UNKNOWN, counters, output or session authority.
   if count==1{parent.message3_pins.remove(&(policy as usize));}
   else{parent.message3_pins.insert(policy as usize,count-1);}
   loan.children-=1;
   Ok(())
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

#[cfg(test)]mod message3_lifetime_controls{
 use super::*;
 #[test]fn foreign_policy_cannot_retain_a_holder(){
  assert_ne!(unsafe{ynx_sdk_native_message3_retain_v1(0x55usize as *mut c_void,0x42usize as *mut c_void)},OK);
  SDK_CUSTODY.with(|s|assert!(s.borrow().is_empty()));
  CORE_LOANS_V2.with(|s|assert!(s.borrow().is_empty()));
 }
 #[test]fn foreign_release_cannot_create_or_dispose_an_owner(){
  assert_ne!(unsafe{ynx_sdk_native_message3_release_v1(0x55usize as *mut c_void,0x42usize as *mut c_void)},OK);
  SDK_CUSTODY.with(|s|assert!(s.borrow().is_empty()));
  CORE_LOANS_V2.with(|s|assert!(s.borrow().is_empty()));
 }
 #[test]fn null_lifetime_operands_are_rejected(){
  for (holder,policy) in [(0usize,0usize),(0,0x42),(0x55,0)]{
   assert_eq!(unsafe{ynx_sdk_native_message3_retain_v1(holder as *mut c_void,policy as *mut c_void)},BOUND);
   assert_eq!(unsafe{ynx_sdk_native_message3_release_v1(holder as *mut c_void,policy as *mut c_void)},BOUND);
  }
 }
}
fn core_operation_v2(code:u32)->Result<CoreOperationV2,i32>{match code{1=>Ok(CoreOperationV2::InitializeStorage),2=>Ok(CoreOperationV2::SealRecord),3=>Ok(CoreOperationV2::ReadRecord),4=>Ok(CoreOperationV2::WriteRecord),5=>Ok(CoreOperationV2::QueueNonce),6=>Ok(CoreOperationV2::CompareAndSwap),_=>Err(MISMATCH)}}
fn core_operation_kind_v2(operation:CoreOperationV2)->u32{match operation{
 CoreOperationV2::InitializeStorage=>1,CoreOperationV2::SealRecord=>2,CoreOperationV2::ReadRecord=>3,
 CoreOperationV2::WriteRecord=>4,CoreOperationV2::QueueNonce=>5,CoreOperationV2::CompareAndSwap=>6,
}}
// Discriminant of the ACTUAL already validated intake retained in this exact
// loan. Neither purpose1 nor an allowed-operations mask identifies an intent.
// No constructor, callback, caller selector, public flag or permission output.
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_native_core_operation_kind_v2(owner:*mut c_void,out:*mut u32)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<u32>()!=0{return BOUND}
 let Some(output)=region(out.cast(),std::mem::size_of::<u32>())else{return BOUND};
 match catch_unwind(AssertUnwindSafe(||{
  // Output must not overwrite this recognized loan or its retained original.
  // This metadata query cannot be a way to mutate an authorization owner.
  CORE_LOANS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(owner as usize)).ok_or(1)?;
   let allocation=region((&**loan as *const NativeCoreLoanV2).cast(),std::mem::size_of::<NativeCoreLoanV2>()).ok_or(BOUND)?;
   let original=region(loan.operation_original.as_ptr(),loan.operation_original.len()).ok_or(BOUND)?;
   if !disjoint(output,allocation)||!disjoint(output,original){return Err(BOUND)}Ok(())
  })?;
  let status=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};if status!=OK{return Err(status)}
  let kind=CORE_LOANS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;
   let loan=r.get(&(owner as usize)).ok_or(1)?;if loan.unknown{return Err(UNKNOWN)}
   Ok::<_,i32>(core_operation_kind_v2(loan.operation))
  })?;
  // No foreign/current callback while the inventory is borrowed. Late failure
  // preserves the caller's original output; this cannot become a fallback hint.
  let status=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};if status!=OK{return Err(status)}
  unsafe{std::ptr::write(out,kind)};Ok(())
 })){Ok(Ok(()))=>OK,Ok(Err(status))=>status,Err(_)=>UNKNOWN}
}

#[cfg(test)]mod core_operation_kind_controls{
 use super::*;
 #[test]fn core_initialization_kind_is_exact_intake_not_allowed_operations(){
  for code in 1..=6{assert_eq!(core_operation_kind_v2(core_operation_v2(code).unwrap()),code);}
  for code in [0,7,63,u32::MAX]{assert!(core_operation_v2(code).is_err());}
 }
 #[test]fn core_initialization_kind_foreign_owner_preserves_output_and_inventory(){
  let count=CORE_LOANS_V2.with(|r|r.borrow().len());let mut out=0x71e7_14a5;
  assert_ne!(unsafe{ynx_sdk_native_core_operation_kind_v2(std::ptr::null_mut(),&mut out)},OK);
  assert_eq!(out,0x71e7_14a5);assert_eq!(CORE_LOANS_V2.with(|r|r.borrow().len()),count);
 }
 #[test]fn core_initialization_kind_invalid_output_is_not_an_authority_probe(){
  assert_eq!(unsafe{ynx_sdk_native_core_operation_kind_v2(std::ptr::null_mut(),std::ptr::null_mut())},BOUND);
  let mut output=[0xa5u8;12];let before=output;
  let offset=(1..4).find(|offset|(unsafe{output.as_mut_ptr().add(*offset)}as usize)%std::mem::align_of::<u32>()!=0).unwrap();
  assert_eq!(unsafe{ynx_sdk_native_core_operation_kind_v2(std::ptr::null_mut(),output.as_mut_ptr().add(offset).cast())},BOUND);
  assert_eq!(output,before);
 }
}
fn core_purpose_v2(code:u32)->Result<CorePurposeV2,i32>{match code{1=>Ok(CorePurposeV2::FirstDeviceCore),2=>Ok(CorePurposeV2::MessageCore),_=>Err(MISMATCH)}}
fn core_original_cause_v2(e:EvidenceError)->i32{match e{EvidenceError::Window=>5,_=>evidence_status(e)}}
fn core_permission_status_v2(e:EvidenceError,uncertain:bool)->i32{if uncertain{UNKNOWN}else{core_original_cause_v2(e)}}
// Native-only startup supplier: all operands remain matching originals until
// the real M0 authenticator succeeds. Profile table is unchanged/empty.
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_plane_install_v2(owner:*mut c_void,approval:NativeOriginalSpan,issuer:NativeOriginalSpan,anchor:NativeOriginalSpan,association:NativeOriginalSpan,account:NativeOriginalSpan,generation:u64)->i32{
 match catch_unwind(AssertUnwindSafe(||{
  let output=(0usize,0usize);let mut total=0;
  let approval=core_origin_span(&approval,output,65536,&mut total)?;
  let issuer=core_origin_span(&issuer,output,65536,&mut total)?;let anchor=core_origin_span(&anchor,output,65536,&mut total)?;
  let association=core_origin_span(&association,output,65536,&mut total)?;let account=core_origin_span(&account,output,16384,&mut total)?;
  if generation==0{return Err(BOUND)}
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&(owner as usize)).ok_or(1)?;
   if held.sdk_held||held.core_borrows!=0||held.core_plane.is_some(){return Err(MISMATCH)}selected_current(held)?;
   let plane=held.source.authenticate_native_purpose_v2(approval,issuer,anchor).map_err(evidence_status)?;
   held.core_context=Some(NativeCoreContextV2{authenticated:NativeCoreAuthenticatedPlaneOriginalsV2{approval:approval.into(),issuer_current:issuer.into(),anchor_current:anchor.into()},association:association.into(),account:account.into(),storage_generation:generation,origin:None,relation:None});held.core_plane=Some(plane);selected_current(held)})
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_original_borrow_v2(input:*const NativeCoreOriginalInputV2,out:*mut *mut c_void)->i32{
 if input.is_null()||(input as usize)%std::mem::align_of::<NativeCoreOriginalInputV2>()!=0||out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};let Some(i)=region(input.cast(),std::mem::size_of::<NativeCoreOriginalInputV2>())else{return BOUND};if !disjoint(o,i)||unsafe{!(*out).is_null()}{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  use sha2::{Digest,Sha256};let v=unsafe{&*input};let q=&v.request;let raw=&v.original;
  if q.version!=2||q.size!=80||q.key_uses==0||q.key_uses&!15!=0||q.required_operations==0||q.required_operations&!63!=0||q.context_id!=0||q.context_generation!=0||q.deadline!=raw.monotonic_deadline_ns||raw.nonce_size!=32{return Err(BOUND)}
  let purpose=core_purpose_v2(q.purpose)?;if purpose!=CorePurposeV2::FirstDeviceCore{return Err(MISMATCH)}let operation=core_operation_v2(q.operation)?;
  let sampled=std::time::Instant::now();let mut now=0;let s=unsafe{ynx_source_monotonic_now_v1(&mut now)};if s!=OK{return Err(s)}let remaining=q.deadline.checked_sub(now).filter(|v|*v!=0).ok_or(5)?;
  let deadline=sampled.checked_add(std::time::Duration::from_nanos(remaining)).ok_or(BOUND)?;let mut total=0;
  let spans=[&raw.root,&raw.registration,&raw.status,&raw.source,&raw.namespace_prefix,&raw.request];let limits=[16384,16384,16384,393216,393216,1048576];let mut values=Vec::new();for(span,limit)in spans.into_iter().zip(limits){values.push(core_origin_span(span,o,limit,&mut total)?)}
  let originals:[&[u8];6]=values.try_into().map_err(|_|BOUND)?;
  // Check the actual nonce span and output aliasing before retaining anything
  // or consuming the operation-once slot. The previous len check alone did
  // not retain the pointed-to original for subsequent Message3 production.
  let account_nonce:[u8;32]=core_origin_span(
   &NativeOriginalSpan{data:raw.nonce,size:raw.nonce_size},o,32,&mut total
  )?.try_into().map_err(|_|BOUND)?;
  let mut first_public=NativeCoreFirstPublicOriginalV2{
   classic:raw.classic,pq:Box::new(raw.pq),account_nonce,source_nonce:raw.source_nonce,
   origin:originals.map(Box::<[u8]>::from),
   #[cfg(feature="source-collector-bridge")]server_link:None,
  };
  if <[u8;32]>::from(Sha256::digest(originals[5]))!=q.intent_digest{return Err(MISMATCH)}
  let prefix:Vec<Zeroizing<Vec<u8>>>=core_origin_history(raw.history,raw.history_count,o,16384,&mut total)?.into_iter().map(|raw|Zeroizing::new(raw.to_vec())).collect();
  let selected=SELECTED_STARTUP.with(|v|v.get()).ok_or(1)?;
  #[cfg(feature="source-collector-bridge")]
  {
   // The original policy-bound account bytes remain in CoreOriginalIntakeV2.
   // Join verified envelope/prepared facts only through the retained server,
   // without borrowing startup inventory across its current checks.
   first_public.server_link=Some(crate::source_infrastructure::link_first_device_core(
    &crate::source_infrastructure::platform::ServerCoreOriginals{
     originals,history:&prefix,account_nonce:&account_nonce,
     source_nonce:&raw.source_nonce,classic:&raw.classic,pq:&raw.pq,
    }).map_err(|s|if s==1{1}else if s==7{MISMATCH}else{UNKNOWN})?);
  }
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&selected).ok_or(1)?;selected_current(held)?;
   if held.core_borrows>=32{return Err(MISMATCH)}
   // Normal order: selected custody first, then the SAME startup's original
   // core operation. This is lifetime admission only: the authenticated plane
   // below still independently validates and retains the actual rights.
   if held.sdk_held{
    let has_sdk=SDK_CUSTODY.with(|sdk|{
     let sdk=sdk.try_borrow().map_err(|_|UNKNOWN)?;
     let mut parents=sdk.values().filter(|p|p.startup==selected);
     let Some(parent)=parents.next()else{return Ok(false)};
     if parents.next().is_some()||parent.unknown||!parent.execution.can_attach_core(){return Err(MISMATCH)}
     Ok(true)
    })?;
    if !has_sdk{
     // The first-server parent was physically matched to this exact verified
     // account/request/target by core_facts before entering this inventory.
     // No SDK, signer or permission is manufactured by this lifetime check.
     #[cfg(feature="source-server-collector")]
     {let link=first_public.server_link.as_ref().ok_or(1)?;
      let parent=selected_first_server_startup()?;
      if link.first_server_startup()!=parent||held.core_borrows!=0{return Err(MISMATCH)}
      FIRST_SERVER_STARTUPS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let p=r.get(&parent).ok_or(1)?;
       if p.startup!=selected||p.unknown||p.child.is_some(){return Err(MISMATCH)}Ok(())})?;}
     #[cfg(not(feature="source-server-collector"))]
     return Err(UNKNOWN);
    }
   }
   held.account.as_ref().ok_or(1)?.match_startup_originals(originals[0],originals[1],originals[2],&prefix).map_err(account_status)?;
   if held.ordinary_operation.is_some_and(|original|original!=q.intent_digest){return Err(MISMATCH)}
   let result=CORE_LOANS_V2.with(|loans|{let mut loans=loans.try_borrow_mut().map_err(|_|UNKNOWN)?;if loans.len()>=32{return Err(BOUND)}
    let id={
     let plane=held.core_plane.as_ref().ok_or(1)?;let context=held.core_context.as_ref().ok_or(1)?;
     let intake=CoreOriginalIntakeV2{originals,classic:&raw.classic,pq:&raw.pq,account_original:&context.account,association_original:&context.association,operation_original:originals[5],operation,requested_operations:q.required_operations,accepted_relation_original:None,storage_generation:context.storage_generation,monotonic_deadline:deadline};
     plane.retain_first_device_core_v2(&intake).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?
    };
    let loan=Box::new(NativeCoreLoanV2{startup:selected,id,operation_original:originals[5].into(),purpose,operation,first:OK,unknown:false,deadline:q.deadline,children:0,session_parent:None,
     #[cfg(feature="abi5-final-native-link")]own_records_parent:None,
     authenticated_originals:None,first_public:Some(first_public),
     #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]business_seed:None,
     #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="predevice-initial-prekeys-v1"))]registered_initial_seed:None,
    });let token=(&*loan as *const NativeCoreLoanV2)as usize;
    loans.insert(token,loan);held.core_borrows+=1;unsafe{*out=token as *mut c_void};
    if let Err(cause)=ordinary_startup::upgrade(held,&id){let partial=loans.get_mut(&token).ok_or(UNKNOWN)?;if partial.first==OK{partial.first=cause}partial.unknown=true;return Err(cause)}Ok(())});
   if result.is_ok(){held.core_context.as_mut().ok_or(UNKNOWN)?.origin=Some(NativeCoreRetainedOriginV2{originals:originals.map(Box::<[u8]>::from)});}result
  })
 })){Ok(Ok(()))=>unsafe{ynx_sdk_native_core_rights_current_v2(*out)},Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_rights_current_v2(owner:*mut c_void)->i32{
 #[cfg(feature="abi5-final-native-link")]
 {
  let parent=CORE_LOANS_V2.with(|r|r.try_borrow().map_err(|_|UNKNOWN).and_then(|r|r.get(&(owner as usize)).map(|loan|loan.own_records_parent).ok_or(1)));
  let checked=parent.and_then(|parent|match parent{Some(parent)=>own_records_context::current(parent),None=>Ok(())});
  if let Err(cause)=checked{
   CORE_LOANS_V2.with(|r|{if let Ok(mut r)=r.try_borrow_mut(){if let Some(loan)=r.get_mut(&(owner as usize)){if loan.first==OK{loan.first=cause}if cause!=1{loan.unknown=true}}}});return cause
  }
 }
 #[cfg(feature="source-collector-bridge")]
 {
  let link=CORE_LOANS_V2.with(|r|{
   let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(owner as usize)).ok_or(1)?;
   if loan.unknown{return Err(UNKNOWN)}
   if loan.purpose!=CorePurposeV2::FirstDeviceCore||is_own_records_loan(loan){return Ok(None)}
   Ok(Some(loan.first_public.as_ref().and_then(|p|p.server_link.as_ref()).ok_or(1)?.clone()))
  });
  let checked=link.and_then(|link|match link{None=>Ok(()),Some(link)=>link.current().map_err(|s|if s==1{1}else{UNKNOWN})});
  if let Err(cause)=checked{
   CORE_LOANS_V2.with(|r|{if let Ok(mut r)=r.try_borrow_mut(){if let Some(loan)=r.get_mut(&(owner as usize)){if loan.first==OK{loan.first=cause}if cause!=1{loan.unknown=true}}}});
   return cause
  }
 }
 match catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&(owner as usize)).ok_or(1)?;if loan.unknown{return Err(UNKNOWN)}
  let result=STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=s.get_mut(&loan.startup).ok_or(UNKNOWN)?;selected_current(held)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;let _scope=plane.reborrow_operation_v2(&loan.id).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;Ok(())});
  if let Err(s)=result{if loan.first==OK{loan.first=s}if s!=1{loan.unknown=true}return Err(if loan.unknown{UNKNOWN}else{s})}Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_rights_close_v2(owner:*mut *mut c_void)->i32{
 if owner.is_null()||(owner as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}let id=unsafe{*owner}as usize;if id==0{return OK}
 match catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&id).ok_or(1)?;if loan.children!=0{return Err(6)}
  #[cfg(feature="abi5-final-native-link")]if let Some(parent)=loan.own_records_parent{own_records_context::can_release_child(parent)?;}
  STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=s.get_mut(&loan.startup).ok_or(UNKNOWN)?;let plane=held.core_plane.as_ref().ok_or(UNKNOWN)?;
   let result=plane.close_operation_v2(&loan.id);let d=plane.operation_diagnostic_v2(&loan.id).map_err(evidence_status)?;
   if let Err(e)=result{if loan.first==OK{loan.first=evidence_status(e)}loan.unknown|=d.uncertain;return Err(core_permission_status_v2(e,d.uncertain))}
   if !d.cleanup_complete||held.core_borrows==0{return Err(UNKNOWN)}held.core_borrows-=1;Ok(())})?;
  #[cfg(feature="abi5-final-native-link")]if let Some(parent)=loan.own_records_parent{own_records_context::release_child(parent)?;}
  if let Some(parent)=loan.session_parent{MESSAGE_CONTEXTS_V2.with(|c|{let mut c=c.try_borrow_mut().map_err(|_|UNKNOWN)?;let parent=c.get_mut(&parent).ok_or(UNKNOWN)?;if parent.children==0{return Err(UNKNOWN)}parent.children-=1;Ok(())})?;}
  r.remove(&id);unsafe{*owner=std::ptr::null_mut()};Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_gate_v2(owner:*mut c_void,operation:u32)->i32{
 let current=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};if current!=OK{return current}
 let op=match core_operation_v2(operation){Ok(v)=>v,Err(s)=>return s};
 match catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&(owner as usize)).ok_or(1)?;if loan.unknown{return Err(UNKNOWN)}
  let result=STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=s.get_mut(&loan.startup).ok_or(UNKNOWN)?;selected_current(held)?;let plane=held.core_plane.as_ref().ok_or(1)?;let rights=plane.reborrow_operation_v2(&loan.id).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;rights.check_gate_v2(op).map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))});
  if let Err(s)=result{if loan.first==OK{loan.first=s}if s==UNKNOWN{loan.unknown=true}return Err(s)}Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_association_matches_v2(owner:*mut c_void,raw:*const u8,n:usize)->i32{
 if n==0||n>65536||region(raw,n).is_none(){return BOUND}
 match catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(owner as usize)).ok_or(1)?;if loan.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;let held=s.get(&loan.startup).ok_or(UNKNOWN)?;let plane=held.core_plane.as_ref().ok_or(1)?;let rights=plane.reborrow_operation_v2(&loan.id).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;rights.association_matches_v2(unsafe{std::slice::from_raw_parts(raw,n)}).map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))})
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_deadline_borrow_v2(owner:*mut c_void,out:*mut u64)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<u64>()!=0{return BOUND}unsafe{*out=0};let s=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};if s!=OK{return s}
 CORE_LOANS_V2.with(|r|match r.try_borrow(){Ok(r)=>match r.get(&(owner as usize)){Some(loan)=>{unsafe{*out=loan.deadline};OK},None=>1},Err(_)=>UNKNOWN})
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_resource_retain_v2(owner:*mut c_void)->i32{
 match catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&(owner as usize)).ok_or(1)?;if loan.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;let held=s.get(&loan.startup).ok_or(UNKNOWN)?;let plane=held.core_plane.as_ref().ok_or(1)?;let rights=plane.reborrow_operation_v2(&loan.id).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;rights.borrow_enforcing_child_v2().map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))?;loan.children+=1;Ok(())})
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_resource_release_v2(owner:*mut c_void)->i32{
 match catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&(owner as usize)).ok_or(1)?;if loan.children==0{return Err(MISMATCH)}
  STARTUP_EVIDENCE.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;let held=s.get(&loan.startup).ok_or(UNKNOWN)?;let plane=held.core_plane.as_ref().ok_or(UNKNOWN)?;plane.return_operation_child_v2(&loan.id).map_err(evidence_status)?;loan.children-=1;Ok(())})
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Native protected relation supplier; matching PUBLIC bytes alone never obtain
// a device/session. Message issue is additionally called behind genuine C root.
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_relation_bind_v2(owner:*mut c_void,raw:NativeOriginalSpan)->i32{
 match catch_unwind(AssertUnwindSafe(||{let mut total=0;let bytes=core_origin_span(&raw,(0,0),65536,&mut total)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&(owner as usize)).ok_or(1)?;selected_current(held)?;if held.core_context.as_ref().and_then(|c|c.relation.as_deref()).is_some_and(|prior|prior!=bytes){return Err(6)}
   let plane=held.core_plane.as_ref().ok_or(1)?;plane.message_relation_current_v2(bytes).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   held.core_context.as_mut().ok_or(1)?.relation=Some(bytes.into());Ok(())})
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[repr(C)]#[derive(Clone,Copy)]struct NativeCoreDeviceBindingV2{root:[u8;32],registration:[u8;32],classic:[u8;33],pq:[u8;2592]}
// Matching facts from the SAME retained NativeCore permission loan. This does
// not admit storage or turn account eligibility into a device grant. Storage
// generation is selected by the authenticated Core plane, not the identity key.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_storage_binding_v2(
 owner:*mut c_void,classic:*const u8,pq:*const u8,
 out:*mut NativeCoreDeviceBindingV2,generation:*mut u64)->i32{
 if out.is_null()||generation.is_null()||
    (generation as usize)%std::mem::align_of::<u64>()!=0{return BOUND}
 let Some(c)=region(classic,33)else{return BOUND};
 let Some(p)=region(pq,2592)else{return BOUND};
 let Some(o)=region(out.cast(),std::mem::size_of::<NativeCoreDeviceBindingV2>())else{return BOUND};
 let Some(g)=region(generation.cast(),std::mem::size_of::<u64>())else{return BOUND};
 if !disjoint(o,c)||!disjoint(o,p)||!disjoint(g,c)||!disjoint(g,p)||!disjoint(g,o){return BOUND}
 unsafe{std::ptr::write_bytes(out,0,1);*generation=0;}
 let status=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};if status!=OK{return status}
 let result=catch_unwind(AssertUnwindSafe(||{
  let classic:[u8;33]=unsafe{std::slice::from_raw_parts(classic,33)}.try_into().map_err(|_|BOUND)?;
  let pq:[u8;2592]=unsafe{std::slice::from_raw_parts(pq,2592)}.try_into().map_err(|_|BOUND)?;
  CORE_LOANS_V2.with(|loans|{
   let loans=loans.try_borrow().map_err(|_|UNKNOWN)?;
   let loan=loans.get(&(owner as usize)).ok_or(1)?;
   if loan.unknown{return Err(UNKNOWN)}
   STARTUP_EVIDENCE.with(|startup|{
    use sha2::{Digest,Sha256};
    let startup=startup.try_borrow().map_err(|_|UNKNOWN)?;
    let held=startup.get(&loan.startup).ok_or(UNKNOWN)?;
    let context=held.core_context.as_ref().ok_or(1)?;
    let original=context.origin.as_ref().ok_or(1)?;
    if context.storage_generation==0||context.storage_generation>u32::MAX as u64{return Err(BOUND)}
    let binding=NativeCoreDeviceBindingV2{
     root:Sha256::digest(loan.first_public.as_ref().map(|v|v.origin[0].as_ref()).unwrap_or(&original.originals[0])).into(),
     registration:Sha256::digest(loan.first_public.as_ref().map(|v|v.origin[1].as_ref()).unwrap_or(&original.originals[1])).into(),classic,pq};
    let plane=held.core_plane.as_ref().ok_or(1)?;
    plane.match_device_binding_v2(&binding.root,&binding.registration,&binding.classic,&binding.pq)
     .map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
    Ok((binding,context.storage_generation))
   })
  })
 }));
 match result{
  Ok(Ok((binding,selected_generation)))=>{
   let status=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};
   if status==OK{unsafe{*out=binding;*generation=selected_generation;}}
   status
  },
  Ok(Err(status))=>status,Err(_)=>UNKNOWN
 }
}

// Only the verified C device/session caller supplies these matching facts.
// This function returns permission custody, NOT session/store admission.
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_message_rights_borrow_v2(session:*mut c_void,intent:NativeOriginalSpan,operation:u32,required:u32,deadline:u64,out:*mut *mut c_void)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};if unsafe{!(*out).is_null()}{return BOUND}
 let status=unsafe{ynx_sdk_native_message_context_current_v2(session)};if status!=OK{return status}
 match catch_unwind(AssertUnwindSafe(||{
  let (selected,binding)=MESSAGE_CONTEXTS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let record=r.get(&(session as usize)).ok_or(1)?;Ok::<_,i32>((record.startup,record.binding))})?;let mut total=0;let intent=core_origin_span(&intent,o,1048576,&mut total)?;
  let op=core_operation_v2(operation)?;if operation==1||required==0||required&!62!=0{return Err(MISMATCH)}
  let sampled=std::time::Instant::now();let mut now=0;let code=unsafe{ynx_source_monotonic_now_v1(&mut now)};if code!=0{return Err(code)}let remaining=deadline.checked_sub(now).filter(|v|*v!=0).ok_or(5)?;
  let fixed=sampled.checked_add(std::time::Duration::from_nanos(remaining)).ok_or(BOUND)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&selected).ok_or(1)?;selected_current(held)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;plane.match_device_binding_v2(&binding.root,&binding.registration,&binding.classic,&binding.pq).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   let context=held.core_context.as_ref().ok_or(1)?;let origin=context.origin.as_ref().ok_or(1)?;let relation=context.relation.as_deref().ok_or(1)?;
   let originals=std::array::from_fn(|i|origin.originals[i].as_ref());
   let intake=CoreOriginalIntakeV2{originals,classic:&binding.classic,pq:&binding.pq,account_original:&context.account,association_original:&context.association,operation_original:intent,operation:op,requested_operations:required,accepted_relation_original:Some(relation),storage_generation:context.storage_generation,monotonic_deadline:fixed};
   CORE_LOANS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;if r.len()>=32{return Err(BOUND)}let id=plane.retain_message_core_v2(&intake).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
    let loan=Box::new(NativeCoreLoanV2{startup:selected,id,operation_original:intent.into(),purpose:CorePurposeV2::MessageCore,operation:op,first:OK,unknown:false,deadline,children:0,session_parent:Some(session as usize),
     #[cfg(feature="abi5-final-native-link")]own_records_parent:None,
     authenticated_originals:None,first_public:None,
     #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]business_seed:None,
     #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="predevice-initial-prekeys-v1"))]registered_initial_seed:None,
    });let token=(&*loan as *const NativeCoreLoanV2)as usize;MESSAGE_CONTEXTS_V2.with(|c|{let mut c=c.try_borrow_mut().map_err(|_|UNKNOWN)?;let context=c.get_mut(&(session as usize)).ok_or(UNKNOWN)?;context.children+=1;Ok::<_,i32>(())})?;r.insert(token,loan);held.core_borrows+=1;unsafe{*out=token as *mut c_void};Ok(())})
  })
 })){Ok(Ok(()))=>unsafe{ynx_sdk_native_core_rights_current_v2(*out)},Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Long-lived permission context owns its original startup borrow, not a short
// first-init operation deadline. Every operation separately issues fixed rights.
struct NativeMessageContextV2{startup:usize,binding:NativeCoreDeviceBindingV2,relation:Box<[u8]>,children:usize,first:i32,unknown:bool}
thread_local!{static MESSAGE_CONTEXTS_V2:RefCell<BTreeMap<usize,Box<NativeMessageContextV2>>>=RefCell::new(BTreeMap::new());}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_message_context_open_v2(binding:*const NativeCoreDeviceBindingV2,out:*mut *mut c_void)->i32{
 if binding.is_null()||(binding as usize)%std::mem::align_of::<NativeCoreDeviceBindingV2>()!=0||out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(o)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};let Some(b)=region(binding.cast(),std::mem::size_of::<NativeCoreDeviceBindingV2>())else{return BOUND};if !disjoint(o,b)||unsafe{!(*out).is_null()}{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{let binding=unsafe{*binding};let selected=SELECTED_STARTUP.with(|s|s.get()).ok_or(1)?;
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&selected).ok_or(1)?;if held.core_borrows>=32{return Err(BOUND)}selected_current(held)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;plane.match_device_binding_v2(&binding.root,&binding.registration,&binding.classic,&binding.pq).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   let data=held.core_context.as_ref().ok_or(1)?;if data.origin.is_none(){return Err(1)}let relation=data.relation.as_ref().ok_or(1)?;
   plane.message_relation_current_v2(relation).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   MESSAGE_CONTEXTS_V2.with(|c|{let mut c=c.try_borrow_mut().map_err(|_|UNKNOWN)?;if c.len()>=32{return Err(BOUND)}let record=Box::new(NativeMessageContextV2{startup:selected,binding,relation:relation.clone(),children:0,first:OK,unknown:false});let id=(&*record as *const NativeMessageContextV2)as usize;c.insert(id,record);held.core_borrows+=1;unsafe{*out=id as *mut c_void};Ok(())})
  })
 })){Ok(Ok(()))=>unsafe{ynx_sdk_native_message_context_current_v2(*out)},Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_message_context_current_v2(owner:*mut c_void)->i32{
 match catch_unwind(AssertUnwindSafe(||MESSAGE_CONTEXTS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let context=r.get_mut(&(owner as usize)).ok_or(1)?;if context.unknown{return Err(UNKNOWN)}
  let result=STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=s.get_mut(&context.startup).ok_or(UNKNOWN)?;selected_current(held)?;let plane=held.core_plane.as_ref().ok_or(1)?;
   plane.match_device_binding_v2(&context.binding.root,&context.binding.registration,&context.binding.classic,&context.binding.pq).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   plane.message_relation_current_v2(&context.relation).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))});
  if let Err(s)=result{if context.first==OK{context.first=s}if s!=1{context.unknown=true}return Err(if context.unknown{UNKNOWN}else{s})}Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_message_context_close_v2(owner:*mut *mut c_void)->i32{
 if owner.is_null()||(owner as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}let id=unsafe{*owner}as usize;if id==0{return OK}
 match catch_unwind(AssertUnwindSafe(||MESSAGE_CONTEXTS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let context=r.get_mut(&id).ok_or(1)?;if context.children!=0{return Err(6)}
  STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=s.get_mut(&context.startup).ok_or(UNKNOWN)?;if held.core_borrows==0{return Err(UNKNOWN)}held.core_borrows-=1;Ok(())})?;
  r.remove(&id);unsafe{*owner=std::ptr::null_mut()};Ok(())
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_message_budget_v2(owner:*mut c_void,out:*mut u64)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<u64>()!=0{return BOUND}unsafe{*out=0};let status=unsafe{ynx_sdk_native_message_context_current_v2(owner)};if status!=OK{return status}
 match catch_unwind(AssertUnwindSafe(||{let mut sampled=0;let status=unsafe{ynx_source_monotonic_now_v1(&mut sampled)};if status!=0{return Err(status)}
  MESSAGE_CONTEXTS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let context=r.get(&(owner as usize)).ok_or(1)?;
   STARTUP_EVIDENCE.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;let plane=s.get(&context.startup).and_then(|h|h.core_plane.as_ref()).ok_or(1)?;
    let budget=plane.operation_budget_v2().map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
    let ns=u64::try_from(budget.as_nanos()).map_err(|_|BOUND)?;let deadline=sampled.checked_add(ns).ok_or(BOUND)?;unsafe{*out=deadline};Ok(())})
  })
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Fixed Native startup supplier/restart intake. PUBLIC original custody only;
// independently authenticate policy and account current, then match all exact
// supplied bytes. No first-init operation or short deadline is re-created.
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_origin_bind_v2(owner:*mut c_void,originals:*const NativeOriginalSpan,history:*const NativeOriginalSpan,history_count:usize)->i32{
 if originals.is_null()||(originals as usize)%std::mem::align_of::<NativeOriginalSpan>()!=0{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{let mut total=0;let spans=unsafe{std::slice::from_raw_parts(originals,6)};let mut values=Vec::new();for span in spans{values.push(core_origin_span(span,(0,0),1048576,&mut total)?)}let values:[&[u8];6]=values.try_into().map_err(|_|BOUND)?;let prefix:Vec<Zeroizing<Vec<u8>>>=core_origin_history(history,history_count,(0,0),16384,&mut total)?.into_iter().map(|raw|Zeroizing::new(raw.to_vec())).collect();
  STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&(owner as usize)).ok_or(1)?;if held.core_borrows!=0{return Err(6)}selected_current(held)?;
   held.account.as_ref().ok_or(1)?.match_startup_originals(values[0],values[1],values[2],&prefix).map_err(account_status)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;let context=held.core_context.as_ref().ok_or(1)?;
   plane.match_context_originals_v2(&values,&context.association,&context.account,context.storage_generation).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   if context.origin.as_ref().is_some_and(|prior|prior.originals.iter().zip(values).any(|(a,b)|a.as_ref()!=b)){return Err(MISMATCH)}
   held.core_context.as_mut().ok_or(1)?.origin=Some(NativeCoreRetainedOriginV2{originals:values.map(Box::<[u8]>::from)});selected_current(held)
  })
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Native diagnostics retain actual first cause; never a Ready/enrollment bit.
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_diagnostic_v2(owner:*mut c_void,first:*mut i32,flags:*mut u32,children:*mut u64)->i32{
 if first.is_null()||flags.is_null()||children.is_null()||(first as usize)%4!=0||(flags as usize)%4!=0||(children as usize)%8!=0{return BOUND}
 let Some(a)=region(first.cast(),4)else{return BOUND};let Some(b)=region(flags.cast(),4)else{return BOUND};let Some(c)=region(children.cast(),8)else{return BOUND};if !disjoint(a,b)||!disjoint(a,c)||!disjoint(b,c){return BOUND}
 unsafe{*first=0;*flags=0;*children=0};
 match catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(owner as usize)).ok_or(1)?;
  STARTUP_EVIDENCE.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;let plane=s.get(&loan.startup).and_then(|h|h.core_plane.as_ref()).ok_or(UNKNOWN)?;let d=plane.operation_diagnostic_v2(&loan.id).map_err(evidence_status)?;
   let cause=d.first_cause.map(core_original_cause_v2).unwrap_or(loan.first);unsafe{*first=cause;*flags=u32::from(d.uncertain||loan.unknown)|(u32::from(d.retired)<<1)|(u32::from(d.cleanup_complete)<<2);*children=d.children as u64};Ok(())})
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Same native fixed-startup entry, composed before an exclusive SDK borrower.
// This is the normal supplier intake, not a public N-API/JNI approval installer.
#[repr(C)]pub(crate) struct NativeCoreStartupInputV2 {
 version:u32,size:u32,fixed:*const NativeStartupOriginals,
 manifest:NativeOriginalSpan,selected_bootstrap:NativeOriginalSpan,
 approval:NativeOriginalSpan,issuer_current:NativeOriginalSpan,anchor_current:NativeOriginalSpan,
 association:NativeOriginalSpan,account:NativeOriginalSpan,storage_generation:u64,
 origin:[NativeOriginalSpan;6],origin_history:*const NativeOriginalSpan,origin_history_count:usize,
 accepted_relation:NativeOriginalSpan,
}
fn core_startup_refuse_v2(owner:*mut c_void,cause:i32)->i32{
 STARTUP_EVIDENCE.with(|r|{if let Ok(mut r)=r.try_borrow_mut(){if let Some(held)=r.get_mut(&(owner as usize)){if held.first==OK{held.first=cause}held.unknown=true;}}});UNKNOWN
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_fixed_startup_initialize_core_v2(input:*const NativeCoreStartupInputV2,out:*mut *mut c_void)->i32{
 unsafe{fixed_startup_initialize_core_profile(input,out,false)}
}
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_fixed_startup_initialize_core_initial_prekeys_v3(input:*const NativeCoreStartupInputV2,out:*mut *mut c_void)->i32{
 unsafe{fixed_startup_initialize_core_profile(input,out,true)}
}
unsafe fn fixed_startup_initialize_core_profile(input:*const NativeCoreStartupInputV2,out:*mut *mut c_void,initial_prekeys:bool)->i32{
 if input.is_null()||(input as usize)%std::mem::align_of::<NativeCoreStartupInputV2>()!=0||out.is_null()||(out as usize)%std::mem::align_of::<*mut c_void>()!=0{return BOUND}
 let Some(output)=region(out.cast(),std::mem::size_of::<*mut c_void>())else{return BOUND};
 let Some(shape)=region(input.cast(),std::mem::size_of::<NativeCoreStartupInputV2>())else{return BOUND};
 if !disjoint(shape,output)||unsafe{!(*out).is_null()}{return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let v=unsafe{&*input};if v.version!=(if initial_prekeys{3}else{2})||v.size as usize!=std::mem::size_of::<NativeCoreStartupInputV2>()||v.storage_generation==0{return Err(BOUND)}
  if v.fixed.is_null()||(v.fixed as usize)%std::mem::align_of::<NativeStartupOriginals>()!=0||!disjoint(region(v.fixed.cast(),std::mem::size_of::<NativeStartupOriginals>()).ok_or(BOUND)?,output){return Err(BOUND)}
  // Preflight the COMPLETE fixed + Core intake under one aggregate limit,
  // before any original owner is published. No second 1MiB allocation budget.
  let fixed=unsafe{&*v.fixed};if fixed.version!=1{return Err(MISMATCH)}
  let mut total=0;startup_span(&v.manifest,output,1048576,&mut total)?;startup_span(&v.selected_bootstrap,output,128,&mut total)?;
  for raw in [&fixed.root,&fixed.registration,&fixed.status_current]{startup_span(raw,output,16384,&mut total)?;}
  startup_history(fixed.status_predecessors,fixed.status_predecessors_count,output,16384,&mut total)?;
  for raw in [&fixed.issuer_credential,&fixed.anchor_credential,&fixed.issuer_enrollment_current,&fixed.anchor_enrollment_current]{startup_span(raw,output,65536,&mut total)?;}
  startup_history(fixed.issuer_enrollment_predecessors,fixed.issuer_enrollment_predecessors_count,output,65536,&mut total)?;
  startup_history(fixed.anchor_enrollment_predecessors,fixed.anchor_enrollment_predecessors_count,output,65536,&mut total)?;
  for raw in [&v.approval,&v.issuer_current,&v.anchor_current,&v.association]{startup_span(raw,output,65536,&mut total)?;}
  startup_span(&v.account,output,16384,&mut total)?;
  for raw in &v.origin{startup_span(raw,output,1048576,&mut total)?;}
  startup_history(v.origin_history,v.origin_history_count,output,16384,&mut total)?;
  if v.accepted_relation.size!=0{startup_span(&v.accepted_relation,output,65536,&mut total)?;}else if !v.accepted_relation.data.is_null(){return Err(BOUND)}
  let status=unsafe{fixed_startup_initialize_profile(v.fixed,v.manifest.data,v.manifest.size,v.selected_bootstrap.data,v.selected_bootstrap.size,out,initial_prekeys,Some(v),None)};
  let owner=unsafe{*out};if status!=OK{return if owner.is_null(){Err(status)}else{Err(core_startup_refuse_v2(owner,status))}}
  if owner.is_null(){return Err(UNKNOWN)}
  // The SAME actual Core plane was authenticated and retained before startup
  // selection. Do not reacquire it or restart its time budget here.
  let status=unsafe{ynx_sdk_native_core_origin_bind_v2(owner,v.origin.as_ptr(),v.origin_history,v.origin_history_count)};
  if status!=OK{return Err(core_startup_refuse_v2(owner,status))}
  if v.accepted_relation.size!=0{let status=unsafe{ynx_sdk_native_core_relation_bind_v2(owner,NativeOriginalSpan{data:v.accepted_relation.data,size:v.accepted_relation.size})};if status!=OK{return Err(core_startup_refuse_v2(owner,status))}}
  let status=unsafe{ynx_sdk_native_core_startup_current_v2(owner)};if status==OK{Ok(())}else{Err(core_startup_refuse_v2(owner,status))}
 })){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>{let owner=unsafe{*out};if owner.is_null(){UNKNOWN}else{core_startup_refuse_v2(owner,UNKNOWN)}}}
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_startup_current_v2(owner:*mut c_void)->i32{
 match catch_unwind(AssertUnwindSafe(||STARTUP_EVIDENCE.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=r.get_mut(&(owner as usize)).ok_or(1)?;
  if !held.selected||SELECTED_STARTUP.with(|s|s.get())!=Some(owner as usize){return Err(MISMATCH)}selected_current(held)?;
  let plane=held.core_plane.as_ref().ok_or(1)?;let context=held.core_context.as_ref().ok_or(1)?;if context.origin.is_none(){return Err(1)}
  plane.assert_current_v2().map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
  if let Some(relation)=context.relation.as_deref(){plane.message_relation_current_v2(relation).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;}
  selected_current(held)
 }))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Local cleanup diagnostics of the SAME startup inventory, never readiness.
// Business current may have failed; its exact first cause remains observable.
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_startup_diagnostic_v2(owner:*mut c_void,first:*mut i32,uncertain:*mut u32)->i32{
 if first.is_null()||uncertain.is_null()||(first as usize)%std::mem::align_of::<i32>()!=0||(uncertain as usize)%std::mem::align_of::<u32>()!=0{return BOUND}
 let Some(a)=region(first.cast(),std::mem::size_of::<i32>())else{return BOUND};let Some(b)=region(uncertain.cast(),std::mem::size_of::<u32>())else{return BOUND};if !disjoint(a,b){return BOUND}
 unsafe{*first=OK;*uncertain=0};match catch_unwind(AssertUnwindSafe(||STARTUP_EVIDENCE.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let h=r.get(&(owner as usize)).ok_or(1)?;unsafe{*first=h.first;*uncertain=u32::from(h.unknown)};Ok(())}))){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}
}

// Authenticated operation originals borrowed only while a real M0 child is
// held. These are PUBLIC signed originals, not a joint enforcement capability.
#[repr(C)]pub(crate) struct NativeCoreParticipantOriginalsV2 {
 version:u32,purpose:u32,storage_generation:u64,deadline:u64,intent_digest:[u8;32],
 approval:NativeOriginalSpan,issuer_current:NativeOriginalSpan,anchor_current:NativeOriginalSpan,
 association:NativeOriginalSpan,account:NativeOriginalSpan,operation:NativeOriginalSpan,
 origin:[NativeOriginalSpan;6],accepted_relation:NativeOriginalSpan,
}
#[unsafe(no_mangle)]pub(crate) unsafe extern "C" fn ynx_sdk_native_core_participant_originals_v2(owner:*mut c_void,out:*mut NativeCoreParticipantOriginalsV2)->i32{
 if out.is_null()||(out as usize)%std::mem::align_of::<NativeCoreParticipantOriginalsV2>()!=0{return BOUND}
 unsafe{std::ptr::write_bytes(out,0,1)};let status=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};if status!=OK{return status}
 let result=catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;let loan=r.get_mut(&(owner as usize)).ok_or(1)?;
  // Returned spans stay rooted by THIS retained child, not an arbitrary pointer.
  if loan.children==0{return Err(MISMATCH)}
  use sha2::{Digest,Sha256};if <[u8;32]>::from(Sha256::digest(&loan.operation_original))!=loan.id{return Err(MISMATCH)}
  STARTUP_EVIDENCE.with(|s|{let s=s.try_borrow().map_err(|_|UNKNOWN)?;let held=s.get(&loan.startup).ok_or(UNKNOWN)?;let context=held.core_context.as_ref().ok_or(1)?;let original=context.origin.as_ref().ok_or(1)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;let rights=plane.reborrow_operation_v2(&loan.id).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;rights.association_matches_v2(&context.association).map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))?;
   // Freeze the complete signed bytes in THIS child before C borrows spans.
   // A later parent refresh cannot free or rewrite a live C participant view.
   let authenticated=loan.authenticated_originals.get_or_insert_with(||context.authenticated.clone());
   let span=|b:&[u8]|NativeOriginalSpan{data:b.as_ptr(),size:b.len()};
   unsafe{*out=NativeCoreParticipantOriginalsV2{version:2,purpose:match loan.purpose{CorePurposeV2::FirstDeviceCore=>1,CorePurposeV2::MessageCore=>2},storage_generation:context.storage_generation,deadline:loan.deadline,intent_digest:loan.id,approval:span(&authenticated.approval),issuer_current:span(&authenticated.issuer_current),anchor_current:span(&authenticated.anchor_current),association:span(&context.association),account:span(&context.account),operation:span(&loan.operation_original),origin:std::array::from_fn(|i|span(loan.first_public.as_ref().map(|v|v.origin[i].as_ref()).unwrap_or(&original.originals[i]))),accepted_relation:context.relation.as_deref().map(span).unwrap_or(NativeOriginalSpan{data:std::ptr::null(),size:0})}};Ok(())
  })
 })));let status=match result{Ok(Ok(()))=>unsafe{ynx_sdk_native_core_rights_current_v2(owner)},Ok(Err(s))=>s,Err(_)=>UNKNOWN};
 // A late refusal publishes no borrowing view; original child remains held.
 if status!=OK{unsafe{std::ptr::write_bytes(out,0,1)}}status
}

// Private matching facts only. Resource enforcement and final device admission
// remain separate; successful signature verification never mints a store.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_core_enforcing_binding_v2(
 owner:*mut c_void,
 out:*mut crate::source_evidence::native_core_rights_v2::NativeCoreEnforcingBindingV2,
)->i32{
 type Binding=crate::source_evidence::native_core_rights_v2::NativeCoreEnforcingBindingV2;
 if out.is_null()||(out as usize)%std::mem::align_of::<Binding>()!=0{return BOUND}
 let Some(output)=region(out.cast(),std::mem::size_of::<Binding>())else{return BOUND};
 let Some(owner_region)=region(owner.cast::<u8>(),std::mem::size_of::<NativeCoreLoanV2>())else{return BOUND};
 if !disjoint(output,owner_region){return BOUND}
 unsafe{std::ptr::write_bytes(out,0,1);}
 let result=catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{
  let mut r=r.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let loan=r.get_mut(&(owner as usize)).ok_or(1)?;
  if loan.unknown{return Err(UNKNOWN)}
  let result=STARTUP_EVIDENCE.with(|s|{
   let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=s.get_mut(&loan.startup).ok_or(UNKNOWN)?;
   selected_current(held)?;
   let binding={
    let plane=held.core_plane.as_ref().ok_or(1)?;
    let rights=plane.reborrow_operation_v2(&loan.id)
     .map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
    let mut binding=rights.enforcing_binding_v2()
     .map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))?;
    if binding.intent!=loan.id||loan.deadline==0{return Err(MISMATCH)}
    match (loan.purpose,loan.first_public.as_ref()){
     (CorePurposeV2::FirstDeviceCore,Some(original))=>original.match_device(&binding.device)?,
     (CorePurposeV2::MessageCore,None)=>{},
     (CorePurposeV2::FirstDeviceCore,None)if is_own_records_loan(loan)&&matches!(loan.operation,CoreOperationV2::ReadRecord|CoreOperationV2::WriteRecord)=>{},
     _=>return Err(MISMATCH),
    }
    binding.deadline=loan.deadline;
    binding
   };
   selected_current(held)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;
   let rights=plane.reborrow_operation_v2(&loan.id)
    .map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   rights.assert_current_v2()
    .map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))?;
   Ok(binding)
  });
  match result{
   Ok(binding)=>Ok(binding),
   Err(s)=>{if loan.first==OK{loan.first=s;}if s!=1{loan.unknown=true;}
    Err(if loan.unknown{UNKNOWN}else{s})}
  }
 })));
 match result{
  Ok(Ok(binding))=>{unsafe{std::ptr::write(out,binding);}OK},
  Ok(Err(s))=>s,
  Err(_)=>UNKNOWN,
 }
}


#[cfg(test)]mod signed_current_child_storage_tests{
 use super::*;
 #[test]fn frozen_child_originals_do_not_alias_parent_refresh_buffers(){
  // PUBLIC byte-lifetime control only, not signed evidence or a native grant.
  let mut parent=NativeCoreAuthenticatedPlaneOriginalsV2{approval:vec![1;32].into_boxed_slice(),issuer_current:vec![2;48].into_boxed_slice(),anchor_current:vec![3;48].into_boxed_slice()};
  let child=parent.clone();let issuer=child.issuer_current.as_ptr();
  assert_ne!(issuer,parent.issuer_current.as_ptr());
  parent.issuer_current=vec![4;48].into_boxed_slice();parent.anchor_current=vec![5;48].into_boxed_slice();
  assert_eq!(child.issuer_current.as_ref(),&[2;48]);assert_eq!(child.anchor_current.as_ref(),&[3;48]);assert_eq!(child.issuer_current.as_ptr(),issuer);
 }
}

// Private same-controller response intake. The two signed originals, not a
// C-reported counter/head or an SSO status, remain the authority operands.
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_native_core_context_refresh_current_v2(owner:*mut c_void,issuer:NativeOriginalSpan,anchor:NativeOriginalSpan)->i32{
 match catch_unwind(AssertUnwindSafe(||{
  if owner.is_null()||issuer.data.is_null()||anchor.data.is_null()||issuer.size==0||anchor.size==0||issuer.size>65536||anchor.size>65536{return Err(BOUND)}
  if region(issuer.data,issuer.size).is_none()||region(anchor.data,anchor.size).is_none(){return Err(BOUND)}
  // Own the response before mutating the parent; input may alias old immutable
  // public originals. No borrowed C view is ever replaced in-place.
  let issuer=unsafe{std::slice::from_raw_parts(issuer.data,issuer.size)}.to_vec();
  let anchor=unsafe{std::slice::from_raw_parts(anchor.data,anchor.size)}.to_vec();
  STARTUP_EVIDENCE.with(|registry|{
   let mut registry=registry.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=registry.get_mut(&(owner as usize)).ok_or(1)?;selected_current(held)?;
   if held.core_context.is_none(){return Err(1)}
   let plane=held.core_plane.as_mut().ok_or(1)?;
   plane.refresh_current_v2(&issuer,&anchor).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   // Each existing C child owns a frozen copy. New children receive this new
   // actual pair, with the old child deadlines/intent slots unchanged.
   let context=held.core_context.as_mut().ok_or(1)?;
   context.authenticated.issuer_current=issuer.into_boxed_slice();
   context.authenticated.anchor_current=anchor.into_boxed_slice();
   selected_current(held)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;
   plane.assert_current_v2().map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))
  })
 })){Ok(Ok(()))=>OK,Ok(Err(code))=>code,Err(_)=>UNKNOWN}
}
include!("source_only_startup_ffi.rs");

#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
#[path="core_source_public_originals_v2.rs"]mod core_source_public_originals_v2;

// Normal platform selection comes ONLY from this worker's retained, verified
// PolicyV3/RootV4 loan. ABI layout/versions do not create a permission. Missing
// selection, stale/revoked policy, wrong scope and late failure publish nothing.
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_core_social_source_selection_v1(
 owner:*mut c_void,
 out:*mut crate::source_evidence::native_core_rights_v2::NativeCoreSocialPlatformBindingV1,
)->i32{
 type Binding=crate::source_evidence::native_core_rights_v2::NativeCoreSocialPlatformBindingV1;
 if owner.is_null()||out.is_null()||(out as usize)%std::mem::align_of::<Binding>()!=0{return BOUND}
 let Some(output)=region(out.cast(),std::mem::size_of::<Binding>())else{return BOUND};
 let Some(owner_region)=region(owner.cast::<u8>(),std::mem::size_of::<NativeCoreLoanV2>())else{return BOUND};
 if !disjoint(output,owner_region){return BOUND}
 let before=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};if before!=OK{return before}
 let result=catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|r|{
  let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(owner as usize)).ok_or(1)?;
  if loan.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|s|{
   let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=s.get_mut(&loan.startup).ok_or(UNKNOWN)?;
   selected_current(held)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;
   let rights=plane.reborrow_operation_v2(&loan.id).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   let binding=rights.social_platform_binding_v1(loan.operation,loan.deadline)
    .map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))?;
   if binding.intent!=loan.id||binding.deadline_ns!=loan.deadline{return Err(MISMATCH)}
   match(loan.purpose,loan.first_public.as_ref()){
    (CorePurposeV2::FirstDeviceCore,Some(original))=>original.match_device(&binding.device)?,
    (CorePurposeV2::MessageCore,None)=>{},
    (CorePurposeV2::FirstDeviceCore,None)if is_own_records_loan(loan)&&matches!(loan.operation,CoreOperationV2::ReadRecord|CoreOperationV2::WriteRecord)=>{},
    _=>return Err(MISMATCH),
   }
   selected_current(held)?;
   Ok(binding)
  })
 })));
 match result{
  Ok(Ok(binding))=>{let after=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};
   if after!=OK{return after}unsafe{std::ptr::write(out,binding)};OK},
  Ok(Err(status))=>status,
  Err(_)=>UNKNOWN,
 }
}

// Fixed, private Client callee for ordinary SQL AAD and FD2 engine binding.
// Bytes are the verified CurrentV3 original head, not SHA(binding224). A
// refusal leaves the caller output unchanged and does not mint a loan.
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_core_social_source_head_v1(owner:*mut c_void,out:*mut u8)->i32{
 if owner.is_null(){return BOUND}
 let Some(output)=region(out,32)else{return BOUND};
 let result=catch_unwind(AssertUnwindSafe(||{
  let mut selection=std::mem::MaybeUninit::<SocialBindingV1>::uninit();
  let before=unsafe{ynx_sdk_native_core_social_source_selection_v1(owner,selection.as_mut_ptr())};
  if before!=OK{return Err(before)}
  let selection=unsafe{selection.assume_init()};
  let head=CORE_LOANS_V2.with(|loans|{
   let loans=loans.try_borrow().map_err(|_|UNKNOWN)?;
   let loan=loans.get(&(owner as usize)).ok_or(1)?;
   // The output must not overwrite any retained child/public-original view.
   for held in loans.values(){
    if !disjoint(output,region((&**held as *const NativeCoreLoanV2).cast(),std::mem::size_of::<NativeCoreLoanV2>()).ok_or(BOUND)?){return Err(BOUND)}
    let check=|raw:&[u8]|->Result<(),i32>{if !disjoint(output,region(raw.as_ptr(),raw.len()).ok_or(BOUND)?){Err(BOUND)}else{Ok(())}};
    check(&held.operation_original)?;
    if let Some(a)=&held.authenticated_originals{for raw in [&a.approval,&a.issuer_current,&a.anchor_current]{check(raw)?}}
    if let Some(p)=&held.first_public{check(p.pq.as_ref())?;for raw in &p.origin{check(raw)?}}
   }
   if loan.unknown{return Err(UNKNOWN)}
   STARTUP_EVIDENCE.with(|startups|{
    let mut startups=startups.try_borrow_mut().map_err(|_|UNKNOWN)?;
    let held=startups.get_mut(&loan.startup).ok_or(UNKNOWN)?;
    selected_current(held)?;
    let context=held.core_context.as_ref().ok_or(1)?;
    let check=|raw:&[u8]|->Result<(),i32>{if !disjoint(output,region(raw.as_ptr(),raw.len()).ok_or(BOUND)?){Err(BOUND)}else{Ok(())}};
    for raw in [&context.authenticated.approval,&context.authenticated.issuer_current,&context.authenticated.anchor_current,&context.association,&context.account]{check(raw)?}
    if let Some(origin)=&context.origin{for raw in &origin.originals{check(raw)?}}
    if let Some(relation)=&context.relation{check(relation)?}
    let plane=held.core_plane.as_ref().ok_or(1)?;
    let rights=plane.reborrow_operation_v2(&loan.id).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
    let head=rights.social_source_head_v1().map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))?;
    if rights.social_platform_binding_v1(loan.operation,loan.deadline).map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))?!=selection{return Err(MISMATCH)}
    selected_current(held)?;Ok(head)
   })
  })?;
  let after=unsafe{ynx_sdk_native_core_rights_current_v2(owner)};
  if after!=OK{return Err(after)}
  Ok(head)
 }));
 match result{Ok(Ok(head))=>{unsafe{std::ptr::copy_nonoverlapping(head.as_ptr(),out,32)};OK},Ok(Err(status))=>status,Err(_)=>UNKNOWN}
}

#[cfg(test)]mod ordinary_source_head_output_controls{
 use super::*;
 #[test]fn no_original_owner_never_publishes_a_head(){
  let mut output=[0xa5;32];
  assert_eq!(unsafe{ynx_sdk_native_core_social_source_head_v1(std::ptr::null_mut(),output.as_mut_ptr())},BOUND);
  assert_eq!(output,[0xa5;32]);
  assert_ne!(unsafe{ynx_sdk_native_core_social_source_head_v1(1usize as *mut c_void,output.as_mut_ptr())},OK);
  assert_eq!(output,[0xa5;32]);
 }
 #[test]fn invalid_output_is_refused_before_publication(){
  assert_eq!(unsafe{ynx_sdk_native_core_social_source_head_v1(1usize as *mut c_void,std::ptr::null_mut())},BOUND);
  assert_eq!(unsafe{ynx_sdk_native_core_social_source_head_v1(1usize as *mut c_void,(usize::MAX-15)as *mut u8)},BOUND);
 }
}

// Private lifetime accounting for the query-borrow slot of an EXISTING loan.
// This is not a registration/proof store: entries can only be attached after a
// genuine current READ loan and the fixed Client borrow have both been checked.
#[repr(C)]
pub(crate)struct NativeCoreSocialQueryBindingV1{
 version:u32,size:u32,
 original:crate::source_evidence::native_core_rights_v2::NativeCoreSocialPlatformBindingV1,
 query_deadline_ns:u64,
}
const _:[();240]=[();std::mem::size_of::<NativeCoreSocialQueryBindingV1>()];
type SocialBindingV1=crate::source_evidence::native_core_rights_v2::NativeCoreSocialPlatformBindingV1;
struct CoreQueryBorrowSlotV1{borrow:usize,read:SocialBindingV1,original:Option<SocialBindingV1>,attached:bool,busy:bool,first:i32}
thread_local!{static CORE_QUERY_BORROWS_V1:RefCell<BTreeMap<usize,CoreQueryBorrowSlotV1>>=RefCell::new(BTreeMap::new());}
#[cfg(target_os="android")]
unsafe extern "C"{
 fn ynx_held_backend_social_platform_query_borrow_current_v1(original:*mut c_void,same_read_policy:*mut c_void)->i32;
 fn ynx_held_backend_social_platform_query_borrow_binding_copy_v1(original:*mut c_void,same_read_policy:*mut c_void,out:*mut SocialBindingV1)->i32;
}
fn social_read_binding_v1(policy:*mut c_void)->Result<SocialBindingV1,i32>{
 let mut binding=std::mem::MaybeUninit::<SocialBindingV1>::uninit();
 let status=unsafe{ynx_sdk_native_core_social_source_selection_v1(policy,binding.as_mut_ptr())};
 if status!=OK{return Err(status)}
 let binding=unsafe{binding.assume_init()};
 if binding.profile!=1||binding.operation!=3{return Err(MISMATCH)}
 Ok(binding)
}
fn same_social_query_scope_v1(read:&SocialBindingV1,old:&SocialBindingV1)->bool{
 old.version==1&&old.size==224&&old.profile==1&&old.capabilities==255&&old.purpose==read.purpose
 &&(1..=6).contains(&old.operation)&&old.policy_generation!=0&&old.deadline_ns!=0
 &&old.storage_generation==read.storage_generation&&old.key_epoch==read.key_epoch
 &&old.registration_revision>0&&old.registration_revision<=read.registration_revision&&old.account==read.account
 &&old.namespace_id==read.namespace_id&&old.registration==read.registration&&old.device==read.device
 &&old.intent!=[0;32]&&old.intent!=read.intent
}
struct CoreQueryActiveV1{policy:usize,borrow:usize}
impl Drop for CoreQueryActiveV1{fn drop(&mut self){CORE_QUERY_BORROWS_V1.with(|r|{
 if let Ok(mut r)=r.try_borrow_mut(){if let Some(slot)=r.get_mut(&self.policy){if slot.borrow==self.borrow{slot.busy=false}}}
});}}
// Only the Android build links the ordinary protected-history producer.
// Other targets still validate the actual Source-selected READ first, but
// cannot borrow/acquire Android storage or adopt a pointer/child pin.
fn client_query_platform_supported_v1()->bool{cfg!(target_os="android")}
fn client_query_binding_v1(policy:*mut c_void,borrow:usize)->Result<SocialBindingV1,i32>{
 #[cfg(not(target_os="android"))]{
  let _=borrow;
  social_read_binding_v1(policy)?;
  Err(1)
 }
 #[cfg(target_os="android")]{
 let before=unsafe{ynx_held_backend_social_platform_query_borrow_current_v1(borrow as *mut c_void,policy)};
 if before!=OK{return Err(before)}
 let mut binding=std::mem::MaybeUninit::<SocialBindingV1>::uninit();
 let status=unsafe{ynx_held_backend_social_platform_query_borrow_binding_copy_v1(borrow as *mut c_void,policy,binding.as_mut_ptr())};
 if status!=OK{return Err(status)}
 let after=unsafe{ynx_held_backend_social_platform_query_borrow_current_v1(borrow as *mut c_void,policy)};
 if after!=OK{return Err(after)}
 Ok(unsafe{binding.assume_init()})
 }
}
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_core_social_source_query_attach_v1(policy:*mut c_void,borrow:*mut c_void)->i32{
 if policy.is_null()||borrow.is_null(){return BOUND}
 match catch_unwind(AssertUnwindSafe(||{
  let read=social_read_binding_v1(policy)?;
  if !client_query_platform_supported_v1(){return Err(1)}
  // Adopt this exact pointer and pin the original policy BEFORE a fallible
  // foreign call. Even a late attach failure must be explicitly detached.
  CORE_LOANS_V2.with(|loans|{
   let mut loans=loans.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let loan=loans.get_mut(&(policy as usize)).ok_or(1)?;
   if loan.unknown||loan.operation!=CoreOperationV2::ReadRecord||loan.id!=read.intent||loan.children>=32{return Err(MISMATCH)}
   CORE_QUERY_BORROWS_V1.with(|slots|{
    let mut slots=slots.try_borrow_mut().map_err(|_|UNKNOWN)?;
    if slots.contains_key(&(policy as usize)){return Err(MISMATCH)}
    if slots.len()>=32{return Err(BOUND)}
    slots.insert(policy as usize,CoreQueryBorrowSlotV1{borrow:borrow as usize,read,original:None,attached:false,busy:true,first:OK});
    loan.children+=1;Ok(())
   })
  })?;
  let active=CoreQueryActiveV1{policy:policy as usize,borrow:borrow as usize};
  // No Rust inventory borrow is held while Client checks its real journal.
  let result=(||{
   let original=client_query_binding_v1(policy,borrow as usize)?;
   if !same_social_query_scope_v1(&read,&original){return Err(MISMATCH)}
   if social_read_binding_v1(policy)?!=read{return Err(MISMATCH)}
   Ok(original)
  })();
  CORE_QUERY_BORROWS_V1.with(|slots|{
   let mut slots=slots.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let slot=slots.get_mut(&(policy as usize)).ok_or(UNKNOWN)?;
   if slot.borrow!=borrow as usize||slot.read!=read{return Err(UNKNOWN)}
   match result{
    Ok(original)=>{slot.original=Some(original);slot.attached=true;Ok(())},
    Err(status)=>{if slot.first==OK{slot.first=status}Err(status)},
   }
  })?;
  drop(active);Ok(())
 })){Ok(Ok(()))=>OK,Ok(Err(status))=>status,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_core_social_source_query_detach_v1(policy:*mut c_void,borrow:*mut c_void)->i32{
 if policy.is_null()||borrow.is_null(){return BOUND}
 // Cleanup only: an expired READ permission must not make its resource pin
 // impossible to return. No query/use permission or Client resource is freed.
 match catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|loans|{
  let mut loans=loans.try_borrow_mut().map_err(|_|UNKNOWN)?;
  let loan=loans.get_mut(&(policy as usize)).ok_or(1)?;
  CORE_QUERY_BORROWS_V1.with(|slots|{
   let mut slots=slots.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let Some(slot)=slots.get(&(policy as usize))else{return Ok(())};
   if slot.borrow!=borrow as usize{return Err(MISMATCH)}
   if slot.busy||loan.children==0{return Err(UNKNOWN)}
   slots.remove(&(policy as usize));loan.children-=1;Ok(())
  })
 }))){Ok(Ok(()))=>OK,Ok(Err(status))=>status,Err(_)=>UNKNOWN}
}
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_core_social_source_query_selection_v1(policy:*mut c_void,out:*mut NativeCoreSocialQueryBindingV1)->i32{
 if policy.is_null()||out.is_null()||(out as usize)%std::mem::align_of::<NativeCoreSocialQueryBindingV1>()!=0{return BOUND}
 let Some(output)=region(out.cast(),std::mem::size_of::<NativeCoreSocialQueryBindingV1>())else{return BOUND};
 let Some(owner)=region(policy.cast::<u8>(),std::mem::size_of::<NativeCoreLoanV2>())else{return BOUND};
 if !disjoint(output,owner){return BOUND}
 let result=catch_unwind(AssertUnwindSafe(||{
  let read=social_read_binding_v1(policy)?;
  if !client_query_platform_supported_v1(){return Err(1)}
  let mut before=0;let clock=unsafe{ynx_source_monotonic_now_v1(&mut before)};
  if clock!=OK{return Err(clock)}if before>=read.deadline_ns{return Err(5)}
  let (borrow,original)=CORE_QUERY_BORROWS_V1.with(|slots|{
   let mut slots=slots.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let slot=slots.get_mut(&(policy as usize)).ok_or(1)?;
   if slot.first!=OK{return Err(slot.first)}
   if !slot.attached||slot.busy||slot.read!=read{return Err(MISMATCH)}
   let original=slot.original.ok_or(1)?;slot.busy=true;Ok((slot.borrow,original))
  })?;
  let active=CoreQueryActiveV1{policy:policy as usize,borrow};
  let observed=client_query_binding_v1(policy,borrow)?;
  if observed!=original||!same_social_query_scope_v1(&read,&observed){return Err(MISMATCH)}
  if social_read_binding_v1(policy)?!=read{return Err(MISMATCH)}
  let mut after=0;let clock=unsafe{ynx_source_monotonic_now_v1(&mut after)};
  if clock!=OK{return Err(clock)}if after<before||after>=read.deadline_ns{return Err(5)}
  // Old effect deadline is deliberately kept, even if already expired. Only
  // the separate fresh READ deadline permits this original-slot observation.
  let value=NativeCoreSocialQueryBindingV1{version:1,size:240,original,query_deadline_ns:read.deadline_ns};
  drop(active);Ok(value)
 }));
 match result{Ok(Ok(value))=>{unsafe{std::ptr::write(out,value)};OK},Ok(Err(status))=>status,Err(_)=>UNKNOWN}
}

#[cfg(test)]
mod ordinary_query_scope_tests {
 use super::*;
 fn binding(revision:u64,intent:u8)->SocialBindingV1 { SocialBindingV1 {
  version:1,size:224,profile:1,purpose:1,operation:3,capabilities:255,
  policy_generation:7,storage_generation:9,key_epoch:5,registration_revision:revision,
  deadline_ns:17,account:[1;32],namespace_id:[2;32],registration:[3;32],device:[4;32],intent:[intent;32],
 }}
 #[test]fn historical_revision_is_query_data_not_a_new_effect_or_deadline() {
  let read=binding(8,9);let old=binding(6,8);let snapshot=old;
  assert!(same_social_query_scope_v1(&read,&old));
  assert_eq!(old,snapshot);assert_eq!(old.deadline_ns,17);
  assert!(same_social_query_scope_v1(&read,&binding(8,8)));
  assert!(!same_social_query_scope_v1(&read,&binding(9,8)));
  assert!(!same_social_query_scope_v1(&read,&binding(0,8)));
  assert!(!same_social_query_scope_v1(&read,&binding(8,9)));
 }
 #[test]fn historical_scope_never_crosses_identity_epoch_storage_or_registration() {
  let read=binding(8,9);let old=binding(6,8);
  for field in 0..8 {
   let mut other=old;
   match field {0=>other.account[0]^=1,1=>other.namespace_id[0]^=1,
    2=>other.registration[0]^=1,3=>other.device[0]^=1,
    4=>other.storage_generation+=1,5=>other.key_epoch+=1,
    6=>other.purpose=2,_=>other.profile=2}
   assert!(!same_social_query_scope_v1(&read,&other));
  }
 }
}

// Immutable DATA locator for recovery of an existing original. This function
// deliberately does NOT grant current/effect rights, renew a deadline, clear
// UNKNOWN, or open any record. The independent fresh READ loan and MAC-checked
// restricted journal are still required by the actual query factory.
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_core_original_intent_copy_v1(
 original_policy:*mut c_void,out:*mut u8,size:usize,
)->i32 {
 if original_policy.is_null()||size!=32{return BOUND}
 let Some(output)=region(out,size)else{return BOUND};
 let result=catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|loans|{
  let loans=loans.try_borrow().map_err(|_|UNKNOWN)?;
  let loan=loans.get(&(original_policy as usize)).ok_or(1)?;
  for held in loans.values() {
   let owner=region((&**held as *const NativeCoreLoanV2).cast(),std::mem::size_of::<NativeCoreLoanV2>()).ok_or(BOUND)?;
   let raw=region(held.operation_original.as_ptr(),held.operation_original.len()).ok_or(BOUND)?;
   if !disjoint(output,owner)||!disjoint(output,raw){return Err(BOUND)}
  }
  use sha2::{Digest,Sha256};
  let original:[u8;32]=Sha256::digest(&loan.operation_original).into();
  if original!=loan.id||original==[0;32]{return Err(MISMATCH)}
  Ok(original)
 })));
 match result {
  Ok(Ok(original))=>{unsafe{std::ptr::copy_nonoverlapping(original.as_ptr(),out,32)};OK},
  Ok(Err(status))=>status,Err(_)=>UNKNOWN,
 }
}
#[cfg(test)]mod original_intent_data_controls {
 use super::*;
 #[test]fn foreign_locator_never_opens_a_loan_or_changes_the_output() {
  let before=CORE_LOANS_V2.with(|l|l.borrow().len());let mut output=[7u8;32];
  let rc=unsafe{ynx_sdk_native_core_original_intent_copy_v1(0x4000usize as *mut c_void,output.as_mut_ptr(),32)};
  assert_ne!(rc,OK);assert_eq!(output,[7;32]);
  assert_eq!(CORE_LOANS_V2.with(|l|l.borrow().len()),before);
 }
 #[test]fn locator_requires_exact_output_size_and_never_treats_data_as_rights() {
  for n in [0,1,31,33,usize::MAX] {
   let mut output=[7u8;32];
   assert_eq!(unsafe{ynx_sdk_native_core_original_intent_copy_v1(0x4000usize as *mut c_void,output.as_mut_ptr(),n)},BOUND);
   assert_eq!(output,[7;32]);
  }
 }
}

// Explicit verified mode selection for the normal product consumer. A failed
// ordinary/strong selector is NEVER used to infer the other mode.
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_sdk_native_core_storage_profile_v1(policy:*mut c_void,out:*mut u32)->i32 {
 if policy.is_null()||out.is_null()||(out as usize)%std::mem::align_of::<u32>()!=0{return BOUND}
 let Some(output)=region(out.cast(),4)else{return BOUND};
 let Some(owner)=region(policy.cast(),std::mem::size_of::<NativeCoreLoanV2>())else{return BOUND};
 if !disjoint(output,owner){return BOUND}
 let before=unsafe{ynx_sdk_native_core_rights_current_v2(policy)};if before!=OK{return before}
 let result=catch_unwind(AssertUnwindSafe(||CORE_LOANS_V2.with(|loans|{
  let loans=loans.try_borrow().map_err(|_|UNKNOWN)?;let loan=loans.get(&(policy as usize)).ok_or(1)?;
  if loan.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|startup|{
   let mut startup=startup.try_borrow_mut().map_err(|_|UNKNOWN)?;
   let held=startup.get_mut(&loan.startup).ok_or(UNKNOWN)?;selected_current(held)?;
   let plane=held.core_plane.as_ref().ok_or(1)?;
   let rights=plane.reborrow_operation_v2(&loan.id).map_err(|e|core_permission_status_v2(e,plane.unresolved_v2()))?;
   let mode=rights.storage_profile_v1().map_err(|e|core_permission_status_v2(e,rights.unresolved_v2()))?;
   selected_current(held)?;Ok(mode)
  })
 })));
 match result{Ok(Ok(mode))=>{
  let after=unsafe{ynx_sdk_native_core_rights_current_v2(policy)};if after!=OK{return after}
  unsafe{std::ptr::write(out,mode)};OK
 },Ok(Err(status))=>status,Err(_)=>UNKNOWN}
}

#[cfg(test)]mod storage_profile_authority_controls {
 use super::*;
 #[test]fn caller_data_or_missing_loan_never_selects_a_storage_profile() {
  let before=CORE_LOANS_V2.with(|loans|loans.borrow().len());
  for policy in [std::ptr::null_mut(),0x4000usize as *mut c_void] {
   let mut unchanged=99u32;
   assert_ne!(unsafe{ynx_sdk_native_core_storage_profile_v1(policy,&mut unchanged)},OK);
   assert_eq!(unchanged,99);
  }
  assert_eq!(CORE_LOANS_V2.with(|loans|loans.borrow().len()),before);
 }
}

#[cfg(test)]mod initial_prekeys_startup_entry_controls {
 use super::*;
 #[test]fn new_entry_is_explicit_and_cannot_select_or_create_startup_from_no_originals(){
  std::thread::spawn(||{
   let before=STARTUP_EVIDENCE.with(|r|r.borrow().len());let mut out=std::ptr::null_mut();
   assert_eq!(unsafe{ynx_sdk_fixed_startup_open_initial_prekeys_v2(std::ptr::null(),std::ptr::null(),0,std::ptr::null(),0,&mut out)},BOUND);
   assert!(out.is_null());assert!(SELECTED_STARTUP.with(|r|r.get()).is_none());
   assert_eq!(unsafe{ynx_sdk_fixed_startup_initialize_core_initial_prekeys_v3(std::ptr::null(),&mut out)},BOUND);
   assert!(out.is_null());assert_eq!(STARTUP_EVIDENCE.with(|r|r.borrow().len()),before);
  }).join().unwrap();
 }
}

#[path="message_custody_ffi/source_output_guard.rs"]mod source_output_guard;

#[path="message_custody_ffi/runtime_approval_owned_ffi.rs"]mod runtime_approval_owned_ffi;

#[path="message_custody_ffi/runtime_policy_key_guard.rs"]pub(crate)mod runtime_policy_key_guard;

#[path="message_custody_ffi/runtime_current_key_guard.rs"]pub(crate)mod runtime_current_key_guard;

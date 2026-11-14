//! Separate infrastructure pair candidate; never RecoveryLoan/device permission.
#![allow(unsafe_code)]
use crate::private_own_key::{NativeClassicOwnKey,SerializedClassicOwnKey};
use std::{ffi::c_char,marker::PhantomData,rc::Rc,thread::ThreadId};
use zeroize::Zeroizing;

#[path="source_infrastructure/r5_accepted_device_verification.rs"]
mod r5_accepted_device_verification;

#[cfg(all(feature="abi5-final-native-link",feature="predevice-initial-prekeys-v1"))]
#[path="source_infrastructure/initial_set_engine_context_v2.rs"]
pub(crate)mod initial_set_engine_context_v2;

#[cfg(test)]
#[path="message3_original_controls.rs"]
mod message3_original_controls;

#[cfg(feature="abi5-final-native-link")]
unsafe extern "C" {
 fn ynx_native_core_resource_driver_engine_original_query(
  owner:*mut std::ffi::c_void,which:u32,out:*mut u8,capacity:usize,written:*mut usize,
 )->i32;
 fn ynx_native_core_resource_driver_engine_context_query(
  owner:*mut std::ffi::c_void,out:*mut u8,capacity:usize,written:*mut usize,
 )->i32;
 fn ynx_native_core_resource_driver_initialization_engine_context_query(
  owner:*mut std::ffi::c_void,out:*mut u8,capacity:usize,written:*mut usize,
 )->i32;
 #[cfg(feature="predevice-initial-prekeys-v1")]
 fn ynx_native_core_resource_driver_initial_set_engine_context_query_v2(
  owner:*mut std::ffi::c_void,out:*mut u8,capacity:usize,written:*mut usize,
 )->i32;
}

/// Copies from the real independent C readback. Never a resource or signing
/// capability. Keep this object, including partial bytes, on every refusal.
#[cfg(feature="abi5-final-native-link")]
pub(crate) struct Message3EngineOriginal {
 pub(crate) typed:Zeroizing<Vec<u8>>,
 pub(crate) journal:Zeroizing<Vec<u8>>,
 pub(crate) source_frame:Zeroizing<Vec<u8>>,
 context:Zeroizing<Vec<u8>>,
 first:Option<SourceError>,
}
#[cfg(feature="abi5-final-native-link")]
impl Message3EngineOriginal {
 pub(crate) unsafe fn read(owner:*mut std::ffi::c_void)->Result<Self,(SourceError,Self)>{
  let mut result=Self{typed:Zeroizing::new(Vec::new()),journal:Zeroizing::new(Vec::new()),
   source_frame:Zeroizing::new(Vec::new()),context:Zeroizing::new(Vec::new()),first:None};
  let status=(||{
   if owner.is_null(){return Err(SourceError::Bounds)}
   for (which,limit,out) in [(1,416,&mut result.typed),
    (2,33554432,&mut result.journal),(3,65536,&mut result.source_frame)] {
    out.try_reserve_exact(limit).map_err(|_|SourceError::Bounds)?;
    out.resize(limit,0);
    let mut written=0usize;
    let code=unsafe{ynx_native_core_resource_driver_engine_original_query(
     owner,which,out.as_mut_ptr(),limit,&mut written)};
    // A malformed size cannot be trusted to trim away potentially written
    // bytes. Preserve the full bounded buffer and never retry the read here.
    if written>limit{return Err(if code!=0{SourceError::Foreign(code)}else{SourceError::Unknown})}
    out.truncate(written);
    if code!=0{return Err(SourceError::Foreign(code))}
    if written==0||(which==1&&written!=416){return Err(SourceError::Bounds)}
   }
   let kind=match result.typed.get(14..16){Some([0,0])=>0,Some([1,0])=>1,
    #[cfg(feature="predevice-initial-prekeys-v1")]Some([2,0])=>2,
    _=>return Err(SourceError::Bounds)};
   let limit=match kind{0=>120,1=>720,2=>3392,_=>return Err(SourceError::Bounds)};
   result.context.try_reserve_exact(limit).map_err(|_|SourceError::Bounds)?;
   result.context.resize(limit,0);
   let mut written=0usize;
   let code=match kind{
    0=>unsafe{ynx_native_core_resource_driver_engine_context_query(owner,result.context.as_mut_ptr(),limit,&mut written)},
    1=>unsafe{ynx_native_core_resource_driver_initialization_engine_context_query(owner,result.context.as_mut_ptr(),limit,&mut written)},
    #[cfg(feature="predevice-initial-prekeys-v1")]
    2=>unsafe{ynx_native_core_resource_driver_initial_set_engine_context_query_v2(owner,result.context.as_mut_ptr(),limit,&mut written)},
    _=>return Err(SourceError::Bounds),
   };
   if written>limit{return Err(if code!=0{SourceError::Foreign(code)}else{SourceError::Unknown})}
   result.context.truncate(written);
   if code!=0{return Err(SourceError::Foreign(code))}
   if written!=limit{return Err(SourceError::Bounds)}
   Ok(())
  })();
  match status{Ok(())=>Ok(result),Err(error)=>{result.first=Some(error);Err((error,result))}}
 }
 /// Facts only: callers still need independent rights verification before signing.
 pub(crate) fn source_context(&self)->Result<([u8;32],[u64;11]),SourceError>{
  if let Some(first)=self.first{return Err(first)}
  if self.context.len()!=120{return Err(SourceError::Bounds)}
  let abi=self.context[..32].try_into().map_err(|_|SourceError::Bounds)?;
  let mut coordinates=[0u64;11];
  for (index,value) in coordinates.iter_mut().enumerate(){
   let at=32+index*8;
   *value=u64::from_be_bytes(self.context[at..at+8].try_into().map_err(|_|SourceError::Bounds)?);
  }
  Ok((abi,coordinates))
 }
 pub(crate)fn initialization_context(&self)->Result<Option<crate::message_evidence::InitializationEngineBinding>,SourceError>{
  if let Some(first)=self.first{return Err(first)}
  match self.typed.get(14..16){
   Some([0,0])=>{if self.context.len()!=120{return Err(SourceError::Bounds)}Ok(None)},
   Some([1,0])=>crate::message_evidence::InitializationEngineBinding::from_context(&self.context).map(Some).map_err(|_|SourceError::Pair),
   _=>Err(SourceError::Bounds),
  }
 }
 #[cfg(feature="predevice-initial-prekeys-v1")]
 pub(crate)fn initial_set_context_v2(&self)->Result<Option<initial_set_engine_context_v2::InitialSetEngineContextV2>,SourceError>{
  if let Some(first)=self.first{return Err(first)}
  match self.typed.get(14..16){
   Some([2,0])=>initial_set_engine_context_v2::InitialSetEngineContextV2::from_original(&self.context).map(Some),
   Some([0,0])|Some([1,0])=>Ok(None),
   _=>Err(SourceError::Bounds),
  }
 }
 pub(crate) fn match_effect(
  &self,binding:&crate::source_evidence::native_core_rights_v2::NativeCoreEnforcingBindingV2,
  effect:&Message3EffectOriginal<'_>,
 )->Result<(),SourceError>{
  use sha2::{Digest,Sha256};
  if let Some(first)=self.first{return Err(first)}
  let initialization=self.initialization_context()?;
  if initialization.is_none(){self.source_context()?;}
  let b=self.typed.as_slice();
  if b.len()!=416||b.get(..14)!=Some(b"YNXENGINEBIND1")||
   b[384..416].iter().any(|v|*v!=0){return Err(SourceError::Bounds)}
  let integer=|at:usize|->Result<u64,SourceError>{
   Ok(u64::from_be_bytes(b.get(at..at+8).ok_or(SourceError::Bounds)?
    .try_into().map_err(|_|SourceError::Bounds)?))
  };
  if binding.version!=2||binding.storage_generation==0||binding.deadline==0||
   b[16..48]!=binding.intent||integer(48)?!=binding.storage_generation||
   integer(56)?!=binding.deadline||integer(64)?>i64::MAX as u64||
   integer(64)?.checked_add(1)!=Some(integer(72)?)||integer(72)?>i64::MAX as u64||
   (initialization.is_none()&&integer(240)?==0)||(initialization.is_some()&&integer(240)?!=0)||integer(248)?!=effect.rows.len() as u64||
   b[208..240]!=binding.head{return Err(SourceError::Pair)}
  for (actual,expected) in [(effect.raw,&b[256..288]),
   (self.journal.as_slice(),&b[176..208]),(self.source_frame.as_slice(),&b[352..384])] {
   if actual.is_empty()||Sha256::digest(actual).as_slice()!=expected{return Err(SourceError::Pair)}
  }
  // Revalidate the same CAS intent and generation, not merely its hash.
  let digest:[u8;32]=b[256..288].try_into().map_err(|_|SourceError::Bounds)?;
  Message3EffectOriginal::parse(effect.raw,binding,&digest)?;
  if let Some(initialization)=initialization{
   initialization_insertion(effect)?;
   initialization.match_resource(binding,&self.journal,effect.rows[0].next_cipher_digest)
    .map_err(|_|SourceError::Pair)?;
   initialization.match_engine_state(b,&self.journal).map_err(|_|SourceError::Pair)?;
  }
  Ok(())
 }
}

#[cfg(feature="abi5-final-native-link")]
fn initialization_insertion(effect:&Message3EffectOriginal<'_>)->Result<(),SourceError>{
 use sha2::{Digest,Sha256};
 // core_store_cipher_inner hashes the exact previous ciphertext bytes. An
 // absent predecessor is SHA256(empty), never an all-zero invented digest.
 if effect.rows.len()!=1||effect.rows[0].previous_version!=0||effect.rows[0].next_version!=1
  ||effect.rows[0].previous_cipher_digest!=Sha256::digest([]).as_slice(){return Err(SourceError::Pair)}
 Ok(())
}

#[cfg(all(test,feature="abi5-final-native-link"))]mod initialization_insertion_controls{
 use super::*;use sha2::{Digest,Sha256};
 fn original(previous:&[u8])->Vec<u8>{
  let mut raw=vec![0u8;224];raw[..12].copy_from_slice(b"YNXCORECASV1");raw[16..48].fill(9);
  raw[48..56].copy_from_slice(&3u64.to_be_bytes());raw[56..64].copy_from_slice(&7u64.to_be_bytes());
  raw[80..88].copy_from_slice(&1u64.to_be_bytes());raw[168..176].copy_from_slice(&1u64.to_be_bytes());
  raw[176..208].copy_from_slice(previous);raw
 }
 fn binding()->crate::source_evidence::native_core_rights_v2::NativeCoreEnforcingBindingV2{
  let mut value:crate::source_evidence::native_core_rights_v2::NativeCoreEnforcingBindingV2=unsafe{std::mem::zeroed()};
  value.version=2;value.storage_generation=3;value.deadline=7;value.intent=[9;32];value
 }
 #[test]fn engine_initialization_accepts_actual_empty_predecessor_sha_not_zero(){
  let binding=binding();let raw=original(&Sha256::digest([]));
  let effect=Message3EffectOriginal::parse(&raw,&binding,&Sha256::digest(&raw).into()).unwrap();assert!(initialization_insertion(&effect).is_ok());
  for wrong in [[0u8;32],Sha256::digest(b"a predecessor").into()]{let raw=original(&wrong);
   let effect=Message3EffectOriginal::parse(&raw,&binding,&Sha256::digest(&raw).into()).unwrap();assert_eq!(initialization_insertion(&effect),Err(SourceError::Pair));}
 }
 #[test]fn engine_initialization_does_not_accept_update_as_first_insertion(){
  let binding=binding();let mut raw=original(&Sha256::digest([]));raw[160..168].copy_from_slice(&1u64.to_be_bytes());raw[168..176].copy_from_slice(&2u64.to_be_bytes());
  let effect=Message3EffectOriginal::parse(&raw,&binding,&Sha256::digest(&raw).into()).unwrap();assert_eq!(initialization_insertion(&effect),Err(SourceError::Pair));
 }
}

/// Exact original produced by core_store_cipher_inner. Parsing is correlation
/// only; it neither grants signing nor replaces independent resource current.
pub(crate) struct Message3EffectOriginal<'a> {
 pub(crate) raw:&'a[u8],
 pub(crate) rows:Vec<Message3EffectRow<'a>>,
}
pub(crate) struct Message3EffectRow<'a> {
 pub(crate) name_digest:&'a[u8],
 pub(crate) next_cipher_digest:&'a[u8],
 pub(crate) previous_cipher_digest:&'a[u8],
 pub(crate) previous_version:u64,
 pub(crate) next_version:u64,
}
impl<'a> Message3EffectOriginal<'a> {
 pub(crate) fn parse(
  raw:&'a[u8],
  binding:&crate::source_evidence::native_core_rights_v2::NativeCoreEnforcingBindingV2,
  expected_digest:&[u8;32],
 )->Result<Self,SourceError>{
  use sha2::{Digest,Sha256};
  if raw.len()<224||raw.len()>96+32*128||raw.get(..12)!=Some(b"YNXCORECASV1"){
   return Err(SourceError::Bounds)
  }
  let u64at=|at:usize|->Result<u64,SourceError>{
   Ok(u64::from_be_bytes(raw.get(at..at+8).ok_or(SourceError::Bounds)?
    .try_into().map_err(|_|SourceError::Bounds)?))
  };
  if raw[12..16].iter().chain(&raw[76..80]).chain(&raw[88..96]).any(|v|*v!=0){
   return Err(SourceError::Bounds)
  }
  let count=usize::try_from(u64at(80)?).map_err(|_|SourceError::Bounds)?;
  if !(1..=32).contains(&count)||raw.len()!=96+count*128{return Err(SourceError::Bounds)}
  if binding.version!=2||binding.storage_generation==0||binding.deadline==0||
   raw[16..48]!=binding.intent||u64at(48)?!=binding.storage_generation||
   u64at(56)?!=binding.deadline||<[u8;32]>::from(Sha256::digest(raw))!=*expected_digest{
   return Err(SourceError::Pair)
  }
  let mut rows:Vec<Message3EffectRow<'a>>=Vec::with_capacity(count);
  for i in 0..count {
   let at=96+i*128;
   let previous_version=u64at(at+64)?;let next_version=u64at(at+72)?;
   if next_version<=previous_version||next_version>i64::MAX as u64||
    raw[at+112..at+128].iter().any(|v|*v!=0){return Err(SourceError::Bounds)}
   let name_digest=&raw[at..at+32];
   if rows.iter().any(|r|r.name_digest==name_digest){return Err(SourceError::Pair)}
   rows.push(Message3EffectRow{name_digest,next_cipher_digest:&raw[at+32..at+64],
    previous_cipher_digest:&raw[at+80..at+112],previous_version,next_version});
  }
  Ok(Self{raw,rows})
 }
}
// Normal private Rust intake, never exported to JS/JNI or implemented by a
// supplier callback. M1 retains this owner inside the same selected startup;
// account OriginalAdmission and accepted-device context stay mandatory there.
pub(crate) fn acquire_original_native_purpose_v2(source:&Rc<crate::source_evidence::FixedStartupSourceEvidence>,approval:&[u8],issuer_current:&[u8],anchor_current:&[u8])->Result<crate::source_evidence::native_core_rights_v2::NativePurposeIdentityOwnerV2,crate::source_evidence::Error>{
 source.authenticate_native_purpose_v2(approval,issuer_current,anchor_current)
}
pub(crate) fn issue_first_device_core_rights_v2<'p>(owner:&'p crate::source_evidence::native_core_rights_v2::NativePurposeIdentityOwnerV2,input:&crate::source_evidence::native_core_rights_v2::CoreOriginalIntakeV2<'_>)->Result<crate::source_evidence::native_core_rights_v2::NativeCoreRightsV2<'p>,crate::source_evidence::Error>{owner.issue_first_device_core_rights_v2(input)}
pub(crate) fn issue_message_core_rights_v2<'p>(owner:&'p crate::source_evidence::native_core_rights_v2::NativePurposeIdentityOwnerV2,input:&crate::source_evidence::native_core_rights_v2::CoreOriginalIntakeV2<'_>)->Result<crate::source_evidence::native_core_rights_v2::NativeCoreRightsV2<'p>,crate::source_evidence::Error>{owner.issue_message_core_rights_v2(input)}
#[path="source_platform.rs"]
#[cfg(feature="abi5-final-native-link")]
pub(crate)mod platform;
#[repr(C)]struct Wrapping{_private:[u8;0]}
#[repr(C)]struct SealedLauncher{_private:[u8;0]}
pub(crate)enum VerifiedSealedCredentialBorrow<'a>{FirstPrepared(&'a crate::source_evidence::VerifiedFirstPreparedHolderCredential),Directory(&'a crate::source_evidence::VerifiedDirectoryHolderCredential)}
enum WrappingSource<'a>{Fd(i32),Sealed(&'a crate::source_infrastructure::VerifiedSealedCredentialBorrow<'a>)}
#[repr(C)]struct SealedCredentialInput{raw:*const u8,n:usize,role:u32,purpose:u32,monotonic_deadline_ns:u64,not_before_ms:i64,expires_ms:i64}
#[repr(C)]struct Pq{_private:[u8;0]}
#[repr(C)]pub(crate) struct SourcePqRecord{version:u32,aad_size:u32,aad:[u8;7168],nonce:[u8;12],cipher:[u8;4912]}
#[repr(C)]pub(crate) struct SourceClassicRecord{version:u32,aad_size:u32,cipher_size:u32,aad:[u8;7168],nonce:[u8;12],cipher:[u8;272]}
#[path="source_sealed_bundle.rs"]
mod sealed_bundle;
#[repr(C)]struct Binding{alias:*const c_char,generation:u64,classic:*const u8,association:*const u8,association_size:usize}
unsafe extern "C" {
 fn ynx_source_message_sealed_open_raw(input:*const MessageSealedRawInput,out:*mut *mut SealedLauncher)->i32;
 fn ynx_source_message_sealed_observe_raw(owner:*mut SealedLauncher,input:*const MessageSealedRawInput)->i32;
 fn ynx_source_sealed_role_monotonic_ns(out:*mut u64)->i32;
 fn ynx_source_sealed_role_resolve_open(input:*const SealedCredentialInput,out:*mut *mut SealedLauncher)->i32;
 fn ynx_source_sealed_role_wrapping_open(owner:*mut SealedLauncher,out:*mut *mut Wrapping)->i32;
 fn ynx_source_sealed_role_current(owner:*mut SealedLauncher)->i32;
 fn ynx_source_sealed_role_close(owner:*mut *mut SealedLauncher)->i32;
 fn ynx_source_wrapping_open(fd:i32,out:*mut *mut Wrapping)->i32;
 fn ynx_source_wrapping_close(out:*mut *mut Wrapping)->i32;
 fn ynx_source_wrapping_current(owner:*mut Wrapping)->i32;
 fn ynx_source_reload_records(p:*mut Wrapping,b:*const Binding,pq:*const u8,q:*const SourcePqRecord,c:*const SourceClassicRecord,classic:*mut u8,written:*mut usize,out:*mut *mut Pq)->i32;
 fn veil_own_sign_public_proof(owner:*const Pq,message:*const u8,length:usize,signature:*mut u8,written:*mut usize)->i32;
 fn veil_own_close(out:*mut *mut Pq)->i32;
 fn own_selected_verify(pk:*const u8,pn:usize,m:*const u8,n:usize,sig:*const u8,sn:usize)->i32;
}
#[repr(C)]pub(crate)struct MessageOriginalSpan{pub(crate)raw:*const u8,pub(crate)size:usize}
#[repr(C)]pub(crate)struct MessageSealedRawInput{
 pub(crate)device:u32,pub(crate)handles:[u32;4],pub(crate)fields:[MessageOriginalSpan;13],
 pub(crate)counter_floor:u64,pub(crate)monotonic_deadline_ns:u64,pub(crate)not_before_ms:i64,pub(crate)expires_ms:i64,
}
pub(crate)fn message_monotonic_ns()->Result<u64,SourceError>{let mut n=0;let s=unsafe{ynx_source_sealed_role_monotonic_ns(&mut n)};if s!=0||n==0{Err(SourceError::Unknown)}else{Ok(n)}}
// Message3 primitive custody is deliberately separate from firstPrepared and
// Directory authority. It loads only actual Native encrypted records under
// the original signed enrollment selection; SDK current/once/floor policy
// must still hold before any signing dispatch. This type grants none of those.
pub(crate)struct MessageCustodyPair{pair:InfrastructurePair}
impl MessageCustodyPair{
 pub(crate)fn open(source:&crate::source_evidence::FixedStartupSourceEvidence,enrollment:&crate::message_enrollment::StartupEnrollment<'_>,role:SourceRole,alias:&std::ffi::CStr,generation:u64,q:&SourcePqRecord,c:&SourceClassicRecord)->Result<Self,(SourceError,Self)>{
  let mut pair=InfrastructurePair{classic:None,pq:std::ptr::null_mut(),wrapping:std::ptr::null_mut(),sealed:std::ptr::null_mut(),role,custodian:Vec::new(),thread:std::thread::current().id(),used:false,unknown:false,local:PhantomData,expected:None,attempt:None,#[cfg(feature="abi5-final-native-link")]role_guard:None};
  let id=match role{SourceRole::Issuer=>1,SourceRole::Anchor=>2};
  if enrollment.match_source_role(source,id).is_err(){return Err((SourceError::Pair,Self{pair}))}
  let (custodian,classic,pq)=match source.custody_public_binding(id){Ok(v)=>v,Err(_)=>return Err((SourceError::Pair,Self{pair}))};
  if generation==0||alias.to_bytes().is_empty()||alias.to_bytes().len()>512{return Err((SourceError::Bounds,Self{pair}))}
  pair.custodian=custodian.to_vec();
  let rc=match enrollment.with_sealed_custody_input(|input|unsafe{ynx_source_message_sealed_open_raw(input,&mut pair.sealed)}){Ok(s)=>s,Err(_)=>return Err((SourceError::Unknown,Self{pair}))};
  if enrollment.recheck().is_err(){pair.unknown=true;return Err((if rc!=0{SourceError::Foreign(rc)}else{SourceError::Unknown},Self{pair}))}
  if rc!=0{return Err((SourceError::Foreign(rc),Self{pair}))}if pair.sealed.is_null(){return Err((SourceError::Unknown,Self{pair}))}
  let rc=unsafe{ynx_source_sealed_role_wrapping_open(pair.sealed,&mut pair.wrapping)};
  if rc!=0||enrollment.recheck().is_err(){pair.unknown=true;return Err((if rc!=0{SourceError::Foreign(rc)}else{SourceError::Unknown},Self{pair}))}
  let mut association=b"YNX/SOCIAL/INFRASTRUCTURE/V1\0".to_vec();association.push(id);association.extend((custodian.len()as u32).to_be_bytes());association.extend(custodian);
  let b=Binding{alias:alias.as_ptr(),generation,classic:classic.as_ptr(),association:association.as_ptr(),association_size:association.len()};
  let mut clear=Zeroizing::new(vec![0;256]);let mut written=0;
  let rc=unsafe{ynx_source_reload_records(pair.wrapping,&b,pq.as_ptr(),q,c,clear.as_mut_ptr(),&mut written,&mut pair.pq)};
  if rc!=0||written==0||written>256||enrollment.recheck().is_err(){pair.unknown=true;return Err((if rc!=0{SourceError::Foreign(rc)}else{SourceError::Unknown},Self{pair}))}
  clear.truncate(written);
  let key=match SerializedClassicOwnKey::take_native_bytes(clear).and_then(|v|v.reload()){Ok(k)=>k,Err(_)=>return Err((SourceError::Pair,Self{pair}))};
  if key.public_identity().serialize().as_ref()!=classic{return Err((SourceError::Pair,Self{pair}))}
  pair.classic=Some(key);pair.expected=Some((classic,pq));
  if pair.sealed_current().is_err()||enrollment.recheck().is_err(){pair.unknown=true;return Err((SourceError::Unknown,Self{pair}))}
  Ok(Self{pair})
 }
 pub(crate)fn current(&mut self)->Result<(),SourceError>{
  if self.pair.unknown{return Err(SourceError::Unknown)}
  let r=self.pair.sealed_current().and_then(|_|{
   if self.pair.wrapping.is_null()||self.pair.pq.is_null()||self.pair.classic.is_none(){return Err(SourceError::Closed)}
   let s=unsafe{ynx_source_wrapping_current(self.pair.wrapping)};if s!=0{Err(SourceError::Foreign(s))}else{Ok(())}
  });if r.is_err(){self.pair.unknown=true}r
 }
 pub(crate)fn observe_current(&mut self,enrollment:&crate::message_enrollment::StartupEnrollment<'_>)->Result<(),SourceError>{
  self.current()?;
  let result=enrollment.with_sealed_custody_input(|input|unsafe{ynx_source_message_sealed_observe_raw(self.pair.sealed,input)}).map_err(|_|SourceError::Unknown).and_then(|s|if s==0{Ok(())}else{Err(SourceError::Foreign(s))});
  if result.is_err()||enrollment.recheck().is_err(){self.pair.unknown=true;return result.and(Err(SourceError::Unknown))}
  self.current()
 }
 // Private SAME-process Source role reference only. The SDK parent must be
 // pinned before this is lent; C independently recognizes/retains its own child.
 // Never exposed to JS/JNI/network and never a Root/once/signing permission.
 pub(crate)fn r5_source_role_owner(&mut self,enrollment:&crate::message_enrollment::StartupEnrollment<'_>)->Result<*mut std::ffi::c_void,SourceError>{
  self.observe_current(enrollment)?;
  if self.pair.sealed.is_null(){return Err(SourceError::Closed)}
  Ok(self.pair.sealed.cast())
 }
 // Read-only original-suite verification. Matching a held delegated public
 // key and an original frame never yields an effect/signing subcapability.
 pub(crate)fn verify_message3_original(&mut self,pq:bool,expected:&[u8],frame:&[u8],signature:&[u8])->Result<bool,SourceError>{
  if !message3_frame_matches(self.pair.role,frame){return Err(SourceError::Pair)}
  self.verify_original_frame_bytes(pq,expected,frame,signature)
 }
 // R5 verification ONLY over the SAME held pair/current. Does not widen the
 // Message3 KeyGuard signing allowlist or construct any effect capability.
 pub(crate)fn verify_r5_original(&mut self,pq:bool,expected:&[u8],frame:&[u8],signature:&[u8])->Result<bool,SourceError>{
  if !message3_frame_matches(self.pair.role,frame)&&!r5_accepted_device_verification::frame_matches(self.pair.role,frame){return Err(SourceError::Pair)}
  self.verify_original_frame_bytes(pq,expected,frame,signature)
 }
 fn verify_original_frame_bytes(&mut self,pq:bool,expected:&[u8],frame:&[u8],signature:&[u8])->Result<bool,SourceError>{
  let keys=self.pair.expected.as_ref().ok_or(SourceError::Closed)?;
  if (pq&&(expected!=keys.1.as_ref()||signature.len()!=4627))||(!pq&&(expected!=keys.0.as_slice()||signature.len()!=64)){return Err(SourceError::Pair)}
  self.current()?;
  let verified=if pq{
   (unsafe{own_selected_verify(expected.as_ptr(),expected.len(),frame.as_ptr(),frame.len(),signature.as_ptr(),signature.len())})==1
  }else{libsignal_protocol::PublicKey::deserialize(expected).map_err(|_|SourceError::Pair)?.verify_signature(frame,signature)};
  self.current()?;Ok(verified)
 }
 // Only the normal SDK producer can construct this guard, after the real C
 // coordinator has durably reserved its exact role/key bit. No public frame
 // or verified-signature result can construct it. Return actual public parts
 // even after a late refusal so key_leave can preserve them independently.
 #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
 pub(crate)fn sign_engine_guard(&mut self,guard:&mut crate::message_custody_ffi::message3_producer::KeyGuard)->(Vec<u8>,Result<(),SourceError>){
  let(frame,pq)=match guard.claim(self.pair.role){Ok(v)=>v,Err(e)=>return(Vec::new(),Err(e))};
  if !message3_frame_matches(self.pair.role,frame){return(Vec::new(),Err(SourceError::Pair))}
  if let Err(e)=self.current(){return(Vec::new(),Err(e))}
  let(mut bytes,mut status)=if pq{
   let mut bytes=vec![0u8;4627];let mut written=0usize;
   let code=unsafe{veil_own_sign_public_proof(self.pair.pq,frame.as_ptr(),frame.len(),bytes.as_mut_ptr(),&mut written)};
   if written<=bytes.len(){bytes.truncate(written);}
   let status=if code!=0{Err(SourceError::Foreign(code))}else if written!=4627{Err(SourceError::Unknown)}else{Ok(())};
   (bytes,status)
  }else{
   match self.pair.classic.as_ref().ok_or(SourceError::Closed).and_then(|k|k.sign_pair_transcript(frame).map_err(|_|SourceError::Pair)){
    Ok(bytes)=>{let status=if bytes.len()==64{Ok(())}else{Err(SourceError::Unknown)};(bytes.into_vec(),status)},
    Err(e)=>(Vec::new(),Err(e)),
   }
  };
  if let Err(e)=self.current(){if status.is_ok(){status=Err(e)}}
  if status.is_err(){self.pair.unknown=true;}
  (std::mem::take(&mut bytes),status)
 }
 pub(crate)fn close(&mut self)->Result<(),SourceError>{self.pair.close()}
}
// Exactly existing five preimages; no public purpose/sign selector is added.
fn message3_frame_matches(role:SourceRole,frame:&[u8])->bool{
 let allowed:[(&[u8],&[u8]);3]=match role{
  SourceRole::Issuer=>[(b"YNX/SOCIAL/FIRST-DEVICE-ENGINE-COMMIT/V1\0",b"first-device-engine-commit-issuer"),(b"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-TERMINAL/V1\0",b"first-device-independent-terminal-issuer"),(b"",b"")],
  SourceRole::Anchor=>[(b"YNX/SOCIAL/FIRST-DEVICE-ENGINE-COMMIT/V1\0",b"first-device-engine-commit-anchor"),(b"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-CHECKPOINT/V1\0",b"first-device-independent-checkpoint-anchor"),(b"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-TERMINAL/V1\0",b"first-device-independent-terminal-anchor")],
 };
 allowed.iter().any(|(domain,text)|{
  if domain.is_empty()||!frame.starts_with(domain)||frame.get(domain.len()).copied()!=Some(text.len()as u8){return false}
  let start=domain.len()+1;let end=start+text.len();if frame.get(start..end)!=Some(*text){return false}
  let Some(size)=frame.get(end..end+4)else{return false};let n=u32::from_be_bytes(size.try_into().unwrap())as usize;
  n>0&&n<=32768&&frame.len()==end+4+n
 })
}
#[derive(Debug,Clone,Copy,PartialEq,Eq)]pub(crate) enum SourceRole{Issuer,Anchor}
#[derive(Clone,Copy,PartialEq,Eq)]enum SourcePurpose{Directory,FirstPrepared}
#[derive(Debug,Clone,Copy,PartialEq,Eq)]pub(crate) enum SourceError{Bounds,Thread,Foreign(i32),Pair,Unknown,Closed}
// The local pair/role comes from authenticated storage AAD, not device trust.
// No public pointer constructor, Send, clone, generic public signing method.
pub(crate) struct InfrastructurePair {
 classic:Option<NativeClassicOwnKey>,pq:*mut Pq,wrapping:*mut Wrapping,sealed:*mut SealedLauncher,
 role:SourceRole,custodian:Vec<u8>,thread:ThreadId,used:bool,unknown:bool,
 local:PhantomData<Rc<()>>,
 expected:Option<([u8;33],Box<[u8;2592]>)>,attempt:Option<RetainedSourceAttempt>,
 #[cfg(feature="abi5-final-native-link")]role_guard:Option<platform::ProtectedRole>,
}
impl InfrastructurePair {
 fn reload(credential_fd:i32,role:SourceRole,custodian:&[u8],alias:&std::ffi::CStr,generation:u64,classic_public:&[u8;33],pq_public:&[u8;2592],q:&SourcePqRecord,c:&SourceClassicRecord)->Result<Self,(SourceError,Self)> {
  Self::reload_from(WrappingSource::Fd(credential_fd),role,custodian,alias,generation,classic_public,pq_public,q,c)
 }
 fn reload_sealed(input:&crate::source_infrastructure::VerifiedSealedCredentialBorrow<'_>,q:&SourcePqRecord,c:&SourceClassicRecord)->Result<Self,(SourceError,Self)>{
  let(role,custodian,alias,generation,classic,pq)=input.storage();
  Self::reload_from(WrappingSource::Sealed(input),role,custodian,alias,generation,classic,pq,q,c)
 }
 fn reload_from(source:WrappingSource<'_>,role:SourceRole,custodian:&[u8],alias:&std::ffi::CStr,generation:u64,classic_public:&[u8;33],pq_public:&[u8;2592],q:&SourcePqRecord,c:&SourceClassicRecord)->Result<Self,(SourceError,Self)>{
  let mut owner=Self{classic:None,pq:std::ptr::null_mut(),wrapping:std::ptr::null_mut(),sealed:std::ptr::null_mut(),role,custodian:Vec::new(),thread:std::thread::current().id(),used:false,unknown:false,local:PhantomData,expected:None,attempt:None,#[cfg(feature="abi5-final-native-link")]role_guard:None};
  if custodian.is_empty()||custodian.len()>512||generation==0{return Err((SourceError::Bounds,owner))}
  owner.custodian=custodian.to_vec();
  let mut association=b"YNX/SOCIAL/INFRASTRUCTURE/V1\0".to_vec();association.push(match role{SourceRole::Issuer=>1,SourceRole::Anchor=>2});association.extend((custodian.len() as u32).to_be_bytes());association.extend(custodian);
  let b=Binding{alias:alias.as_ptr(),generation,classic:classic_public.as_ptr(),association:association.as_ptr(),association_size:association.len()};
  #[cfg(test)] SOURCE_RELOAD_FFI.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
  let sealed_input=match &source{WrappingSource::Sealed(input)=>Some(*input),_=>None};
  let rc=match source{WrappingSource::Fd(fd)=>unsafe{ynx_source_wrapping_open(fd,&mut owner.wrapping)},WrappingSource::Sealed(input)=>{
   if input.role()!=role||input.recheck().is_err(){return Err((SourceError::Unknown,owner))}
   // Sample BEFORE subtracting original verification elapsed time. Adding the
   // later remaining budget to this earlier sample cannot renew the window.
   let mut sampled_ns=0;let clock_rc=unsafe{ynx_source_sealed_role_monotonic_ns(&mut sampled_ns)};
   if clock_rc!=0{return Err((SourceError::Unknown,owner))}
   let (remaining_ns,not_before_ms,expires_ms)=match input.fixed_window(){Ok(w)=>w,Err(_)=>return Err((SourceError::Unknown,owner))};
   let monotonic_deadline_ns=match sampled_ns.checked_add(remaining_ns){Some(n)=>n,None=>return Err((SourceError::Unknown,owner))};
   let raw=input.original_raw();let context=SealedCredentialInput{raw:raw.as_ptr(),n:raw.len(),role:match role{SourceRole::Issuer=>1,SourceRole::Anchor=>2},purpose:input.purpose(),monotonic_deadline_ns,not_before_ms,expires_ms};
   let rc=unsafe{ynx_source_sealed_role_resolve_open(&context,&mut owner.sealed)};
   if input.recheck().is_err(){owner.unknown=true;return Err((if rc!=0{SourceError::Foreign(rc)}else{SourceError::Unknown},owner))}
   if rc!=0{return Err((SourceError::Foreign(rc),owner))}
   if owner.sealed.is_null(){return Err((SourceError::Unknown,owner))}
   if input.recheck().is_err(){owner.unknown=true;return Err((SourceError::Unknown,owner))}
   let rc=unsafe{ynx_source_sealed_role_wrapping_open(owner.sealed,&mut owner.wrapping)};
   if input.recheck().is_err(){owner.unknown=true;return Err((if rc!=0{SourceError::Foreign(rc)}else{SourceError::Unknown},owner))}rc
  }};if rc!=0{return Err((SourceError::Foreign(rc),owner))}
  let mut clear=Zeroizing::new(vec![0u8;256]);let mut n=0;
  if sealed_input.is_some_and(|input|input.recheck().is_err()){owner.unknown=true;return Err((SourceError::Unknown,owner))}
  let rc=unsafe{ynx_source_reload_records(owner.wrapping,&b,pq_public.as_ptr(),q,c,clear.as_mut_ptr(),&mut n,&mut owner.pq)};
  if sealed_input.is_some_and(|input|input.recheck().is_err()){owner.unknown=true;return Err((if rc!=0{SourceError::Foreign(rc)}else{SourceError::Unknown},owner))}
  if rc!=0||n==0||n>256{return Err((SourceError::Foreign(rc),owner))}
  clear.truncate(n);
  let selected=SerializedClassicOwnKey::take_native_bytes(clear).and_then(|s|s.reload());
  let selected=match selected{Ok(p)=>p,Err(_)=>return Err((SourceError::Pair,owner))};
  if selected.public_identity().serialize().as_ref()!=classic_public{return Err((SourceError::Pair,owner))}
  if !owner.sealed.is_null()&&unsafe{ynx_source_sealed_role_current(owner.sealed)}!=0{return Err((SourceError::Unknown,owner))}
  if sealed_input.is_some_and(|input|input.recheck().is_err()){owner.unknown=true;return Err((SourceError::Unknown,owner))}
  owner.expected=Some((*classic_public,Box::new(*pq_public)));owner.classic=Some(selected);Ok(owner)
 }
 // Module-private only: not exported to Go/JNI or callable from a public frame.
 // Actual provisioning/current-operation permission and retained through-sign
 // supplier are still absent. This body must not be enabled just because an
 // artifact is unpublished. Custody below is functional, NOT authorization.
 fn sign_original_source_frame(&mut self,original:&SourceAttemptBinding)->Result<&RetainedSourceAttempt,SourceError>{
  // Retained observation only. Unqualified storage custody cannot create/run an
  // attempt; the sole normal effect route is the post-claim role owner below.
  self.observe_original(original)
 }
 #[cfg(feature="abi5-final-native-link")]
 fn prepare_role_ready(&mut self)->Result<(),SourceError>{
  if self.thread!=std::thread::current().id(){return Err(SourceError::Thread)}if self.attempt.is_some()||self.used||self.unknown{return Err(SourceError::Unknown)}
  let original=self.role_guard.as_mut().ok_or(SourceError::Closed)?.binding().map_err(|_|SourceError::Unknown)?;
  let expected=self.expected.as_ref().ok_or(SourceError::Closed)?;
  if self.role!=original.role||self.custodian!=original.custodian||expected.0!=original.classic_public||expected.1.as_ref()!=original.pq_public.as_ref(){return Err(SourceError::Pair)}
  if self.pq.is_null()||self.classic.is_none(){return Err(SourceError::Closed)}
  self.attempt=Some(RetainedSourceAttempt::new(original));Ok(())
 }
 #[cfg(feature="abi5-final-native-link")]
 fn retain_claimed_unknown(&mut self){self.used=true;self.unknown=true;if let Some(g)=self.role_guard.as_mut(){g.invalidate()}if let Some(a)=self.attempt.as_mut(){a.fail(AttemptStage::Cancel,SourceError::Unknown)}}
 #[cfg(feature="abi5-final-native-link")]
 fn run_claimed_role(&mut self)->Result<(),SourceError>{
  if self.thread!=std::thread::current().id(){return Err(SourceError::Thread)}if self.used||self.unknown{return Err(SourceError::Unknown)}
  if !self.attempt.as_ref().is_some_and(|a|a.phase==AttemptPhase::Ready){return Err(SourceError::Unknown)}
  let guard=self.role_guard.as_mut().ok_or(SourceError::Closed)?;
  if !self.sealed.is_null()&&unsafe{ynx_source_sealed_role_current(self.sealed)}!=0{return Err(SourceError::Unknown)}
  guard.current().map_err(|_|SourceError::Unknown)?;
  self.used=true;self.unknown=true; // reserve before actual protected enter
  if guard.enter().is_err(){self.attempt.as_mut().unwrap().fail(AttemptStage::Cancel,SourceError::Unknown);return Err(SourceError::Unknown)}
  let classic=self.classic.as_ref().ok_or(SourceError::Closed)?;let pq=self.pq;
  self.attempt.as_mut().unwrap().run_once(|f|classic.sign_pair_transcript(f).map_err(|_|SourceError::Pair),|f,b,n|unsafe{veil_own_sign_public_proof(pq,f.as_ptr(),f.len(),b.as_mut_ptr(),n)});
  if (!self.sealed.is_null()&&unsafe{ynx_source_sealed_role_current(self.sealed)}!=0)||guard.current().is_err(){guard.invalidate();self.attempt.as_mut().unwrap().fail(AttemptStage::Cancel,SourceError::Unknown);return Err(SourceError::Unknown)}Ok(())
 }
 // Exact binding is required even for read-only retrieval. No secret exports.
 fn observe_original(&self,original:&SourceAttemptBinding)->Result<&RetainedSourceAttempt,SourceError>{
  if self.thread!=std::thread::current().id(){return Err(SourceError::Thread)}
  let a=self.attempt.as_ref().ok_or(SourceError::Closed)?;
  if &a.original!=original{return Err(SourceError::Pair)};Ok(a)
 }
 fn sealed_current(&self)->Result<(),SourceError>{
  if self.thread!=std::thread::current().id(){return Err(SourceError::Thread)}
  if !self.sealed.is_null()&&unsafe{ynx_source_sealed_role_current(self.sealed)}!=0{return Err(SourceError::Unknown)}Ok(())
 }
 pub(crate) fn close(&mut self)->Result<(),SourceError>{
  // Uncollected result stays with its original owner; close is not cancellation.
  if self.attempt.is_some(){return Err(SourceError::Unknown)}
  if self.thread!=std::thread::current().id(){return Err(SourceError::Thread)}
  if !self.pq.is_null(){let rc=unsafe{veil_own_close(&mut self.pq)};if rc!=0{return Err(SourceError::Foreign(rc))}}
  if !self.wrapping.is_null(){let rc=unsafe{ynx_source_wrapping_close(&mut self.wrapping)};if rc!=0{return Err(SourceError::Foreign(rc))}}
  #[cfg(feature="abi5-final-native-link")]if let Some(g)=self.role_guard.as_mut(){g.close().map_err(|_|SourceError::Unknown)?;self.role_guard=None;}
  self.classic=None;
  if !self.sealed.is_null(){let rc=unsafe{ynx_source_sealed_role_close(&mut self.sealed)};if rc!=0{self.unknown=true;return Err(SourceError::Foreign(rc))}}
  Ok(())
 }
}
impl Drop for InfrastructurePair{fn drop(&mut self){if self.close().is_err(){std::process::abort();}}} // failstop, NOT durable recovery
fn source_frame_matches(role:SourceRole,frame:&[u8])->bool{
 let prefix=b"YNX/SOCIAL/SOURCE-PROOF/V1\0";
 if frame.len()>49152||!frame.starts_with(prefix){return false}
 let n=match frame.get(prefix.len()){Some(n)=>*n as usize,None=>return false};let start=prefix.len()+1;
 let end=match start.checked_add(n){Some(e)=>e,None=>return false};if frame.len()<end+4{return false}
 let expected:&[u8]=match role{SourceRole::Issuer=>b"directory-checkpoint",SourceRole::Anchor=>b"current-history"};
 if &frame[start..end]!=expected{return false}
 let size=u32::from_be_bytes(frame[end..end+4].try_into().unwrap()) as usize;
 size>0&&size<=32768&&frame.len()==end+4+size
}
#[cfg(test)]mod tests{use super::*;#[test]fn source_role_public_frames(){for (role,text) in [(SourceRole::Issuer,"directory-checkpoint"),(SourceRole::Anchor,"current-history")]{let mut b=b"YNX/SOCIAL/SOURCE-PROOF/V1\0".to_vec();b.push(text.len() as u8);b.extend(text.as_bytes());b.extend(2u32.to_be_bytes());b.extend(b"{}");assert!(source_frame_matches(role,&b));assert!(!source_frame_matches(if role==SourceRole::Issuer{SourceRole::Anchor}else{SourceRole::Issuer},&b));b.push(0);assert!(!source_frame_matches(role,&b));}}}
#[cfg(test)]static SOURCE_RELOAD_FFI:std::sync::atomic::AtomicUsize=std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]mod source_metadata_controls {
 use super::*;
 #[test]fn sii_custodian_bounds_before_clone_and_ffi(){
  let alias=std::ffi::CString::new("ynx.social.ownkey.v1.0123456789abcdef0123456789abcdef").unwrap();
  let q=SourcePqRecord{version:0,aad_size:0,aad:[0;7168],nonce:[0;12],cipher:[0;4912]};
  let c=SourceClassicRecord{version:0,aad_size:0,cipher_size:0,aad:[0;7168],nonce:[0;12],cipher:[0;272]};
  for (n,generation) in [(0,1),(512,1),(513,1),(1024*1024,1),(512,0)] {
   let borrowed=vec![b'x';n];SOURCE_RELOAD_FFI.store(0,std::sync::atomic::Ordering::SeqCst);
   // -1 is an invalid FD: no credential/key operation, even at accepted bound.
   let result=InfrastructurePair::reload(-1,SourceRole::Issuer,&borrowed,&alias,generation,&[0;33],&[0;2592],&q,&c);
   let (_,owner)=match result{Err(e)=>e,Ok(_)=>panic!("invalid FD acquired owner")};
   let valid=n==512&&generation==1;
   assert_eq!(owner.custodian.len(),if valid{512}else{0},"copied refused borrowed input");
   assert_eq!(owner.custodian.capacity(),if valid{512}else{0},"allocated refused borrowed input");
   assert_eq!(SOURCE_RELOAD_FFI.load(std::sync::atomic::Ordering::SeqCst),if valid{1}else{0});
  }
 }
}

// Private storage binding, not a permit. No exported constructor or raw-frame
// signing entry. Future owning transport must associate actual durable dispatch
// AND actual role/currentness permission before calling the private crypto body.
#[derive(Clone,PartialEq,Eq)]
pub(crate) struct SourceAttemptBinding {
 purpose:SourcePurpose,
 operation:Vec<u8>,nonce:[u8;32],sequence:u64,head:[u8;32],role:SourceRole,
 custodian:Vec<u8>,classic_public:[u8;33],pq_public:Box<[u8;2592]>,frame:Vec<u8>,
}
impl SourceAttemptBinding {
 fn bounded(operation:&[u8],nonce:[u8;32],sequence:u64,head:[u8;32],role:SourceRole,custodian:&[u8],classic_public:[u8;33],pq_public:&[u8;2592],frame:&[u8])->Result<Self,SourceError>{
  if operation.is_empty()||operation.len()>128||custodian.is_empty()||custodian.len()>512||classic_public[0]!=5||!source_frame_matches(role,frame){return Err(SourceError::Bounds)}
  // Validate borrowed text before copying or installing an attempt. Byte limits
  // remain unchanged; never normalize or repair an immutable original binding.
  if std::str::from_utf8(operation).is_err()||std::str::from_utf8(custodian).is_err(){return Err(SourceError::Bounds)}
  Ok(Self{purpose:SourcePurpose::Directory,operation:operation.to_vec(),nonce,sequence,head,role,custodian:custodian.to_vec(),classic_public,pq_public:Box::new(*pq_public),frame:frame.to_vec()})
 }
}
#[derive(Debug,Clone,Copy,PartialEq,Eq)]enum AttemptPhase{Ready,Unknown,Partial,Complete}
#[derive(Debug,Clone,Copy,PartialEq,Eq)]enum AttemptStage{Classic,Pq,Panic,Cancel}
struct RetainedSourceAttempt {
 original:SourceAttemptBinding,phase:AttemptPhase,
 classic:Option<Box<[u8]>>,pq:Vec<u8>,cause:Option<(AttemptStage,SourceError)>,
 // Error-retention only; never qualification or permission. First cause stays intact.
 uncertain:bool,
 thread:ThreadId,local:PhantomData<Rc<()>>,
}
impl RetainedSourceAttempt {
 fn new(original:SourceAttemptBinding)->Self{Self{original,phase:AttemptPhase::Ready,classic:None,pq:Vec::new(),cause:None,uncertain:false,thread:std::thread::current().id(),local:PhantomData}}
 fn fail(&mut self,stage:AttemptStage,error:SourceError){
  if matches!(stage,AttemptStage::Panic|AttemptStage::Cancel)||matches!(error,SourceError::Unknown|SourceError::Foreign(5)){self.uncertain=true;}
  if self.cause.is_none(){self.cause=Some((stage,error));}
  self.phase=if self.classic.as_ref().is_some_and(|x|!x.is_empty())||!self.pq.is_empty(){AttemptPhase::Partial}else{AttemptPhase::Unknown};
 }
 fn collection_eligible(&self)->bool{
  !self.uncertain && matches!(self.phase,AttemptPhase::Partial|AttemptPhase::Complete) && !matches!(self.cause,Some((AttemptStage::Panic|AttemptStage::Cancel,_))|Some((_,SourceError::Unknown|SourceError::Foreign(5))))
 }
 // Private shared control flow. Only the actual selected primitives above are
 // passed in normal code; controlled replacements occur solely under cfg(test).
 fn run_once<C,P>(&mut self,classic:C,pq:P)
 where C:FnOnce(&[u8])->Result<Box<[u8]>,SourceError>,P:FnOnce(&[u8],&mut [u8],&mut usize)->i32 {
  if self.phase!=AttemptPhase::Ready{return}
  if self.thread!=std::thread::current().id(){self.fail(AttemptStage::Cancel,SourceError::Thread);return}
  self.phase=AttemptPhase::Unknown; // reserve once before any selected call
  let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
   match classic(&self.original.frame){
    Ok(a)=>{self.classic=Some(a);if self.classic.as_ref().unwrap().len()!=64{self.fail(AttemptStage::Classic,SourceError::Pair);return}},
    Err(e)=>{self.fail(AttemptStage::Classic,e);return}
   }
   // Owner holds the classical result BEFORE the PQ invocation/possible unwind.
   self.pq=vec![0;4627];let mut written=0;
   let rc=pq(&self.original.frame,&mut self.pq,&mut written);
   if written>self.pq.len(){self.fail(AttemptStage::Pq,SourceError::Bounds);return}
   self.pq.truncate(written);
   if rc!=0{self.fail(AttemptStage::Pq,SourceError::Foreign(rc));return}
   if written!=4627{self.fail(AttemptStage::Pq,SourceError::Bounds);return}
   self.phase=AttemptPhase::Complete;
  }));
  if result.is_err(){self.fail(AttemptStage::Panic,SourceError::Unknown)}
 }
 fn cancel(&mut self){if self.phase==AttemptPhase::Ready{self.fail(AttemptStage::Cancel,SourceError::Unknown)}}
}

#[cfg(test)]mod source_attempt_controls {
 use super::*;use std::cell::Cell;
 fn original()->SourceAttemptBinding{
  let role=b"directory-checkpoint";let mut f=b"YNX/SOCIAL/SOURCE-PROOF/V1\0".to_vec();f.push(role.len() as u8);f.extend(role);f.extend(2u32.to_be_bytes());f.extend(b"{}");
  let mut c=[1;33];c[0]=5;SourceAttemptBinding::bounded(b"PUBLIC TEST ONLY operation",[2;32],7,[3;32],SourceRole::Issuer,b"PUBLIC TEST ONLY custodian",c,&[4;2592],&f).unwrap()
 }
 #[test]fn partial_once_pq_error_retains_original(){
  let b=original();let mut a=RetainedSourceAttempt::new(b.clone());let calls=Cell::new(0);
  a.run_once(|_|{calls.set(calls.get()+1);Ok(vec![0x51;64].into_boxed_slice())},|_,_,n|{calls.set(calls.get()+1);*n=0;17});
  assert_eq!(a.phase,AttemptPhase::Partial);assert_eq!(a.classic.as_deref(),Some(&[0x51;64][..]));assert_eq!(a.cause,Some((AttemptStage::Pq,SourceError::Foreign(17))));assert!(a.original==b);
  a.run_once(|_|panic!("resign"),|_,_,_|panic!("resign"));a.cancel();assert_eq!(calls.get(),2);assert_eq!(a.cause,Some((AttemptStage::Pq,SourceError::Foreign(17))));
 }
 #[test]fn pq_panic_and_classic_failure_do_not_retry(){
  let mut a=RetainedSourceAttempt::new(original());
  a.run_once(|_|Ok(vec![0x52;64].into_boxed_slice()),|_,_,_|panic!("PUBLIC controlled PQ unwind"));
  assert_eq!(a.phase,AttemptPhase::Partial);assert_eq!(a.classic.as_ref().unwrap().len(),64);assert_eq!(a.cause,Some((AttemptStage::Panic,SourceError::Unknown)));
  a.run_once(|_|panic!("resign"),|_,_,_|panic!("resign"));
  let mut b=RetainedSourceAttempt::new(original());b.run_once(|_|Err(SourceError::Pair),|_,_,_|panic!("PQ after classical error"));assert_eq!(b.phase,AttemptPhase::Unknown);assert!(b.classic.is_none());
 }
 #[test]fn complete_and_pre_cancel_are_only_custody(){
  let mut a=RetainedSourceAttempt::new(original());a.run_once(|_|Ok(vec![0x53;64].into_boxed_slice()),|_,p,n|{p.fill(0x54);*n=p.len();0});assert_eq!(a.phase,AttemptPhase::Complete);assert_eq!(a.pq.len(),4627);assert_eq!(a.cause,None);
  a.cancel();a.run_once(|_|panic!("resign"),|_,_,_|panic!("resign"));assert_eq!(a.phase,AttemptPhase::Complete);
  let mut b=RetainedSourceAttempt::new(original());b.cancel();b.run_once(|_|panic!("cancelled sign"),|_,_,_|panic!("cancelled sign"));assert_eq!(b.phase,AttemptPhase::Unknown);
 }
 #[test]fn exact_binding_and_bounds(){
  let a=original();let mut changed=a.clone();changed.frame[0]^=1;assert!(a!=changed);changed=a.clone();changed.nonce[0]^=1;assert!(a!=changed);changed=a.clone();changed.custodian.push(0);assert!(a!=changed);
  assert!(SourceAttemptBinding::bounded(&[0;129],a.nonce,a.sequence,a.head,a.role,&a.custodian,a.classic_public,&a.pq_public,&a.frame).is_err());
  assert!(SourceAttemptBinding::bounded(&a.operation,a.nonce,a.sequence,a.head,a.role,&[0;513],a.classic_public,&a.pq_public,&a.frame).is_err());
 }
}

#[cfg(test)]mod source_attempt_owner_controls {
 use super::*;
 #[test]fn source_attempt_controls_actual_owner_observe_mismatch_close(){
  let mut frame=b"YNX/SOCIAL/SOURCE-PROOF/V1\0".to_vec();frame.push(20);frame.extend(b"directory-checkpoint");frame.extend(2u32.to_be_bytes());frame.extend(b"{}");
  let mut c=[1;33];c[0]=5;
  let b=SourceAttemptBinding::bounded(b"PUBLIC ONLY",[2;32],1,[3;32],SourceRole::Issuer,b"PUBLIC custodian",c,&[4;2592],&frame).unwrap();
  let mut attempt=RetainedSourceAttempt::new(b.clone());
  attempt.run_once(|_|Ok(vec![7;64].into_boxed_slice()),|_,_,_|17);
  // A result-only fixture: no foreign/native key handle or authority is minted.
  let mut owner=InfrastructurePair{classic:None,pq:std::ptr::null_mut(),wrapping:std::ptr::null_mut(),sealed:std::ptr::null_mut(),role:b.role,custodian:b.custodian.clone(),thread:std::thread::current().id(),used:true,unknown:true,local:PhantomData,expected:None,attempt:Some(attempt),#[cfg(feature="abi5-final-native-link")]role_guard:None};
  let before=owner.observe_original(&b).unwrap() as *const RetainedSourceAttempt;
  assert_eq!(owner.sign_original_source_frame(&b).unwrap() as *const RetainedSourceAttempt,before);
  let mut wrong=b.clone();wrong.operation.push(0);
  assert!(matches!(owner.sign_original_source_frame(&wrong),Err(SourceError::Pair)));
  assert!(matches!(owner.observe_original(&wrong),Err(SourceError::Pair)));
  assert_eq!(owner.close(),Err(SourceError::Unknown));assert_eq!(owner.close(),Err(SourceError::Unknown));
  assert_eq!(owner.observe_original(&b).unwrap() as *const RetainedSourceAttempt,before);
  // Explicit test-only teardown of public fixture result; NOT a normal durable
  // acknowledgement port. Production result discharge remains unimplemented.
  drop(owner.attempt.take());assert_eq!(owner.close(),Ok(()));
 }
}

impl RetainedSourceAttempt {
 // Private bounded result transport, NOT Signal wire and NOT an authorization.
 // Contains only original public metadata/frame and public signature artifacts.
 fn encode_unverified_outcome(&self)->Result<Vec<u8>,SourceError>{
  if self.thread!=std::thread::current().id(){return Err(SourceError::Thread)}
  let phase=match self.phase{AttemptPhase::Ready=>return Err(SourceError::Closed),AttemptPhase::Unknown=>1,AttemptPhase::Partial=>2,AttemptPhase::Complete=>3};
  let (stage,code)=match self.cause {
   None if self.phase==AttemptPhase::Complete=>(0,0i32),
   Some((stage,error))=>(match stage{AttemptStage::Classic=>1,AttemptStage::Pq=>2,AttemptStage::Panic=>3,AttemptStage::Cancel=>4},match error{SourceError::Foreign(n)=>n,SourceError::Unknown=>-1,SourceError::Pair=>-2,SourceError::Bounds=>-3,SourceError::Thread=>-4,SourceError::Closed=>-5}),
   _=>(3,-1),
  };
  let classic=self.classic.as_deref().unwrap_or(&[]);
  if classic.len()>64||self.pq.len()>4627{return Err(SourceError::Bounds)}
  let b=&self.original;
  if b.operation.is_empty()||b.operation.len()>128||b.custodian.is_empty()||b.custodian.len()>512||std::str::from_utf8(&b.operation).is_err()||std::str::from_utf8(&b.custodian).is_err(){return Err(SourceError::Bounds)}
  let mut out=Vec::with_capacity(58000);
  out.extend(b"YNX/SOCIAL/SOURCE-OUTCOME/V1\0");out.push(match (b.purpose,b.role){(SourcePurpose::Directory,SourceRole::Issuer)=>1,(SourcePurpose::Directory,SourceRole::Anchor)=>2,(SourcePurpose::FirstPrepared,SourceRole::Issuer)=>3,(SourcePurpose::FirstPrepared,SourceRole::Anchor)=>4});
  out.extend((b.operation.len() as u16).to_be_bytes());out.extend(&b.operation);
  out.extend(b.nonce);out.extend(b.sequence.to_be_bytes());out.extend(b.head);
  out.extend((b.custodian.len() as u16).to_be_bytes());out.extend(&b.custodian);
  out.extend(b.classic_public);out.extend(b.pq_public.as_ref());out.extend((b.frame.len() as u32).to_be_bytes());out.extend(&b.frame);
  out.push(phase);out.push(stage);out.extend(code.to_be_bytes());
  out.extend((classic.len() as u16).to_be_bytes());out.extend(classic);
  out.extend((self.pq.len() as u16).to_be_bytes());out.extend(&self.pq);
  Ok(out)
 }
}
#[cfg(test)]mod source_attempt_wire_controls {
 use super::*;use std::io::Write;
 #[test]fn source_attempt_controls_public_cross_language_carrier(){
  let role=b"directory-checkpoint";let mut frame=b"YNX/SOCIAL/SOURCE-PROOF/V1\0".to_vec();frame.push(role.len() as u8);frame.extend(role);frame.extend(2u32.to_be_bytes());frame.extend(b"{}");let mut c=[1;33];c[0]=5;
  let b=SourceAttemptBinding::bounded(b"PUBLIC TEST ONLY operation",[2;32],7,[3;32],SourceRole::Issuer,b"PUBLIC TEST ONLY custodian",c,&[4;2592],&frame).unwrap();
  let mut a=RetainedSourceAttempt::new(b);assert!(a.encode_unverified_outcome().is_err());
  a.run_once(|_|Ok(vec![0x51;64].into_boxed_slice()),|_,_,_|17);
  let one=a.encode_unverified_outcome().unwrap();let two=a.encode_unverified_outcome().unwrap();assert_eq!(one,two);assert!(one.len()<58000);
  if let Some(dir)=std::env::var_os("YNX_SOURCE_PUBLIC_OUTCOME_FIXTURE_DIR"){
   let path=std::path::PathBuf::from(dir).join("PUBLIC-ONLY-native-partial.bin");
   let mut f=std::fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap();f.write_all(&one).unwrap();f.sync_all().unwrap();
  }
 }
}

#[cfg(test)]mod source_utf8_controls {
 use super::*;use std::cell::Cell;use std::io::Write;
 fn binding(op:&[u8],custodian:&[u8])->Result<SourceAttemptBinding,SourceError>{
  let role=b"directory-checkpoint";let mut frame=b"YNX/SOCIAL/SOURCE-PROOF/V1\0".to_vec();frame.push(role.len() as u8);frame.extend(role);frame.extend(2u32.to_be_bytes());frame.extend(b"{}");let mut c=[1;33];c[0]=5;
  SourceAttemptBinding::bounded(op,[2;32],7,[3;32],SourceRole::Issuer,custodian,c,&[4;2592],&frame)
 }
 fn rejected_before_install(op:&[u8],custodian:&[u8]){
  let installed=Cell::new(0);let effects=Cell::new(0);
  let result=binding(op,custodian);let rejected=result.is_err();
  if let Ok(b)=result{installed.set(installed.get()+1);let mut a=RetainedSourceAttempt::new(b);a.run_once(|_|{effects.set(effects.get()+1);Err(SourceError::Pair)},|_,_,_|panic!("unexpected PQ"));}
  assert!(rejected,"invalid UTF-8 accepted by borrowed constructor");assert_eq!(installed.get(),0);assert_eq!(effects.get(),0);
 }
 #[test]fn source_utf8_invalid_operation(){for invalid in [&[0xff][..],&[0xe4,0xb8],&[0xe4,0x28,0xad],&[0xc0,0xaf]]{rejected_before_install(invalid,b"PUBLIC custodian");}}
 #[test]fn source_utf8_invalid_custodian(){for invalid in [&[0xff][..],&[0xf0,0x9f,0x99],&[0xf0,0x28,0x8c,0xbc],&[0xed,0xa0,0x80]]{rejected_before_install(b"PUBLIC operation",invalid);}}
 #[test]fn source_utf8_valid_multibyte_byte_limits(){
  let op="\u{e9}".repeat(64);let custodian="\u{1f642}".repeat(128);
  assert_eq!(op.len(),128);assert_eq!(custodian.len(),512);
  let b=binding(op.as_bytes(),custodian.as_bytes()).unwrap();assert_eq!(b.operation,op.as_bytes());assert_eq!(b.custodian,custodian.as_bytes());
  assert!(binding(format!("{op}x").as_bytes(),custodian.as_bytes()).is_err());assert!(binding(op.as_bytes(),format!("{custodian}x").as_bytes()).is_err());
  rejected_before_install(&op.as_bytes()[..127],custodian.as_bytes());rejected_before_install(op.as_bytes(),&custodian.as_bytes()[..511]);
 }
 #[test]fn source_utf8_encoder_defense(){
  for field in 0..2{let b=binding(b"PUBLIC operation",b"PUBLIC custodian").unwrap();let mut a=RetainedSourceAttempt::new(b);a.cancel();if field==0{a.original.operation[0]=0xff}else{a.original.custodian[0]=0xff};assert!(a.encode_unverified_outcome().is_err());}
 }
 #[test]fn source_utf8_cross_language_boundary_fixture(){
  let op="\u{e9}".repeat(64);let custodian="\u{1f642}".repeat(128);let b=binding(op.as_bytes(),custodian.as_bytes()).unwrap();
  let mut a=RetainedSourceAttempt::new(b);a.run_once(|_|Ok(vec![0x51;64].into_boxed_slice()),|_,_,_|17);
  let raw=a.encode_unverified_outcome().unwrap();assert_eq!(raw,a.encode_unverified_outcome().unwrap());
  let dir=std::env::var_os("YNX_SOURCE_PUBLIC_UTF8_FIXTURE_DIR").expect("select exact public fixture output");
  let path=std::path::PathBuf::from(dir).join("PUBLIC-ONLY-native-utf8-boundary.bin");
  let mut f=std::fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap();f.write_all(&raw).unwrap();f.sync_all().unwrap();
 }
}

// Server-only Go SIGNING journal transport; original client custody stays.
#[cfg(all(feature="source-server-collector",target_os="android"))]
compile_error!("SOURCE_SERVER_COLLECTOR_NOT_AN_ANDROID_CLIENT_CAPABILITY");
#[cfg(feature="source-server-collector")]
#[path="source_collector.rs"]mod source_collector;
#[path="source_first_prepared_attempt.rs"]mod first_prepared_attempt;
#[path="source_first_prepared_holder.rs"]mod first_prepared_holder;
pub(crate) use first_prepared_holder::{FirstPreparedProtectedHolder,FirstPreparedHolderOpenFailure};
#[cfg(feature="abi5-final-native-link")]
pub(crate) use first_prepared_holder::{FirstPreparedOriginalBorrow,FirstPreparedRecoveryFailure};
// Existing sealed/first-device custody and original-borrow FFI remain.
// Only the owning Go collector transfer selects the separate server feature.
#[cfg(feature="source-collector-bridge")]
#[path="source_first_prepared_holder_ffi.rs"]mod first_prepared_holder_ffi;
#[cfg(all(feature="source-collector-bridge",feature="abi5-final-native-link"))]
pub(crate)use first_prepared_holder_ffi::server_participant::{ServerCoreLink,link_first_device_core};

#[cfg(test)]mod ready_collector_mechanical_controls{
 use super::*;use std::cell::Cell;
 fn original()->SourceAttemptBinding{let role=SourceRole::Issuer;let mut frame=b"YNX/SOCIAL/SOURCE-PROOF/V1\0".to_vec();frame.push(20);frame.extend(b"directory-checkpoint");frame.extend(2u32.to_be_bytes());frame.extend(b"{}");let mut pk=[1;33];pk[0]=5;SourceAttemptBinding::bounded(b"PUBLIC-READY",[2;32],9,[3;32],role,b"PUBLIC-CUSTODIAN",pk,&[4;2592],&frame).unwrap()}
 fn pair(a:Option<RetainedSourceAttempt>)->InfrastructurePair{InfrastructurePair{classic:None,pq:std::ptr::null_mut(),wrapping:std::ptr::null_mut(),sealed:std::ptr::null_mut(),role:SourceRole::Issuer,custodian:b"PUBLIC-CUSTODIAN".to_vec(),thread:std::thread::current().id(),used:false,unknown:false,local:PhantomData,expected:None,attempt:a,#[cfg(feature="abi5-final-native-link")]role_guard:None}}
 #[test]fn ready_carries_same_original_without_signature(){let o=original();let a=RetainedSourceAttempt::new(o.clone());assert!(a.original==o);assert_eq!(a.phase,AttemptPhase::Ready);assert!(a.classic.is_none());assert!(a.pq.is_empty());assert!(a.encode_unverified_outcome().is_err());}
 #[test]fn cancelled_ready_never_executes(){let calls=Cell::new(0);let mut a=RetainedSourceAttempt::new(original());a.cancel();a.run_once(|_|{calls.set(1);Ok(vec![1;64].into_boxed_slice())},|_,_,_|panic!("PQ"));assert_eq!(calls.get(),0);assert_eq!(a.phase,AttemptPhase::Unknown);}
 #[test]fn once_partial_preserves_original_and_first_failure(){let calls=Cell::new(0);let o=original();let mut a=RetainedSourceAttempt::new(o.clone());a.run_once(|_|{calls.set(calls.get()+1);Ok(vec![0xa5;64].into_boxed_slice())},|_,_,_|17);a.run_once(|_|panic!("repeat"),|_,_,_|panic!("repeat"));assert_eq!(calls.get(),1);assert!(a.original==o);assert_eq!(a.phase,AttemptPhase::Partial);assert_eq!(a.cause,Some((AttemptStage::Pq,SourceError::Foreign(17))));}
 #[cfg(all(feature="abi5-final-native-link",feature="source-server-collector"))]
 #[test]fn ready_storage_pair_without_qualified_role_refuses_transfer(){let p=pair(Some(RetainedSourceAttempt::new(original())));let mut returned=match p.retain_for_collection(){Err(p)=>p,Ok(_)=>panic!("storage gave qualification")};assert_eq!(returned.attempt.as_ref().unwrap().phase,AttemptPhase::Ready);drop(returned.attempt.take());assert!(returned.close().is_ok());}
 #[cfg(feature="abi5-final-native-link")]
 #[test]fn run_without_qualified_owner_preserves_ready(){let mut p=pair(Some(RetainedSourceAttempt::new(original())));assert_eq!(p.run_claimed_role(),Err(SourceError::Closed));assert_eq!(p.attempt.as_ref().unwrap().phase,AttemptPhase::Ready);assert!(!p.used);drop(p.attempt.take());assert!(p.close().is_ok());}
 #[cfg(feature="abi5-final-native-link")]
 #[test]fn preparation_does_not_construct_qualification(){let mut p=pair(None);assert_eq!(p.prepare_role_ready(),Err(SourceError::Closed));assert!(p.attempt.is_none());assert!(!p.used);assert!(p.close().is_ok());}
}

#[cfg(all(test,feature="abi5-final-native-link"))]mod claimed_failure_delta_controls{
 use super::*;
 #[test]fn accepted_claim_late_failure_never_returns_to_ready(){let mut frame=b"YNX/SOCIAL/SOURCE-PROOF/V1\0".to_vec();frame.push(20);frame.extend(b"directory-checkpoint");frame.extend(2u32.to_be_bytes());frame.extend(b"{}");let mut pk=[1;33];pk[0]=5;let b=SourceAttemptBinding::bounded(b"PUBLIC-CLAIM",[2;32],7,[3;32],SourceRole::Issuer,b"PUBLIC-CUSTODIAN",pk,&[4;2592],&frame).unwrap();let mut p=InfrastructurePair{classic:None,pq:std::ptr::null_mut(),wrapping:std::ptr::null_mut(),sealed:std::ptr::null_mut(),role:SourceRole::Issuer,custodian:b"PUBLIC-CUSTODIAN".to_vec(),thread:std::thread::current().id(),used:false,unknown:false,local:PhantomData,expected:None,attempt:Some(RetainedSourceAttempt::new(b)),role_guard:None};p.retain_claimed_unknown();assert!(p.used&&p.unknown);assert_eq!(p.attempt.as_ref().unwrap().phase,AttemptPhase::Unknown);assert_eq!(p.run_claimed_role(),Err(SourceError::Unknown));p.attempt.as_mut().unwrap().run_once(|_|panic!("late resign"),|_,_,_|panic!("late resign"));drop(p.attempt.take());assert!(p.close().is_ok());}
}

// Independently selected transport client. TLS custody is not a storage/floor
// capability. Native startup owns its selection; neither N-API nor Java has a
// constructor, private key parameter or callback installer for this object.
#[repr(C)]struct ExecutionClient{_private:[u8;0]}
#[repr(C)]struct ExecutionBytes{data:*const u8,size:usize}
unsafe extern "C"{
 fn ynx_private_execution_client_open(selected:*const MessageSealedRawInput,certificate:ExecutionBytes,digest:*const u8,out:*mut *mut ExecutionClient)->i32;
 fn ynx_private_execution_client_current(owner:*mut ExecutionClient)->i32;
 fn ynx_private_execution_client_exchange(owner:*mut ExecutionClient,fd:i32,host:*const c_char,path:*const c_char,spki:*const u8,deadline:u64,request:ExecutionBytes,sink:*mut u8,capacity:usize,written:*mut usize)->i32;
 fn ynx_private_execution_client_complete_response(owner:*mut ExecutionClient)->i32;
 fn ynx_private_execution_client_close(owner:*mut *mut ExecutionClient)->i32;
}
pub(crate)struct MessageTransportClient{
 owner:*mut ExecutionClient,thread:ThreadId,connection:Option<std::net::TcpStream>,unknown:bool,local:PhantomData<Rc<()>>,
}
impl MessageTransportClient{
 /// Private primitive input; the returned object DOES NOT admit registration,
 /// independent resources or a joint current/revocation/effect fence.
 pub(crate)fn open(input:&MessageSealedRawInput,certificate:&[u8],certificate_digest:&[u8;32])->Result<Self,(i32,Self)>{
  let mut p=Self{owner:std::ptr::null_mut(),thread:std::thread::current().id(),connection:None,unknown:false,local:PhantomData};
  let st=unsafe{ynx_private_execution_client_open(input,ExecutionBytes{data:certificate.as_ptr(),size:certificate.len()},certificate_digest.as_ptr(),&mut p.owner)};
  if st!=0||p.owner.is_null(){p.unknown=st==8;return Err((if st==0{8}else{st},p))}Ok(p)
 }
 pub(crate)fn current(&mut self)->Result<(),i32>{
  if self.thread!=std::thread::current().id(){return Err(4)}if self.unknown{return Err(8)}
  if self.owner.is_null(){return Err(1)}let st=unsafe{ynx_private_execution_client_current(self.owner)};
  if st!=0{self.unknown=true;Err(st)}else{Ok(())}
 }
 /// The stream is held through C cleanup, including partial TLS exchange.
 /// The caller obtains exactly one peer under the original immutable deadline.
 pub(crate)fn exchange(&mut self,stream:std::net::TcpStream,host:&std::ffi::CStr,path:&std::ffi::CStr,spki:&[u8;32],deadline:u64,request:&[u8],sink:&mut[u8])->(Result<(),i32>,usize){
  if let Err(st)=self.current(){return(Err(st),0)}
  if self.connection.is_some(){self.unknown=true;return(Err(8),0)}
  if stream.set_nonblocking(true).is_err(){return(Err(8),0)}
  self.connection=Some(stream);let mut written=0;
  use std::os::fd::AsRawFd;
  let fd=self.connection.as_ref().map(AsRawFd::as_raw_fd).unwrap_or(-1);
  let st=unsafe{ynx_private_execution_client_exchange(self.owner,fd,host.as_ptr(),path.as_ptr(),spki.as_ptr(),deadline,ExecutionBytes{data:request.as_ptr(),size:request.len()},sink.as_mut_ptr(),sink.len(),&mut written)};
  if written>sink.len(){self.unknown=true;return(Err(8),0)}
  if st!=0{self.unknown=true;(Err(st),written)}else{(Ok(()),written)}
 }
 pub(crate)fn complete_response(&mut self)->Result<(),i32>{
  self.current()?;let st=unsafe{ynx_private_execution_client_complete_response(self.owner)};
  if st!=0{self.unknown=true;return Err(st)}self.connection=None;Ok(())
 }
 pub(crate)fn close(&mut self)->Result<(),i32>{
  if self.thread!=std::thread::current().id(){return Err(4)}
  let st=unsafe{ynx_private_execution_client_close(&mut self.owner)};
  if st!=0||!self.owner.is_null(){self.unknown=true;return Err(if st!=0{st}else{8})}
  self.connection=None;Ok(())
 }
}
impl Drop for MessageTransportClient{fn drop(&mut self){if self.close().is_err(){std::process::abort()}}}

// Independent association slot. No public/SDK constructor or arbitrary frame
// signing API; normal factory must additionally bind the actual fresh native
// message input and protected through-effect reservation before calling here.
#[path="message_association_slot.rs"]mod message_association_slot;
impl MessageCustodyPair{
 fn sign_association_guard(&mut self,guard:&mut message_association_slot::AssociationKeyBorrow<'_>,permit:&crate::message_evidence::RootMessagePurposeBorrow<'_>,enrollment:&crate::message_enrollment::StartupEnrollment<'_>)->(Vec<u8>,Result<(),SourceError>){
  let role=match self.pair.role{SourceRole::Issuer=>1,SourceRole::Anchor=>2};
  let expected=match self.pair.expected.as_ref(){Some(v)=>v,None=>return(Vec::new(),Err(SourceError::Closed))};
  if permit.match_role_custody(enrollment,role,&self.pair.custodian,&expected.0,expected.1.as_ref()).is_err(){return(Vec::new(),Err(SourceError::Pair))}
  if let Err(e)=self.current(){return(Vec::new(),Err(e))}
  let(frame,pq)=match guard.claim(self.pair.role){Ok(v)=>v,Err(e)=>return(Vec::new(),Err(e))};
  let(mut bytes,mut result)=if pq{
   let mut bytes=vec![0u8;4627];let mut written=0usize;
   let code=unsafe{veil_own_sign_public_proof(self.pair.pq,frame.as_ptr(),frame.len(),bytes.as_mut_ptr(),&mut written)};
   if written<=bytes.len(){bytes.truncate(written);}
   let result=if code!=0{Err(SourceError::Foreign(code))}else if written!=4627{Err(SourceError::Unknown)}else{Ok(())};(bytes,result)
  }else{
   match self.pair.classic.as_ref().ok_or(SourceError::Closed).and_then(|k|k.sign_pair_transcript(frame).map_err(|_|SourceError::Pair)){
    Ok(bytes)=>{let result=if bytes.len()==64{Ok(())}else{Err(SourceError::Unknown)};(bytes.into_vec(),result)},
    Err(e)=>(Vec::new(),Err(e)),
   }
  };
  // Retain original public bytes BEFORE any late refusal. A primitive error is
  // the first cause even if Root/enrollment/current also fail afterward.
  if permit.match_role_custody(enrollment,role,&self.pair.custodian,&self.pair.expected.as_ref().unwrap().0,self.pair.expected.as_ref().unwrap().1.as_ref()).is_err()&&result.is_ok(){result=Err(SourceError::Pair)}
  if let Err(e)=self.current(){if result.is_ok(){result=Err(e)}}
  if result.is_err(){self.pair.unknown=true;}
  (std::mem::take(&mut bytes),result)
 }
}

impl MessageCustodyPair{
 // Root permit/resource/public binding + actual retained primitive current.
 // This is custody observation, not the independent through-effect namespace
 // reservation or permission to create a message signer from DATA.
 pub(crate)fn message_association_custody_current(&mut self,permit:&crate::message_evidence::RootMessagePurposeBorrow<'_>,enrollment:&crate::message_enrollment::StartupEnrollment<'_>)->Result<(),SourceError>{
  let role=match self.pair.role{SourceRole::Issuer=>1,SourceRole::Anchor=>2};
  let expected=self.pair.expected.as_ref().ok_or(SourceError::Closed)?;
  permit.match_role_custody(enrollment,role,&self.pair.custodian,&expected.0,expected.1.as_ref()).map_err(|_|SourceError::Pair)?;
  self.observe_current(enrollment)?;
  let expected=self.pair.expected.as_ref().ok_or(SourceError::Closed)?;
  permit.match_role_custody(enrollment,role,&self.pair.custodian,&expected.0,expected.1.as_ref()).map_err(|_|SourceError::Pair)?;
  self.current()
 }
}

// Contact server custody is independent from Android/client Message collectors.
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="source-server-collector"))]
#[path="source_infrastructure/contact_custody.rs"]mod contact_custody;
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="source-server-collector"))]
pub(crate)use contact_custody::{ContactRequestCustody,ContactAuthenticatedBinding,ContactCustodyPair};

#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="source-server-collector"))]
impl MessageCustodyPair{
pub(crate)fn sign_r5_guard(&mut self,guard:&mut crate::message_custody_ffi::r5_source_policy::operations::KeyGuard)->(Vec<u8>,Result<(),SourceError>){
  let(frame,pq)=match guard.claim(self.pair.role){Ok(v)=>v,Err(e)=>return(Vec::new(),Err(e))};
  if !r5_accepted_device_verification::frame_matches(self.pair.role,frame){return(Vec::new(),Err(SourceError::Pair))}
  if let Err(e)=self.current(){return(Vec::new(),Err(e))}
  let(mut bytes,mut status)=if pq{
   let mut bytes=vec![0u8;4627];let mut written=0usize;
   let code=unsafe{veil_own_sign_public_proof(self.pair.pq,frame.as_ptr(),frame.len(),bytes.as_mut_ptr(),&mut written)};
   if written<=bytes.len(){bytes.truncate(written);}
   let status=if code!=0{Err(SourceError::Foreign(code))}else if written!=4627{Err(SourceError::Unknown)}else{Ok(())};
   (bytes,status)
  }else{
   match self.pair.classic.as_ref().ok_or(SourceError::Closed).and_then(|k|k.sign_pair_transcript(frame).map_err(|_|SourceError::Pair)){
    Ok(bytes)=>{let status=if bytes.len()==64{Ok(())}else{Err(SourceError::Unknown)};(bytes.into_vec(),status)},
    Err(e)=>(Vec::new(),Err(e)),
   }
  };
  if let Err(e)=self.current(){if status.is_ok(){status=Err(e)}}
  if status.is_err(){self.pair.unknown=true;}
  (std::mem::take(&mut bytes),status)
 }
}

#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="source-server-collector"))]
#[path="source_infrastructure/prekey_pair.rs"]mod prekey_pair;


#[path="source_runtime_policy_key.rs"]mod fixed_runtime_policy_key;

#[path="ordinary_message_fd_pair.rs"]pub(crate)mod original_ordinary_message_pair;

#[path="ordinary_message_backend.rs"]pub(crate)mod original_ordinary_message_backend;

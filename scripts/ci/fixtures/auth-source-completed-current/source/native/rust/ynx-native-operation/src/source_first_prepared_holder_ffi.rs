//! Normal protected-holder custody ABI. No sign, grant or collector-owner API.
#![allow(unsafe_code)]
use super::*;
use super::first_prepared_holder::FirstPreparedHolderError;
use crate::source_evidence::Error as EvidenceError;
use std::{cell::RefCell,sync::atomic::{AtomicU64,Ordering}};

const KIND:u64=0x594e5853484f4c31;
#[repr(C)]#[derive(Clone,Copy,Default,PartialEq,Eq)]
pub(crate)struct HolderToken{kind:u64,serial:u64}
struct Slot{token:HolderToken,role:SourceRole,owner:Option<FirstPreparedProtectedHolder>,first:i32}
thread_local!{static HELD:RefCell<Vec<Slot>>=const{RefCell::new(Vec::new())};}
static NEXT:AtomicU64=AtomicU64::new(1);
fn code(e:&FirstPreparedHolderError)->i32{
 match e{
  FirstPreparedHolderError::Credential(e)=>match e{EvidenceError::Bounds|EvidenceError::Canonical=>1,EvidenceError::ProfileRequired=>73,EvidenceError::Signature=>74,EvidenceError::Binding=>75,EvidenceError::Window=>76},
  FirstPreparedHolderError::Custody(e)=>match e{SourceError::Bounds=>1,SourceError::Thread=>22,SourceError::Pair=>75,SourceError::Closed=>21,SourceError::Unknown|SourceError::Foreign(_)=>16},
  #[cfg(feature="abi5-final-native-link")]
  FirstPreparedHolderError::Platform(e)=>match e{platform::Error::Required=>1,platform::Error::Thread=>22,_=>16},
  #[cfg(feature="abi5-final-native-link")]
  FirstPreparedHolderError::Original(e)=>match e{crate::staging::platform::SourceOwnerError::Thread=>22,crate::staging::platform::SourceOwnerError::Association=>75,_=>16},
 }
}
fn boundary(f:impl FnOnce()->i32)->i32{std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(16)}

#[cfg(all(test,feature="predevice-initial-prekeys-v1"))]mod initial_prekey_holder_abi_controls{
 use super::*;
 #[test]fn r258_v4_holder_abi_rejects_invalid_purpose_and_role_before_slot_or_protection(){
  std::thread::spawn(||{
   let n=std::ptr::null();
   for(role,purpose)in[(1,0),(1,3),(3,1),(0,2)]{
    let mut out=HolderToken{kind:9,serial:9};
    assert_eq!(unsafe{ynx_source_sealed_role_holder_open_initial_prekeys_v2(role,purpose,n,0,n,0,n,0,&mut out)},1);
    assert!(out==HolderToken::default());assert!(HELD.with(|h|h.borrow().is_empty()));
   }
  }).join().unwrap();
 }
 #[test]fn r258_v4_holder_abi_missing_output_never_opens_or_issues_unknown_token(){
  assert_eq!(unsafe{ynx_source_sealed_role_holder_open_initial_prekeys_v2(1,2,std::ptr::null(),0,std::ptr::null(),0,std::ptr::null(),0,std::ptr::null_mut())},1);
 }
}

// Encrypted records are copied, not retained borrowed across FFI. No secret
// key, chosen public pair, alias, generation, permission flag or frame input.
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_source_first_prepared_holder_open_v1(fd:i32,role:u32,credential:*const u8,cn:usize,pq:*const u8,pn:usize,classic:*const u8,kn:usize,out:*mut HolderToken)->i32{
 boundary(||{
  if out.is_null(){return 1}
  unsafe{*out=HolderToken::default()};
  let role=match role{1=>SourceRole::Issuer,2=>SourceRole::Anchor,_=>return 1};
  if credential.is_null()||cn==0||cn>65536||pq.is_null()||pn!=std::mem::size_of::<SourcePqRecord>()||classic.is_null()||kn!=std::mem::size_of::<SourceClassicRecord>(){return 1}
  HELD.with(|held|{
   let Ok(mut slots)=held.try_borrow_mut()else{return 16};
   if slots.len()>=2||slots.iter().any(|s|s.role==role){return 16}
   let serial=match NEXT.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|n|if n==u64::MAX{None}else{Some(n+1)}){Ok(n)=>n,Err(_)=>return 16};
   let token=HolderToken{kind:KIND,serial};
   // Reserve identity BEFORE potentially opening any custody. An unwind keeps
   // this same unknown slot and cannot create another same-role owner.
   slots.push(Slot{token,role,owner:None,first:16});unsafe{*out=token};
   let raw=unsafe{std::slice::from_raw_parts(credential,cn)};
   let q=unsafe{std::ptr::read_unaligned(pq.cast::<SourcePqRecord>())};
   let c=unsafe{std::ptr::read_unaligned(classic.cast::<SourceClassicRecord>())};
   match FirstPreparedProtectedHolder::open(fd,role,raw,&q,&c){
    Ok(owner)=>{let s=slots.last_mut().unwrap();s.owner=Some(owner);s.first=0;0},
    Err(failure)=>{
     let result=code(&failure.error);
     if let Some(owner)=failure.retained{let s=slots.last_mut().unwrap();s.owner=Some(owner);s.first=result;}
     else{slots.pop();unsafe{*out=HolderToken::default()};}
     result
    }
   }
  })
 })
}

// Alternate normal custody-only acquisition; not a qualified role/collector.
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_source_sealed_role_holder_open_v1(role:u32,purpose:u32,credential:*const u8,cn:usize,pq:*const u8,pn:usize,classic:*const u8,kn:usize,out:*mut HolderToken)->i32{
 unsafe{sealed_role_holder_open(role,purpose,credential,cn,pq,pn,classic,kn,out,false)}
}
// Distinct normal production callee; no V1 fallback or caller profile flag.
// This loads ONLY Root-verified V4 sealed custody; it does not authorize sign.
#[cfg(feature="predevice-initial-prekeys-v1")]
#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_source_sealed_role_holder_open_initial_prekeys_v2(role:u32,purpose:u32,credential:*const u8,cn:usize,pq:*const u8,pn:usize,classic:*const u8,kn:usize,out:*mut HolderToken)->i32{
 unsafe{sealed_role_holder_open(role,purpose,credential,cn,pq,pn,classic,kn,out,true)}
}
unsafe fn sealed_role_holder_open(role:u32,purpose:u32,credential:*const u8,cn:usize,pq:*const u8,pn:usize,classic:*const u8,kn:usize,out:*mut HolderToken,initial:bool)->i32{
 boundary(||{
  if out.is_null(){return 1}
  unsafe{*out=HolderToken::default()};
  if purpose!=1&&purpose!=2{return 1}
  let role=match role{1=>SourceRole::Issuer,2=>SourceRole::Anchor,_=>return 1};
  if credential.is_null()||cn==0||cn>65536||pq.is_null()||pn!=std::mem::size_of::<SourcePqRecord>()||classic.is_null()||kn!=std::mem::size_of::<SourceClassicRecord>(){return 1}
  HELD.with(|held|{
   let Ok(mut slots)=held.try_borrow_mut()else{return 16};
   if slots.len()>=2||slots.iter().any(|s|s.role==role){return 16}
   let serial=match NEXT.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|n|if n==u64::MAX{None}else{Some(n+1)}){Ok(n)=>n,Err(_)=>return 16};
   let token=HolderToken{kind:KIND,serial};
   // Reserve identity BEFORE potentially opening any custody. An unwind keeps
   // this same unknown slot and cannot create another same-role owner.
   slots.push(Slot{token,role,owner:None,first:16});unsafe{*out=token};
   let raw=unsafe{std::slice::from_raw_parts(credential,cn)};
   let q=unsafe{std::ptr::read_unaligned(pq.cast::<SourcePqRecord>())};
   let c=unsafe{std::ptr::read_unaligned(classic.cast::<SourceClassicRecord>())};
   let opened=if initial{
    #[cfg(feature="predevice-initial-prekeys-v1")]{FirstPreparedProtectedHolder::open_sealed_initial_prekeys(role,purpose,raw,&q,&c)}
    #[cfg(not(feature="predevice-initial-prekeys-v1"))]{return 1}
   }else{FirstPreparedProtectedHolder::open_sealed(role,purpose,raw,&q,&c)};
   match opened{
    Ok(owner)=>{let s=slots.last_mut().unwrap();s.owner=Some(owner);s.first=0;0},
    Err(failure)=>{
     let result=if matches!(failure.error,FirstPreparedHolderError::Custody(SourceError::Foreign(1))){1}else{code(&failure.error)};
     if let Some(owner)=failure.retained{let s=slots.last_mut().unwrap();s.owner=Some(owner);s.first=result;}
     else{slots.pop();unsafe{*out=HolderToken::default()};}
     result
    }
   }
  })
 })
}

#[unsafe(no_mangle)]
pub(crate)extern "C" fn ynx_source_first_prepared_holder_status_v1(token:HolderToken)->i32{
 boundary(||HELD.with(|held|{
  let Ok(mut slots)=held.try_borrow_mut()else{return 16};
  let Some(s)=slots.iter_mut().find(|s|s.token==token&&token.kind==KIND&&token.serial!=0)else{return 21};
  if s.first!=0{return s.first}
  // A panic/late expiry/revoke cannot be followed by a fresh successful check.
  // Reserve UNKNOWN before entering the foreign physical current call.
  s.first=16;
  let result=match s.owner.as_ref(){Some(owner)=>match owner.checked_current(){Ok(())=>0,Err(e)=>code(&e)},None=>16};
  s.first=result;result
 }))
}

#[unsafe(no_mangle)]
pub(crate)extern "C" fn ynx_source_first_prepared_holder_close_v1(token:HolderToken)->i32{
 boundary(||HELD.with(|held|{
  let Ok(mut slots)=held.try_borrow_mut()else{return 16};
  let Some(index)=slots.iter().position(|s|s.token==token&&token.kind==KIND&&token.serial!=0)else{return 21};
  let s=&mut slots[index];let Some(owner)=s.owner.as_mut()else{return 16};
  if let Err(e)=owner.close(){let result=code(&FirstPreparedHolderError::Custody(e));if s.first==0{s.first=result}return result}
  slots.remove(index);0
 }))
}

#[cfg(test)]mod controls{
 use super::*;
 #[cfg(feature="abi5-final-native-link")]
 #[test]fn supplier_original_rejection_is_not_status_success(){
  use crate::staging::platform::SourceOwnerError as E;
  for error in [E::Required,E::Unknown,E::Capacity,E::AbiInvariant,E::Foreign(0)]{assert_eq!(code(&FirstPreparedHolderError::Original(error)),16);}
  assert_eq!(code(&FirstPreparedHolderError::Original(E::Thread)),22);
  assert_eq!(code(&FirstPreparedHolderError::Original(E::Association)),75);
 }
 #[test]fn ffi_rejection_is_never_a_success_or_collector_token(){
  assert_ne!(code(&FirstPreparedHolderError::Custody(SourceError::Foreign(0))),0);
  assert_eq!(std::mem::size_of::<SourcePqRecord>(),12100);
  assert_eq!(std::mem::size_of::<SourceClassicRecord>(),7464);
  let pq=[0u8;12100];let classic=[0u8;7464];let mut token=HolderToken::default();
  let rc=unsafe{ynx_source_first_prepared_holder_open_v1(-1,1,b"{}".as_ptr(),2,pq.as_ptr(),pq.len(),classic.as_ptr(),classic.len(),&mut token)};
  assert_ne!(rc,0);assert!(token==HolderToken::default());
  assert_eq!(ynx_source_first_prepared_holder_status_v1(token),21);
  assert_eq!(ynx_source_first_prepared_holder_close_v1(token),21);
  assert_ne!(unsafe{ynx_source_first_prepared_holder_open_v1(-1,3,b"{}".as_ptr(),2,pq.as_ptr(),pq.len(),classic.as_ptr(),classic.len(),&mut token)},0);
  assert!(HELD.with(|h|h.borrow().is_empty()));
 }
}

// Private same-process ABI. Locator token does not confer authorization;
// every callable phase consumes actual retained independently verified owner.
#[cfg(feature="abi5-final-native-link")]
pub(super)mod server_participant{
 use super::*;use super::super::first_prepared_holder::ServerFirstDeviceParticipant;
 use std::{sync::Mutex,thread::{self,ThreadId}};
 const SERVER_KIND:u64=0x594e585346443031;
 #[repr(C)]#[derive(Clone,Copy,Default,PartialEq,Eq)]pub(crate)struct ServerToken{kind:u64,serial:u64}
 struct ServerSlot{token:ServerToken,owner:Option<ServerFirstDeviceParticipant>,unknown:bool}
 thread_local!{static SERVERS:RefCell<Vec<ServerSlot>>=const{RefCell::new(Vec::new())};}
 // Exclusion/thread identity only, not approval. No credential/public DTO key.
 static THREADS:Mutex<Vec<(ServerToken,ThreadId)>>=Mutex::new(Vec::new());
 fn error(e:crate::source_infrastructure::platform::Error)->i32{match e{crate::source_infrastructure::platform::Error::Required=>1,crate::source_infrastructure::platform::Error::Thread=>22,_=>16}}
 fn recognized(t:ServerToken)->Result<(),i32>{let m=THREADS.lock().map_err(|_|16)?;let(_,owner)=m.iter().find(|(x,_)|*x==t&&t.kind==SERVER_KIND&&t.serial!=0).ok_or(21)?;if *owner!=thread::current().id(){return Err(22)}Ok(())}
 // Locator plus public facts, not a second participant or grant.
 #[derive(Clone)]pub(crate)struct ServerCoreLink{token:ServerToken,pub(crate)facts:crate::account_instance::ServerCoreFacts}
 impl ServerCoreLink{pub(crate)fn current(&self)->Result<(),i32>{let code=call(self.token,|owner|owner.current());if code==0{Ok(())}else{Err(code)}}}
 pub(crate)fn link_first_device_core(original:&crate::source_infrastructure::platform::ServerCoreOriginals<'_>)->Result<ServerCoreLink,i32>{
  SERVERS.with(|s|{
   let mut slots=s.try_borrow_mut().map_err(|_|16)?;if slots.len()!=1{return Err(1)}
   let slot=&mut slots[0];recognized(slot.token)?;if slot.unknown{return Err(16)}
   let owner=slot.owner.as_mut().ok_or(16)?;let facts=owner.core_facts(original).map_err(error)?;
   Ok(ServerCoreLink{token:slot.token,facts})
  })
 }
 #[cfg(test)]mod server_core_registry_controls{
  use super::*;
  #[test]fn server_core_link_foreign_token_never_creates_an_owner(){
   assert_eq!(recognized(ServerToken{kind:SERVER_KIND,serial:u64::MAX}),Err(21));
   assert!(SERVERS.with(|s|s.borrow().is_empty()));
  }
 }
 fn call(t:ServerToken,f:impl FnOnce(&mut ServerFirstDeviceParticipant)->Result<(),crate::source_infrastructure::platform::Error>)->i32{boundary(||{if let Err(e)=recognized(t){return e}SERVERS.with(|s|{let Ok(mut slots)=s.try_borrow_mut()else{return 16};let Some(slot)=slots.iter_mut().find(|x|x.token==t)else{return 21};if slot.unknown{return 16}let Some(owner)=slot.owner.as_mut()else{return 16};match f(owner){Ok(())=>0,Err(e)=>{slot.unknown=true;error(e)}}})})}
 #[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_first_device_server_acquire_v1(input:*const crate::source_infrastructure::platform::ServerInputRaw,out:*mut ServerToken)->i32{
  boundary(||{if out.is_null()||input.is_null(){return 1}if unsafe{*out}!=ServerToken::default(){return 1}SERVERS.with(|s|{let Ok(mut slots)=s.try_borrow_mut()else{return 16};if !slots.is_empty(){return 16}let serial=match NEXT.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|n|n.checked_add(1)){Ok(n)=>n,Err(_)=>return 16};let token=ServerToken{kind:SERVER_KIND,serial};let Ok(mut threads)=THREADS.lock()else{return 16};threads.push((token,thread::current().id()));drop(threads);slots.push(ServerSlot{token,owner:None,unknown:true});unsafe{*out=token};match unsafe{ServerFirstDeviceParticipant::acquire(&*input)}{Ok(owner)=>{let slot=slots.last_mut().unwrap();slot.owner=Some(owner);slot.unknown=false;0},Err(f)=>{let code=error(f.error);if let Some(owner)=f.retained{slots.last_mut().unwrap().owner=Some(owner);}else{slots.pop();if let Ok(mut m)=THREADS.lock(){m.retain(|(t,_)|*t!=token)}unsafe{*out=ServerToken::default()};}code}}})})
 }
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_current_v1(token:ServerToken)->i32{call(token,|o|o.current())}
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_completed_current_v1(token:ServerToken)->i32{call(token,|o|o.completed_current())}
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_unknown_v1(token:ServerToken)->i32{call(token,|o|o.mark_unknown())}
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_enter_v1(token:ServerToken)->i32{call(token,|o|o.enter())}
 #[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_first_device_server_retire_v1(token:ServerToken,input:*const crate::source_infrastructure::platform::ServerTerminalRaw)->i32{if input.is_null(){return 1}call(token,|o|unsafe{o.retire(&*input)})}
 #[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_first_device_server_copy_device_records_v1(token:ServerToken,out:*mut u8,capacity:usize,required:*mut usize)->i32{
  boundary(||{if required.is_null()||capacity>393216||(capacity>0&&out.is_null()){return 2}unsafe{*required=0};if let Err(e)=recognized(token){return e}SERVERS.with(|s|{let Ok(mut slots)=s.try_borrow_mut()else{return 16};let Some(slot)=slots.iter_mut().find(|x|x.token==token)else{return 21};if slot.unknown{return 16}let Some(owner)=slot.owner.as_mut()else{return 16};let raw=match owner.device_records_transport(){Ok(raw)=>raw,Err(e)=>{let code=error(e);if code!=1{slot.unknown=true;}return code}};unsafe{*required=raw.len()};if capacity<raw.len(){return 2}if !raw.is_empty(){unsafe{std::ptr::copy_nonoverlapping(raw.as_ptr(),out,raw.len())};}0})})
 }
 #[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_first_device_server_close_v1(token:*mut ServerToken)->i32{
  boundary(||{if token.is_null(){return 1}let t=unsafe{*token};if t==ServerToken::default(){return 0}if let Err(e)=recognized(t){return e}SERVERS.with(|s|{let Ok(mut slots)=s.try_borrow_mut()else{return 16};let Some(n)=slots.iter().position(|x|x.token==t)else{return 21};let slot=&mut slots[n];let Some(owner)=slot.owner.as_mut()else{return 16};if let Err(e)=owner.close(){slot.unknown=true;return error(e)}slots.remove(n);if let Ok(mut m)=THREADS.lock(){m.retain(|(x,_)|*x!=t)}else{return 16}unsafe{*token=ServerToken::default()};0})})
 }
}

// Actual holder-to-collector transfer, not a token cast. Raw originals have no
// authority; refused/partial acquisition remains in the original holder slot.
#[cfg(all(feature="abi5-final-native-link",feature="source-server-collector"))]
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_role_ready_collector_v1(token:HolderToken,input:*const platform::RoleInputRaw,out:*mut u64)->i32{
 boundary(||{if input.is_null()||out.is_null(){return 1}unsafe{*out=0};HELD.with(|held|{
  let Ok(mut slots)=held.try_borrow_mut()else{return 16};let Some(index)=slots.iter().position(|s|s.token==token&&token.kind==KIND&&token.serial!=0)else{return 21};
  let s=&mut slots[index];if s.first!=0{return s.first}let Some(owner)=s.owner.as_mut()else{return 16};
  if let Err(e)=unsafe{owner.prepare_ready_role(&*input)}{let rc=code(&e);s.first=rc;return rc}
  let owner=s.owner.take().unwrap();match owner.into_ready_collector(){Ok(id)=>{unsafe{*out=id};slots.remove(index);0},Err(owner)=>{s.owner=Some(owner);s.first=16;16}}
 })})
}

#[unsafe(no_mangle)]
pub(crate)unsafe extern "C" fn ynx_source_directory_holder_open_v1(fd:i32,role:u32,credential:*const u8,cn:usize,pq:*const u8,pn:usize,classic:*const u8,kn:usize,out:*mut HolderToken)->i32{
 boundary(||{
  if out.is_null(){return 1}
  unsafe{*out=HolderToken::default()};
  let role=match role{1=>SourceRole::Issuer,2=>SourceRole::Anchor,_=>return 1};
  if credential.is_null()||cn==0||cn>65536||pq.is_null()||pn!=std::mem::size_of::<SourcePqRecord>()||classic.is_null()||kn!=std::mem::size_of::<SourceClassicRecord>(){return 1}
  HELD.with(|held|{
   let Ok(mut slots)=held.try_borrow_mut()else{return 16};
   if slots.len()>=2||slots.iter().any(|s|s.role==role){return 16}
   let serial=match NEXT.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|n|if n==u64::MAX{None}else{Some(n+1)}){Ok(n)=>n,Err(_)=>return 16};
   let token=HolderToken{kind:KIND,serial};
   // Reserve identity BEFORE potentially opening any custody. An unwind keeps
   // this same unknown slot and cannot create another same-role owner.
   slots.push(Slot{token,role,owner:None,first:16});unsafe{*out=token};
   let raw=unsafe{std::slice::from_raw_parts(credential,cn)};
   let q=unsafe{std::ptr::read_unaligned(pq.cast::<SourcePqRecord>())};
   let c=unsafe{std::ptr::read_unaligned(classic.cast::<SourceClassicRecord>())};
   match FirstPreparedProtectedHolder::open_directory(fd,role,raw,&q,&c){
    Ok(owner)=>{let s=slots.last_mut().unwrap();s.owner=Some(owner);s.first=0;0},
    Err(failure)=>{
     let result=code(&failure.error);
     if let Some(owner)=failure.retained{let s=slots.last_mut().unwrap();s.owner=Some(owner);s.first=result;}
     else{slots.pop();unsafe{*out=HolderToken::default()};}
     result
    }
   }
  })
 })
}


#[cfg(all(test,feature="abi5-final-native-link"))]mod role_abi_delta_controls{
 use super::*;
 #[test]fn unbound_required_is_not_owning_success_or_unknown(){assert_eq!(code(&FirstPreparedHolderError::Platform(platform::Error::Required)),1);assert_eq!(code(&FirstPreparedHolderError::Platform(platform::Error::Thread)),22);assert_eq!(code(&FirstPreparedHolderError::Platform(platform::Error::Unknown)),16);assert_eq!(code(&FirstPreparedHolderError::Platform(platform::Error::Foreign(0))),16);}
}

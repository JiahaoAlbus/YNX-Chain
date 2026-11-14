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
 use std::{cell::Cell,rc::Rc,sync::Mutex,thread::{self,ThreadId}};
 const SERVER_KIND:u64=0x594e585346443031;
 #[repr(C)]#[derive(Clone,Copy,Default,PartialEq,Eq)]pub(crate)struct ServerToken{kind:u64,serial:u64}
 struct ServerSlot{token:ServerToken,owner:Option<Rc<RefCell<ServerFirstDeviceParticipant>>>,
  unknown:Rc<Cell<bool>>,first:Rc<Cell<i32>>,busy:Rc<Cell<bool>>,completed_read:Rc<Cell<bool>>,read_closed:Cell<bool>,
  device_partial:Rc<RefCell<Option<Vec<u8>>>>,
  #[cfg(feature="source-collector-bridge")]
  engine_pin:Rc<RefCell<Option<crate::message_custody_ffi::message3_producer::ServerEngineReadPin>>>}
 thread_local!{static SERVERS:RefCell<Vec<ServerSlot>>=const{RefCell::new(Vec::new())};}
 // Exclusion/thread identity only, not approval. No credential/public DTO key.
 static THREADS:Mutex<Vec<(ServerToken,ThreadId)>>=Mutex::new(Vec::new());
 fn error(e:crate::source_infrastructure::platform::Error)->i32{match e{crate::source_infrastructure::platform::Error::Required=>1,crate::source_infrastructure::platform::Error::Thread=>22,_=>16}}
 fn recognized(t:ServerToken)->Result<(),i32>{let m=THREADS.lock().map_err(|_|16)?;let(_,owner)=m.iter().find(|(x,_)|*x==t&&t.kind==SERVER_KIND&&t.serial!=0).ok_or(21)?;if *owner!=thread::current().id(){return Err(22)}Ok(())}
 // Locator plus public facts, not a second participant or grant.
 #[derive(Clone)]pub(crate)struct ServerCoreLink{token:ServerToken,pub(crate)facts:crate::account_instance::ServerCoreFacts,
  #[cfg(feature="source-server-collector")]first_startup:usize}
 impl ServerCoreLink{
  #[cfg(feature="source-server-collector")]
  pub(crate)fn first_server_startup(&self)->usize{self.first_startup}
  #[cfg(feature="source-server-collector")]
  pub(crate)fn same_participant(&self,other:&Self)->bool{self.token==other.token&&self.first_startup==other.first_startup&&self.facts==other.facts}
  pub(crate)fn current(&self)->Result<(),i32>{let code=call(self.token,|owner|owner.current());if code==0{Ok(())}else{Err(code)}}
  // DATA-only fence for callbacks of this exact in-flight completed read.
  // Never use as current(), key admission or a retained owner. The lease
  // observes the physical completed owner before and after the callback.
  pub(crate)fn completed_read_snapshot(&self)->Result<(),i32>{
   recognized(self.token)?;
   SERVERS.with(|s|{let slots=s.try_borrow().map_err(|_|16)?;
    let slot=slots.iter().find(|x|x.token==self.token).ok_or(21)?;
    if slot.unknown.get(){return Err(16)}
    if !slot.completed_read.get()||!slot.busy.get()||slot.owner.is_none(){return Err(1)}
    Ok(())
   })
  }
 }
 pub(crate)fn link_first_device_core(original:&crate::source_infrastructure::platform::ServerCoreOriginals<'_>)->Result<ServerCoreLink,i32>{
  SERVERS.with(|s|{
   let mut slots=s.try_borrow_mut().map_err(|_|16)?;if slots.len()!=1{return Err(1)}
   let slot=&mut slots[0];recognized(slot.token)?;if slot.unknown.get()||slot.busy.get(){return Err(16)}
   let mut owner=slot.owner.as_ref().ok_or(16)?.try_borrow_mut().map_err(|_|16)?;let facts=owner.core_facts(original).map_err(error)?;
   Ok(ServerCoreLink{token:slot.token,facts,
    #[cfg(feature="source-server-collector")]first_startup:crate::message_custody_ffi::selected_first_server_startup()?})
  })
 }
 #[cfg(test)]mod server_core_registry_controls{
  use super::*;
  #[test]fn server_core_link_foreign_token_never_creates_an_owner(){
   assert_eq!(recognized(ServerToken{kind:SERVER_KIND,serial:u64::MAX}),Err(21));
   assert!(SERVERS.with(|s|s.borrow().is_empty()));
  }
 }
 fn call(t:ServerToken,f:impl FnOnce(&mut ServerFirstDeviceParticipant)->Result<(),crate::source_infrastructure::platform::Error>)->i32{boundary(||{
  if let Err(e)=recognized(t){return e}
  SERVERS.with(|s|{let Ok(mut slots)=s.try_borrow_mut()else{return 16};
   let Some(slot)=slots.iter_mut().find(|x|x.token==t)else{return 21};
   if slot.unknown.get()||slot.busy.get(){return 16}
   let Some(owner)=slot.owner.as_ref()else{return 16};let Ok(mut owner)=owner.try_borrow_mut()else{return 16};
   match f(&mut owner){Ok(())=>0,Err(e)=>{let cause=error(e);if slot.first.get()==0{slot.first.set(cause)}slot.unknown.set(true);cause}}
  })
 })}
 #[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_first_device_server_acquire_v1(input:*const crate::source_infrastructure::platform::ServerInputRaw,out:*mut ServerToken)->i32{
  boundary(||{if out.is_null()||input.is_null(){return 1}if unsafe{*out}!=ServerToken::default(){return 1}SERVERS.with(|s|{let Ok(mut slots)=s.try_borrow_mut()else{return 16};if !slots.is_empty(){return 16}let serial=match NEXT.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|n|n.checked_add(1)){Ok(n)=>n,Err(_)=>return 16};let token=ServerToken{kind:SERVER_KIND,serial};let Ok(mut threads)=THREADS.lock()else{return 16};
  threads.push((token,thread::current().id()));drop(threads);slots.push(ServerSlot{token,owner:None,unknown:Rc::new(Cell::new(true)),first:Rc::new(Cell::new(0)),busy:Rc::new(Cell::new(false)),completed_read:Rc::new(Cell::new(false)),read_closed:Cell::new(false),device_partial:Rc::new(RefCell::new(None)),#[cfg(feature="source-collector-bridge")]engine_pin:Rc::new(RefCell::new(None))});unsafe{*out=token};match unsafe{ServerFirstDeviceParticipant::acquire(&*input)}{Ok(owner)=>{let slot=slots.last_mut().unwrap();slot.owner=Some(Rc::new(RefCell::new(owner)));slot.unknown.set(false);0},Err(f)=>{let code=error(f.error);if let Some(owner)=f.retained{slots.last_mut().unwrap().owner=Some(Rc::new(RefCell::new(owner)));}else{slots.pop();if let Ok(mut m)=THREADS.lock(){m.retain(|(t,_)|*t!=token)}unsafe{*out=ServerToken::default()};}code}}})})
 }
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_current_v1(token:ServerToken)->i32{call(token,|o|o.current())}
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_completed_current_v1(token:ServerToken)->i32{call(token,|o|o.completed_current())}
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_unknown_v1(token:ServerToken)->i32{
  boundary(||{if let Err(e)=recognized(token){return e}
   let busy=SERVERS.with(|s|{let slots=s.try_borrow().map_err(|_|16)?;let slot=slots.iter().find(|x|x.token==token).ok_or(21)?;
    if slot.busy.get(){if slot.first.get()==0{slot.first.set(16)}slot.unknown.set(true);Ok(true)}else{Ok(false)}
   });
   match busy{Ok(true)=>16,Ok(false)=>call(token,|o|o.mark_unknown()),Err(e)=>e}
  })
 }
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_enter_v1(token:ServerToken)->i32{call(token,|o|o.enter())}
 #[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_first_device_server_retire_v1(token:ServerToken,input:*const crate::source_infrastructure::platform::ServerTerminalRaw)->i32{if input.is_null(){return 1}call(token,|o|unsafe{o.retire(&*input)})}
 // Registry and lease share strong ownership of the SAME participant. No
 // registry borrow crosses a callback. Cancellation only latches UNKNOWN in
 // shared cells; it cannot drop the physical object or terminate the process.
 struct CompletedReadLease{
  owner:Rc<RefCell<ServerFirstDeviceParticipant>>,unknown:Rc<Cell<bool>>,first:Rc<Cell<i32>>,
  busy:Rc<Cell<bool>>,completed_read:Rc<Cell<bool>>,
  partial:Rc<RefCell<Option<Vec<u8>>>>,
  #[cfg(feature="source-collector-bridge")]
  engine_pin:Rc<RefCell<Option<crate::message_custody_ffi::message3_producer::ServerEngineReadPin>>>,
  finished:bool,
 }
 impl CompletedReadLease{
  fn acquire(token:ServerToken)->Result<Self,i32>{
   recognized(token)?;
   SERVERS.with(|s|{let slots=s.try_borrow().map_err(|_|16)?;
    let slot=slots.iter().find(|x|x.token==token).ok_or(21)?;
    if slot.unknown.get()||slot.busy.get()||slot.read_closed.get(){return Err(16)}
    let owner=slot.owner.as_ref().ok_or(16)?.clone();
    let lease=Self{owner,unknown:slot.unknown.clone(),first:slot.first.clone(),busy:slot.busy.clone(),
     completed_read:slot.completed_read.clone(),partial:slot.device_partial.clone(),
     #[cfg(feature="source-collector-bridge")]engine_pin:slot.engine_pin.clone(),finished:false};
    lease.busy.set(true);Ok(lease)
   })
  }
  fn with_owner<T>(&self,f:impl FnOnce(&mut ServerFirstDeviceParticipant)->Result<T,crate::source_infrastructure::platform::Error>)->Result<T,i32>{
   let mut owner=self.owner.try_borrow_mut().map_err(|_|16)?;f(&mut owner).map_err(error)
  }
  fn finish(mut self,code:i32)->i32{
   let code=if self.unknown.get()&&(code==0||code==1){16}else{code};
   self.completed_read.set(false);
   if code!=0&&code!=1{
    if self.first.get()==0{self.first.set(code)}self.unknown.set(true);
    if let Ok(mut owner)=self.owner.try_borrow_mut(){let _=owner.mark_unknown();}
   }
   self.busy.set(false);self.finished=true;code
  }
 }
 impl Drop for CompletedReadLease{fn drop(&mut self){
  if self.finished{return}
  // Slot keeps its own Rc even if cancellation or a nested registry borrow
  // prevents a callback here. UNKNOWN is set before attempting propagation;
  // close must still visit the SAME retained physical owner.
  if self.first.get()==0{self.first.set(16)}
  self.unknown.set(true);self.completed_read.set(false);self.busy.set(false);
  // No foreign calls during unwinding: close propagates UNKNOWN once the
  // outstanding borrow has unwound. The slot retains the physical owner.
 }}
 #[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_first_device_server_copy_device_records_v1(token:ServerToken,out:*mut u8,capacity:usize,required:*mut usize)->i32{
  boundary(||{
   if required.is_null()||(required as usize)%std::mem::align_of::<usize>()!=0||capacity>393216||(capacity>0&&out.is_null()){return 2}
   let r=required as usize;let Some(r_end)=r.checked_add(std::mem::size_of::<usize>())else{return 2};
   if capacity>0{let a=out as usize;let Some(end)=a.checked_add(capacity)else{return 2};if !(end<=r||r_end<=a){return 2}}
   unsafe{*required=0};
   let lease=match CompletedReadLease::acquire(token){Ok(v)=>v,Err(e)=>return e};
   if let Err(e)=lease.with_owner(|owner|owner.completed_current()){return lease.finish(e)}
   let partial_owner=lease.partial.clone();
   let cached=match partial_owner.try_borrow(){Ok(p)=>p.is_some(),Err(_)=>return lease.finish(16)};
   lease.completed_read.set(true);
   // Each size/copy call checks the same retained actual EngineAttempt; the
   // read pin persists in the participant until its explicit physical close.
   #[cfg(feature="source-collector-bridge")]
   {
    let selected=match crate::message_custody_ffi::message3_producer::same_participant_completed_read_ready(){
     Ok(v)=>v,Err(cause)=>{
      if cause!=1&&lease.first.get()==0{lease.first.set(cause)}
      return lease.finish(if cause==1{1}else if cause==22{22}else{16})
     }
    };
    let pin_owner=lease.engine_pin.clone();
    let mut pin=match pin_owner.try_borrow_mut(){Ok(v)=>v,Err(_)=>return lease.finish(16)};
    if let Some(held)=pin.as_ref(){if !held.matches(selected){drop(pin);return lease.finish(16)}}
    else{match crate::message_custody_ffi::message3_producer::ServerEngineReadPin::acquire(selected){
     Ok(held)=>*pin=Some(held),Err(cause)=>{drop(pin);if cause!=1&&lease.first.get()==0{lease.first.set(cause)}return lease.finish(if cause==1{1}else{16})}
    }}
   }
   // Recheck the actual R5 guards and signed-current window on a size->copy
   // reuse, while retaining the originally selected file bytes.
   #[cfg(all(feature="source-server-collector",feature="abi5-final-native-link",unix,not(target_os="android")))]
   if cached{if let Err(cause)=crate::message_custody_ffi::r5_source_policy::operations::recheck_server_device(){
    if lease.first.get()==0{lease.first.set(cause)}return lease.finish(16)
   }}
   if !cached{
    let result=lease.with_owner(|owner|owner.device_records_transport());
    // Adopt real output even before clearing the snapshot and late fencing.
    match result{
     Ok(raw)=>{let mut held=match partial_owner.try_borrow_mut(){Ok(v)=>v,Err(_)=>return lease.finish(16)};*held=Some(raw);},
     Err(e)=>return lease.finish(e),
    }
   }
   lease.completed_read.set(false);
   if lease.unknown.get(){return lease.finish(16)}
   if let Err(e)=lease.with_owner(|owner|owner.completed_current()){return lease.finish(e)}
   if lease.unknown.get(){return lease.finish(16)}
   let partial=match partial_owner.try_borrow(){Ok(v)=>v,Err(_)=>return lease.finish(16)};
   let raw=match partial.as_ref(){Some(v)=>v,None=>{drop(partial);return lease.finish(16)}};
   let size=raw.len();unsafe{*required=size};
   if capacity<size{drop(partial);let done=lease.finish(0);return if done==0{2}else{done}}
   if !raw.is_empty(){unsafe{std::ptr::copy_nonoverlapping(raw.as_ptr(),out,raw.len())}}
   drop(partial);lease.finish(0)
  })
 }
 /* Cleanup only: release the participant's added Engine read reference before
  * closing the SDK it pins. Selection permanently closes this read path, even
  * when release fails. Zero means only that this pin is physically absent; it
  * does not clear a prior UNKNOWN or certify participant/SDK completion. */
 #[cfg(feature="source-collector-bridge")]
 struct PinReleaseAttempt{unknown:Rc<Cell<bool>>,first:Rc<Cell<i32>>,finished:bool}
 #[cfg(feature="source-collector-bridge")]
 impl Drop for PinReleaseAttempt{fn drop(&mut self){if !self.finished{if self.first.get()==0{self.first.set(16)}self.unknown.set(true);}}}
 #[cfg(feature="source-collector-bridge")]
 #[unsafe(no_mangle)]pub(crate)extern "C" fn ynx_source_first_device_server_release_read_pin_v1(token:ServerToken)->i32{
  boundary(||{if let Err(e)=recognized(token){return e}
   SERVERS.with(|s|{let Ok(slots)=s.try_borrow()else{return 16};
    let Some(slot)=slots.iter().find(|x|x.token==token)else{return 21};
    if slot.busy.get(){return 16}slot.read_closed.set(true);
    let Ok(mut pins)=slot.engine_pin.try_borrow_mut()else{return 16};
    if let Some(pin)=pins.as_mut(){let mut attempt=PinReleaseAttempt{unknown:slot.unknown.clone(),first:slot.first.clone(),finished:false};
     let code=pin.close();if code!=0{if slot.first.get()==0{slot.first.set(code)}slot.unknown.set(true);attempt.finished=true;return 16}
     attempt.finished=true;}
    *pins=None;0
   })
  })
 }
 #[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_source_first_device_server_close_v1(token:*mut ServerToken)->i32{
  boundary(||{if token.is_null(){return 1}let t=unsafe{*token};if t==ServerToken::default(){return 0}if let Err(e)=recognized(t){return e}
   SERVERS.with(|s|{let Ok(mut slots)=s.try_borrow_mut()else{return 16};let Some(n)=slots.iter().position(|x|x.token==t)else{return 21};
    let slot=&mut slots[n];if slot.busy.get(){return 16}
    let prior_first=slot.first.get();let prior_unknown=slot.unknown.get();
    #[cfg(feature="source-collector-bridge")]
    {let Ok(mut pins)=slot.engine_pin.try_borrow_mut()else{return 16};
     if let Some(pin)=pins.as_mut(){let code=pin.close();if code!=0{if slot.first.get()==0{slot.first.set(code)}slot.unknown.set(true);return 16}}
     *pins=None;
    }
    let Some(owner)=slot.owner.as_ref()else{return 16};
    let mut close_failed=false;
    {let Ok(mut owner)=owner.try_borrow_mut()else{return 16};
     if slot.unknown.get(){let _=owner.mark_unknown();}
     if let Err(e)=owner.close(){let cause=error(e);if slot.first.get()==0{slot.first.set(cause)}slot.unknown.set(true);close_failed=true;
      // error+cleared pointer is a confirmed disposal, never a live owner.
      if !owner.physical_closed(){return cause}
     }
    }
    // Acquire the token registry before removing the slot. No fallible step
    // after removal may leave an externally live alias to disposed custody.
    let Ok(mut threads)=THREADS.lock()else{return 16};
    slots.remove(n);threads.retain(|(x,_)|*x!=t);
    unsafe{*token=ServerToken::default()};
    if close_failed||prior_first!=0||prior_unknown{16}else{0}
   })
  })
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

#[path="source_first_prepared_holder_ordinary_ffi.rs"]
mod ordinary_successor;

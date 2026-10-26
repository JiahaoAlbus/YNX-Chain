//! Private statically linked platform owning bridge, NOT a grant factory.
//! The normal physical provider is unbound; no fake accepted inputs are made.
#![allow(unsafe_code)]
use crate::staging::platform::{SourcePreparedOwner,SourceOwnerError};
use std::{ffi::c_void,marker::PhantomData,ptr::{self,NonNull},rc::Rc,thread::{self,ThreadId}};
unsafe extern "C"{
 fn ynx_source_client_current(p:*mut c_void,cleanup:i32)->i32;
 fn ynx_source_client_enter(p:*mut c_void)->i32;
 fn ynx_source_client_type4(p:*mut c_void,b:*const u8,n:usize)->i32;
 fn ynx_source_client_close(p:*mut *mut c_void)->i32;
}
#[derive(Debug)]pub(crate)enum Error{Original(SourceOwnerError),Thread,Required,Unknown,Abi,Foreign(i32)}
#[derive(Clone,Copy,PartialEq,Eq)]enum Phase{Acquired,Entered,Unknown,Closed}
pub(crate)struct Borrow<'prepared,'op>{
 handle:Option<NonNull<c_void>>,thread:ThreadId,phase:Phase,
 prepared:PhantomData<&'prepared mut SourcePreparedOwner<'op>>,local:PhantomData<Rc<()>>,
}
pub(crate)struct AcquireFailure<'prepared,'op>{pub(crate)error:Error,pub(crate)retained:Option<Borrow<'prepared,'op>>}
fn status(s:i32)->Result<(),Error>{match s{0=>Ok(()),1=>Err(Error::Required),8=>Err(Error::Unknown),s=>Err(Error::Foreign(s))}}
impl<'prepared,'op>Borrow<'prepared,'op>{
 // The sole constructor takes a genuine retained PreparedOwner. No raw pointer,
 // profile, public DTO or boolean can construct the Rust owner. C statically
 // verifies the actual private Prepared and independent platform enrollment.
 pub(crate)fn acquire(prepared:&'prepared mut SourcePreparedOwner<'op>)->Result<Self,AcquireFailure<'prepared,'op>>{
  let mut out=ptr::null_mut();
  let s=prepared.platform_acquire_private(&mut out).map_err(|e|AcquireFailure{error:Error::Original(e),retained:None})?;
  let handle=NonNull::new(out);
  let phase=if s==0{Phase::Acquired}else{Phase::Unknown};
  let retained=handle.map(|h|Self{handle:Some(h),thread:thread::current().id(),phase,prepared:PhantomData,local:PhantomData});
  match(status(s),retained){
   (Ok(()),Some(owner))=>Ok(owner),
   (Ok(()),None)=>Err(AcquireFailure{error:Error::Abi,retained:None}),
   (Err(error),retained)=>Err(AcquireFailure{error,retained}),
  }
 }
 fn raw(&self)->Result<*mut c_void,Error>{if self.thread!=thread::current().id(){return Err(Error::Thread)}self.handle.map(|p|p.as_ptr()).ok_or(Error::Required)}
 pub(crate)fn current(&mut self)->Result<(),Error>{
  let p=self.raw()?;if self.phase==Phase::Unknown{return Err(Error::Unknown)}
  let result=status(unsafe{ynx_source_client_current(p,0)});
  if result.is_err()&&self.phase==Phase::Entered{self.phase=Phase::Unknown;return Err(Error::Unknown)}result
 }
 pub(crate)fn enter(&mut self)->Result<(),Error>{
  self.current()?;if self.phase!=Phase::Acquired{return Err(Error::Unknown)}
  let p=self.raw()?;self.phase=Phase::Unknown;
  status(unsafe{ynx_source_client_enter(p)})?;self.phase=Phase::Entered;Ok(())
 }
 pub(crate)fn check_type4(&mut self,wire:&[u8])->Result<(),Error>{
  self.current()?;if self.phase!=Phase::Entered||wire.is_empty()||wire.len()>65536{return Err(Error::Required)}
  let p=self.raw()?;let result=status(unsafe{ynx_source_client_type4(p,wire.as_ptr(),wire.len())});
  if result.is_err(){self.phase=Phase::Unknown;return Err(Error::Unknown)}Ok(())
 }
 // Explicit cleanup remains possible after failure/expiry. Closing RAM custody
 // never settles UNKNOWN, deletes original history or permits a second effect.
 pub(crate)fn close(&mut self)->Result<(),Error>{
  if self.handle.is_none(){return Ok(())}let original=self.raw()?;let mut p=original;
  let s=unsafe{ynx_source_client_close(&mut p)};
  if s==0&&p.is_null(){self.handle=None;self.phase=Phase::Closed;return Ok(())}
  self.phase=Phase::Unknown;if p!=original{return Err(Error::Abi)}status(s)?;Err(Error::Abi)
 }
}
impl Drop for Borrow<'_,'_>{fn drop(&mut self){if self.handle.is_some(){std::process::abort();}}}

#[repr(C)]#[derive(Clone,Copy)]struct OriginalBytes{data:*const u8,size:usize}
impl OriginalBytes{fn of(b:&[u8])->Self{Self{data:b.as_ptr(),size:b.len()}}}
#[repr(C)]struct OriginalInput{root:OriginalBytes,registration:OriginalBytes,status:OriginalBytes,source:OriginalBytes,namespace_prefix:OriginalBytes,request:OriginalBytes,nonce:*const u8,nonce_size:usize,status_history:*const OriginalBytes,status_history_count:usize,native_classic:[u8;33],native_pq:[u8;2592],source_nonce:[u8;32],monotonic_deadline_ns:u64}
unsafe extern "C"{fn ynx_source_monotonic_now_v1(out:*mut u64)->i32;fn ynx_source_client_original_acquire(input:*const OriginalInput,out:*mut *mut c_void)->i32;}
#[repr(C)]struct CoreBorrowRequestV2{version:u32,size:u32,purpose:u32,operation:u32,key_uses:u32,required_operations:u32,context_id:u64,context_generation:u64,deadline:u64,intent_digest:[u8;32]}
#[repr(C)]struct OriginalInputV2{rights:CoreBorrowRequestV2,original:OriginalInput,android_own_key_platform:*mut c_void}
#[derive(Clone,Copy,PartialEq,Eq)]enum OriginalCoreIntent{ReadExisting,InitializeFirstDevice}
impl OriginalInputV2{
 fn original_read(original:OriginalInput)->Self{Self::for_intent(original,OriginalCoreIntent::ReadExisting)}
 fn for_intent(original:OriginalInput,selected:OriginalCoreIntent)->Self{
  use sha2::{Digest,Sha256};
  // These are requested operations, never grants. The SDK authenticates the
  // original NativeCore policy and rejects any bit outside its signed scope.
  // Existing-device reads must not inherit first-device initialization rights.
  let (operation,key_uses,required_operations)=match selected{
   OriginalCoreIntent::ReadExisting=>(3,1,4),
   // One first-device storage intent: initialize, seal, read, write,
   // durable nonce reservation and compare-and-swap. No later scope expansion.
   OriginalCoreIntent::InitializeFirstDevice=>(1,15,63),
  };
  let intent=unsafe{std::slice::from_raw_parts(original.request.data,original.request.size)};
  Self{rights:CoreBorrowRequestV2{version:2,size:80,purpose:1,operation,key_uses,required_operations,context_id:0,context_generation:0,deadline:original.monotonic_deadline_ns,intent_digest:Sha256::digest(intent).into()},original,android_own_key_platform:ptr::null_mut()}
 }
}
unsafe extern "C"{fn ynx_source_client_original_acquire_v2(input:*const OriginalInputV2,out:*mut *mut c_void)->i32;}
fn original_deadline(input:&crate::private_custodian_ffi::OriginalProviderInput<'_>)->Result<u64,Error>{
 // Sample C's monotonic clock BEFORE checking the original remaining window;
 // any intervening delay shortens, rather than renews, the effective budget.
 let mut sampled=0u64;status(unsafe{ynx_source_monotonic_now_v1(&mut sampled)})?;
 let window=input.operation_window().map_err(|_|Error::Required)?;
 let remaining=u64::try_from(window.remaining().map_err(|_|Error::Required)?.as_nanos()).map_err(|_|Error::Abi)?;
 let deadline=sampled.checked_add(remaining).ok_or(Error::Abi)?;input.recheck().map_err(|_|Error::Required)?;Ok(deadline)
}
// This owns only the qualified STATIC provider's returned root. The borrowed
// loan is the original immutable operation, not a reconstructed lifetime.
pub(crate)struct OriginalAdmission<'loan,'op>{handle:Option<NonNull<c_void>>,loan:&'loan crate::private_custodian_ffi::RecoveryLoan<'op>,native_classic:[u8;33],native_pq:[u8;2592],source_nonce:[u8;32],thread:ThreadId,unknown:bool,local:PhantomData<Rc<()>>}
pub(crate)struct OriginalAcquireFailure<'loan,'op>{pub(crate)error:Error,pub(crate)retained:Option<OriginalAdmission<'loan,'op>>}
impl<'loan,'op>OriginalAdmission<'loan,'op>{
 pub(crate)fn acquire(loan:&'loan crate::private_custodian_ffi::RecoveryLoan<'op>)->Result<Self,OriginalAcquireFailure<'loan,'op>>{
  let refused=||OriginalAcquireFailure{error:Error::Required,retained:None};
  let original=loan.original_provider_input().map_err(|_|refused())?;
  // DEVICE keys are read from the live authenticated local custody, never the
  // Source credential or caller frame. This immutable borrow does not grant.
  let pair=loan.public_pair().map_err(|_|refused())?;
  let native_classic=pair.classic;let native_pq=pair.pq;
  let source_nonce=loan.original_source_nonce().map_err(|_|refused())?;
  let bootstrap=original.bootstrap_raw().map_err(|_|refused())?;
  let source=original.source_raw().map_err(|_|refused())?;
  let prefix=original.namespace_prefix().map_err(|_|refused())?;
  let history:Vec<_>=bootstrap.status_history.iter().map(|raw|OriginalBytes::of(raw)).collect();
  let input=OriginalInput{root:OriginalBytes::of(bootstrap.root),registration:OriginalBytes::of(bootstrap.registration),status:OriginalBytes::of(bootstrap.status),source:OriginalBytes::of(source),namespace_prefix:OriginalBytes::of(prefix),request:OriginalBytes::of(bootstrap.request),nonce:bootstrap.nonce.as_ptr(),nonce_size:32,status_history:history.as_ptr(),status_history_count:history.len(),native_classic,native_pq,source_nonce,monotonic_deadline_ns:original_deadline(&original).map_err(|_|refused())?};
  original.recheck().map_err(|_|refused())?;let mut out=ptr::null_mut();
  let s=unsafe{ynx_source_client_original_acquire_v2(&OriginalInputV2::original_read(input),&mut out)};
  let retained=NonNull::new(out).map(|handle|Self{handle:Some(handle),loan,native_classic,native_pq,source_nonce,thread:thread::current().id(),unknown:s!=0,local:PhantomData});
  match(status(s),retained){
   (Ok(()),Some(mut owner))=>match owner.current(){Ok(())=>Ok(owner),Err(error)=>Err(OriginalAcquireFailure{error,retained:Some(owner)})},
   (Ok(()),None)=>Err(OriginalAcquireFailure{error:Error::Unknown,retained:None}),
   (Err(error),retained)=>Err(OriginalAcquireFailure{error,retained}),
  }
 }
 fn native_origin_current(&self)->Result<(),Error>{
  let pair=self.loan.public_pair().map_err(|_|Error::Unknown)?;
  let nonce=self.loan.original_source_nonce().map_err(|_|Error::Unknown)?;
  if pair.classic!=self.native_classic||pair.pq!=self.native_pq||nonce!=self.source_nonce{return Err(Error::Unknown)}
  Ok(())
 }
 pub(crate)fn current(&mut self)->Result<(),Error>{
  if self.thread!=thread::current().id(){return Err(Error::Thread)}if self.unknown{return Err(Error::Unknown)}
  let result=(||{
   self.native_origin_current()?;
   let original=self.loan.original_provider_input().map_err(|_|Error::Unknown)?;
   original.recheck().map_err(|_|Error::Unknown)?;let p=self.handle.ok_or(Error::Required)?;
   status(unsafe{ynx_source_client_current(p.as_ptr(),0)})?;
   original.recheck().map_err(|_|Error::Unknown)?;self.native_origin_current()
  })();
  if result.is_err(){self.unknown=true;}result
 }
 pub(crate)fn close(&mut self)->Result<(),Error>{
  if self.thread!=thread::current().id(){return Err(Error::Thread)}let Some(original)=self.handle else{return Ok(())};let mut p=original.as_ptr();
  let s=unsafe{ynx_source_client_close(&mut p)};if s==0&&p.is_null(){self.handle=None;return Ok(())}self.unknown=true;if p!=original.as_ptr(){return Err(Error::Abi)}status(s)?;Err(Error::Abi)
 }
}
impl Drop for OriginalAdmission<'_,'_>{fn drop(&mut self){if self.handle.is_some(){std::process::abort();}}}

unsafe extern "C"{fn ynx_source_client_original_projection(h:*mut c_void,a:*mut *const c_void,d:*mut *const c_void,history:*mut *const c_void,r:*mut *const c_void)->i32;}
// Sole constructor is a restricted borrow of a genuinely acquired root. Field
// privacy prevents any pointer/profile/status projection from constructing it.
pub(crate)struct AcceptedOriginalBorrow<'owner>{original:crate::private_custodian_ffi::OriginalProviderInput<'owner>,handle:NonNull<c_void>,intent:OriginalCoreIntent,thread:ThreadId,unknown:std::cell::Cell<bool>,exclusive:PhantomData<&'owner mut c_void>}
impl OriginalAdmission<'_,'_>{
 pub(crate)fn accepted_borrow(&mut self)->Result<AcceptedOriginalBorrow<'_>,Error>{self.current()?;let original=self.loan.original_provider_input().map_err(|_|Error::Unknown)?;Ok(AcceptedOriginalBorrow{original,handle:self.handle.ok_or(Error::Required)?,intent:OriginalCoreIntent::ReadExisting,thread:self.thread,unknown:std::cell::Cell::new(false),exclusive:PhantomData})}
}
impl AcceptedOriginalBorrow<'_>{
 pub(crate)fn current(&self)->Result<(),Error>{if self.thread!=thread::current().id(){return Err(Error::Thread)}if self.unknown.get(){return Err(Error::Unknown)}let result=self.original.recheck().map_err(|_|Error::Unknown).and_then(|_|status(unsafe{ynx_source_client_current(self.handle.as_ptr(),0)})).and_then(|_|self.original.recheck().map_err(|_|Error::Unknown));if result.is_err(){self.unknown.set(true);}result}
 pub(crate)fn projection(&self)->Result<[*const c_void;4],Error>{
  self.current()?;let(mut a,mut d,mut h,mut r)=(ptr::null(),ptr::null(),ptr::null(),ptr::null());
  let result=status(unsafe{ynx_source_client_original_projection(self.handle.as_ptr(),&mut a,&mut d,&mut h,&mut r)}).and_then(|_|self.current());
  if result.is_err(){self.unknown.set(true);}result?;if [a,d,h,r].iter().any(|p|p.is_null()){self.unknown.set(true);return Err(Error::Unknown)}Ok([a,d,h,r])
 }
}

#[repr(C)]struct NativePlanRaw{intent:*const c_void,journal:[*const c_void;32],journal_count:usize,inbox:*const c_void,outbox:*const c_void}
unsafe extern "C"{fn ynx_source_client_original_native_plan(h:*mut c_void,p:*mut NativePlanRaw)->i32;}
// A read-only private projection. It is meaningful ONLY with the retained
// qualified owning root and prepared proof; this value cannot issue a proof.
#[derive(Clone,Copy,PartialEq,Eq)]pub(crate)enum NativePlanKind{FirstDeviceInitialization,Message}
pub(crate)struct NativePlan{pub(crate)kind:NativePlanKind,pub(crate)intent:*const c_void,pub(crate)journal:Vec<*const c_void>,pub(crate)inbox:*const c_void,pub(crate)outbox:*const c_void}
fn checked_plan(raw:NativePlanRaw,kind:NativePlanKind)->Result<NativePlan,Error>{
 // Kind comes from the same acquired owning request, never from empty queue
 // pointers. The actual C owner independently checks its immutable operation.
 let queue_ok=match kind{
  NativePlanKind::FirstDeviceInitialization=>raw.journal_count==1&&raw.inbox.is_null()&&raw.outbox.is_null(),
  NativePlanKind::Message=>raw.inbox.is_null()!=raw.outbox.is_null(),
 };
 if raw.intent.is_null()||raw.journal_count>32||!queue_ok||raw.journal[..raw.journal_count].iter().any(|s|s.is_null()){return Err(Error::Abi)}
 Ok(NativePlan{kind,intent:raw.intent,journal:raw.journal[..raw.journal_count].to_vec(),inbox:raw.inbox,outbox:raw.outbox})
}
impl AcceptedOriginalBorrow<'_>{
 pub(crate)fn native_plan(&self)->Result<NativePlan,Error>{
  self.current()?;let mut raw=NativePlanRaw{intent:ptr::null(),journal:[ptr::null();32],journal_count:0,inbox:ptr::null(),outbox:ptr::null()};
  let result=status(unsafe{ynx_source_client_original_native_plan(self.handle.as_ptr(),&mut raw)}).and_then(|_|self.current());
  if result.is_err(){self.unknown.set(true);}result?;
  let kind=match self.intent{OriginalCoreIntent::InitializeFirstDevice=>NativePlanKind::FirstDeviceInitialization,OriginalCoreIntent::ReadExisting=>NativePlanKind::Message};
  checked_plan(raw,kind).map_err(|error|{self.unknown.set(true);error})
 }
}

impl AcceptedOriginalBorrow<'_>{pub(crate)fn enter(&self)->Result<(),Error>{self.current()?;let result=status(unsafe{ynx_source_client_enter(self.handle.as_ptr())}).and_then(|_|self.current());if result.is_err(){self.unknown.set(true);}result}}

unsafe extern "C"{fn ynx_source_client_snapshot_acquire(root:*mut c_void,prepared:*const c_void,out:*mut *mut c_void)->i32;}
impl AcceptedOriginalBorrow<'_>{
 // Controlled acquiring operation, not a handle getter. Original Request,
 // Account and Source are rechecked before and after the same-root C call.
 pub(crate)fn acquire_snapshot_for_prepared(&self,prepared:*const c_void,out:&mut *mut c_void)->Result<i32,Error>{
  if !out.is_null(){return Err(Error::Abi)}self.current()?;
  let s=unsafe{ynx_source_client_snapshot_acquire(self.handle.as_ptr(),prepared,out)};
  if self.current().is_err(){self.unknown.set(true);return Ok(8)}Ok(s)
 }
}

// Qualified foreign root is an OWNING object retained inside the same immutable
// PendingSourceRequest. It is not a borrowed pointer, flag or proof projection.
// The static provider must retain its actual independent owners at acquisition;
// input byte slices are used only for that synchronous borrowing call.
pub(crate)struct OriginalSigningGuard{handle:Option<NonNull<c_void>>,thread:ThreadId,phase:std::cell::Cell<Phase>,intent:OriginalCoreIntent,nonce:[u8;32],source_digest:[u8;32],local:PhantomData<Rc<()>>,
 #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
 business_seed:Option<crate::private_custodian_ffi::NativeFirstDeviceBusinessSeed>,
 #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="predevice-initial-prekeys-v1"))]
 registered_initial_seed:Option<crate::private_custodian_ffi::RegisteredInitializationSeed>,
}
pub(crate)struct OriginalSigningAcquireFailure{pub(crate)error:Error,pub(crate)retained:Option<OriginalSigningGuard>}
#[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
fn business_seed_error(error:crate::private_custodian_ffi::CustodyError)->Error{
 use crate::private_custodian_ffi::CustodyError;
 match error{CustodyError::Thread=>Error::Thread,CustodyError::Unknown=>Error::Unknown,
  CustodyError::Abi=>Error::Abi,CustodyError::Phase|CustodyError::RequiredAtomicPairJournal=>Error::Required,
  CustodyError::Pair=>Error::Foreign(7),CustodyError::Bounds|CustodyError::Memory=>Error::Foreign(2),
  CustodyError::Foreign(0)=>Error::Unknown,CustodyError::Foreign(code)=>Error::Foreign(code)}
}
impl OriginalSigningGuard{
 #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="predevice-initial-prekeys-v1"))]
 pub(crate)fn acquire_registered_first_device(input:&crate::private_custodian_ffi::OriginalProviderInput<'_>,native_classic:&[u8;33],native_pq:&[u8;2592],source_nonce:&[u8;32],custody:&crate::private_custodian_ffi::NativeOwnKeyCustody,seed:crate::private_custodian_ffi::RegisteredInitializationSeed)->Result<Self,OriginalSigningAcquireFailure>{
  // Exact retained C5+FD2 input, not the V1 length check and never a scalar
  // profile cast. Qualified STATIC C provider still decides real admission.
  let generation=custody.core_storage_generation().map_err(|error|OriginalSigningAcquireFailure{error:business_seed_error(error),retained:None})?;
  seed.matches_original_input(input,native_classic,native_pq,source_nonce,generation).map_err(|error|OriginalSigningAcquireFailure{error:business_seed_error(error),retained:None})?;
  let platform=custody.core_storage_platform().map_err(|error|OriginalSigningAcquireFailure{error:business_seed_error(error),retained:None})?;
  match Self::acquire_for_intent(input,native_classic,native_pq,source_nonce,OriginalCoreIntent::InitializeFirstDevice,platform){
   Ok(mut owner)=>{
    owner.registered_initial_seed=Some(seed);
    if let Err(code)=crate::message_custody_ffi::core_business_seed_owner::retain_registered_initial(&mut owner.registered_initial_seed){owner.invalidate();return Err(OriginalSigningAcquireFailure{error:status(code).err().unwrap_or(Error::Abi),retained:Some(owner)})}
    if let Err(error)=owner.current(input){owner.invalidate();return Err(OriginalSigningAcquireFailure{error,retained:Some(owner)})}Ok(owner)
   },
   Err(mut failure)=>{if let Some(owner)=failure.retained.as_mut(){owner.registered_initial_seed=Some(seed)}Err(failure)},
  }
 }
 pub(crate)fn acquire(input:&crate::private_custodian_ffi::OriginalProviderInput<'_>,native_classic:&[u8;33],native_pq:&[u8;2592],source_nonce:&[u8;32])->Result<Self,OriginalSigningAcquireFailure>{
  Self::acquire_for_intent(input,native_classic,native_pq,source_nonce,OriginalCoreIntent::ReadExisting,ptr::null_mut())
 }
 pub(crate)fn acquire_first_device(input:&crate::private_custodian_ffi::OriginalProviderInput<'_>,native_classic:&[u8;33],native_pq:&[u8;2592],source_nonce:&[u8;32],custody:&crate::private_custodian_ffi::NativeOwnKeyCustody)->Result<Self,OriginalSigningAcquireFailure>{
  input.check_first_device_initialization(native_classic,native_pq,source_nonce)
   .map_err(|_|OriginalSigningAcquireFailure{error:Error::Required,retained:None})?;
  let platform=custody.core_storage_platform()
   .map_err(|_|OriginalSigningAcquireFailure{error:Error::Required,retained:None})?;
  #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]
  {
   let seed=custody.first_device_business_seed(input)
    .map_err(|error|OriginalSigningAcquireFailure{error:business_seed_error(error),retained:None})?;
   let acquired=Self::acquire_for_intent(input,native_classic,native_pq,source_nonce,OriginalCoreIntent::InitializeFirstDevice,platform);
   return match acquired{
    Ok(mut owner)=>{
     owner.business_seed=Some(seed);
     if let Err(code)=crate::message_custody_ffi::core_business_seed_owner::retain_original(&mut owner.business_seed){
      owner.invalidate();return Err(OriginalSigningAcquireFailure{error:status(code).err().unwrap_or(Error::Abi),retained:Some(owner)})
     }
     if let Err(error)=owner.current(input){return Err(OriginalSigningAcquireFailure{error,retained:Some(owner)})}Ok(owner)
    },
    Err(mut failure)=>{if let Some(owner)=failure.retained.as_mut(){owner.business_seed=Some(seed);}Err(failure)},
   }
  }
  #[cfg(not(all(feature="abi5-final-native-link",feature="source-collector-bridge")))]
  Self::acquire_for_intent(input,native_classic,native_pq,source_nonce,OriginalCoreIntent::InitializeFirstDevice,platform)
 }
 fn acquire_for_intent(input:&crate::private_custodian_ffi::OriginalProviderInput<'_>,native_classic:&[u8;33],native_pq:&[u8;2592],source_nonce:&[u8;32],intent:OriginalCoreIntent,platform:*mut c_void)->Result<Self,OriginalSigningAcquireFailure>{
  use sha2::Digest;
  let refused=||OriginalSigningAcquireFailure{error:Error::Required,retained:None};input.recheck().map_err(|_|refused())?;
  let b=input.bootstrap_raw().map_err(|_|refused())?;let source=input.source_raw().map_err(|_|refused())?;let prefix=input.namespace_prefix().map_err(|_|refused())?;
  let history:Vec<_>=b.status_history.iter().map(|r|OriginalBytes::of(r)).collect();
  let raw=OriginalInput{root:OriginalBytes::of(b.root),registration:OriginalBytes::of(b.registration),status:OriginalBytes::of(b.status),source:OriginalBytes::of(source),namespace_prefix:OriginalBytes::of(prefix),request:OriginalBytes::of(b.request),nonce:b.nonce.as_ptr(),nonce_size:32,status_history:history.as_ptr(),status_history_count:history.len(),native_classic:*native_classic,native_pq:*native_pq,source_nonce:*source_nonce,monotonic_deadline_ns:original_deadline(input).map_err(|_|refused())?};
  let nonce=*b.nonce;let source_digest=sha2::Sha256::digest(source).into();input.recheck().map_err(|_|refused())?;let mut out=ptr::null_mut();
  let mut carrier=OriginalInputV2::for_intent(raw,intent);
  carrier.android_own_key_platform=platform;
  let code=unsafe{ynx_source_client_original_acquire_v2(&carrier,&mut out)};
  let retained=NonNull::new(out).map(|h|Self{handle:Some(h),thread:thread::current().id(),phase:std::cell::Cell::new(if code==0{Phase::Acquired}else{Phase::Unknown}),intent,nonce,source_digest,local:PhantomData,
   #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge"))]business_seed:None,
   #[cfg(all(feature="abi5-final-native-link",feature="source-collector-bridge",feature="predevice-initial-prekeys-v1"))]registered_initial_seed:None,
  });
  match(status(code),retained){(Ok(()),Some(owner))=>match owner.current(input){Ok(())=>Ok(owner),Err(error)=>Err(OriginalSigningAcquireFailure{error,retained:Some(owner)})},(Ok(()),None)=>Err(OriginalSigningAcquireFailure{error:Error::Abi,retained:None}),(Err(error),retained)=>Err(OriginalSigningAcquireFailure{error,retained})}
 }
 fn raw(&self)->Result<*mut c_void,Error>{if self.thread!=thread::current().id(){return Err(Error::Thread)}self.handle.map(|p|p.as_ptr()).ok_or(Error::Required)}
 // Retain this actual initialization root for the normal Prepared consumer.
 // ReadExisting, login status and public projections cannot select this path.
 pub(crate)fn prepare_first_device<'owner>(&'owner mut self,original:crate::private_custodian_ffi::OriginalProviderInput<'owner>)->Result<SourcePreparedOwner<'owner>,Error>{
  if self.intent!=OriginalCoreIntent::InitializeFirstDevice{return Err(Error::Required)}
  self.current(&original)?;
  let root=AcceptedOriginalBorrow{original,handle:self.handle.ok_or(Error::Required)?,intent:self.intent,thread:self.thread,unknown:std::cell::Cell::new(false),exclusive:PhantomData};
  SourcePreparedOwner::from_original_root(root).map_err(Error::Original)
 }
 pub(crate)fn invalidate(&self){self.phase.set(Phase::Unknown)}
 pub(crate)fn current(&self,input:&crate::private_custodian_ffi::OriginalProviderInput<'_>)->Result<(),Error>{
  use sha2::Digest;let p=self.raw()?;if matches!(self.phase.get(),Phase::Unknown|Phase::Closed){return Err(Error::Unknown)}
  let result=(||{input.recheck().map_err(|_|Error::Unknown)?;let b=input.bootstrap_raw().map_err(|_|Error::Unknown)?;
   let source=input.source_raw().map_err(|_|Error::Unknown)?;let digest:[u8;32]=sha2::Sha256::digest(source).into();
   // Associations are checked in addition to real qualified platform current;
   // matching bytes alone never qualify a guard.
   if b.nonce!=&self.nonce||digest!=self.source_digest{return Err(Error::Unknown)}
   status(unsafe{ynx_source_client_current(p,0)})?;input.recheck().map_err(|_|Error::Unknown)})();if result.is_err(){self.invalidate()}result
 }
 pub(crate)fn enter(&mut self,input:&crate::private_custodian_ffi::OriginalProviderInput<'_>)->Result<(),Error>{
  self.current(input)?;if self.phase.get()==Phase::Entered{return Ok(())}if self.phase.get()!=Phase::Acquired{return Err(Error::Unknown)}
  let p=self.raw()?;self.invalidate();status(unsafe{ynx_source_client_enter(p)})?;self.phase.set(Phase::Entered);self.current(input)
 }
 pub(crate)fn check_type4(&self,input:&crate::private_custodian_ffi::OriginalProviderInput<'_>,wire:&[u8])->Result<(),Error>{
  self.current(input)?;if self.phase.get()!=Phase::Entered||wire.is_empty()||wire.len()>65536{return Err(Error::Required)}
  let result=status(unsafe{ynx_source_client_type4(self.raw()?,wire.as_ptr(),wire.len())}).and_then(|_|self.current(input));if result.is_err(){self.invalidate()}result
 }
 pub(crate)fn close(&mut self)->Result<(),Error>{
  if self.handle.is_none(){return Ok(())}let original=self.raw()?;let mut p=original;
  let code=unsafe{ynx_source_client_close(&mut p)};if code==0&&p.is_null(){self.handle=None;self.phase.set(Phase::Closed);return Ok(())}
  self.invalidate();if p!=original{return Err(Error::Abi)}status(code)?;Err(Error::Abi)
 }
}
impl Drop for OriginalSigningGuard{fn drop(&mut self){if self.handle.is_some(){std::process::abort();}}}

#[cfg(test)]mod initialization_plan_tests{
 use super::*;
 fn projection()->NativePlanRaw{let mut journal=[ptr::null();32];journal[0]=2usize as *const c_void;NativePlanRaw{intent:1usize as *const c_void,journal,journal_count:1,inbox:ptr::null(),outbox:ptr::null()}}
 #[test]fn core_initialization_plan_has_one_local_record_and_no_network_queue(){
  let plan=checked_plan(projection(),NativePlanKind::FirstDeviceInitialization).unwrap();assert_eq!(plan.journal.len(),1);assert!(plan.inbox.is_null()&&plan.outbox.is_null());
 }
 #[test]fn core_initialization_plan_cannot_infer_authority_from_an_empty_message_queue(){
  assert!(checked_plan(projection(),NativePlanKind::Message).is_err());
  for inbox in [true,false]{let mut raw=projection();if inbox{raw.inbox=3usize as *const c_void}else{raw.outbox=3usize as *const c_void}assert!(checked_plan(raw,NativePlanKind::FirstDeviceInitialization).is_err());}
 }
 #[test]fn core_initialization_plan_preserves_exactly_one_queue_for_message_consumers(){
  for inbox in [true,false]{let mut raw=projection();if inbox{raw.inbox=3usize as *const c_void}else{raw.outbox=3usize as *const c_void}assert!(checked_plan(raw,NativePlanKind::Message).is_ok());}
  let mut both=projection();both.inbox=3usize as *const c_void;both.outbox=4usize as *const c_void;assert!(checked_plan(both,NativePlanKind::Message).is_err());
 }
 #[test]fn core_initialization_plan_refuses_missing_extra_and_over_capacity_local_steps(){
  for count in [0,2,33]{let mut raw=projection();raw.journal_count=count;assert!(checked_plan(raw,NativePlanKind::FirstDeviceInitialization).is_err());}
  let mut missing=projection();missing.journal[0]=ptr::null();assert!(checked_plan(missing,NativePlanKind::FirstDeviceInitialization).is_err());
 }
}

// Exact private C layout. All fields are UNADMITTED bytes: no flags/current
// callbacks/Android pointers. Qualified static platform retains real owners.
#[repr(C)]#[derive(Clone,Copy)]pub(crate)struct ServerBytes{pub(crate)data:*const u8,pub(crate)size:usize}
impl ServerBytes{fn of(b:&[u8])->Self{Self{data:b.as_ptr(),size:b.len()}}}
#[repr(C)]pub(crate)struct ServerOriginalRaw{pub(crate)root:ServerBytes,pub(crate)registration:ServerBytes,pub(crate)status:ServerBytes,pub(crate)source:ServerBytes,pub(crate)namespace_prefix:ServerBytes,pub(crate)request:ServerBytes,pub(crate)nonce:*const u8,pub(crate)nonce_size:usize,pub(crate)status_history:*const ServerBytes,pub(crate)status_history_count:usize}
#[repr(C)]pub(crate)struct ServerInputRaw{pub(crate)original:ServerOriginalRaw,pub(crate)account_original:ServerBytes,pub(crate)prepared_original:ServerBytes}
#[repr(C)]pub(crate)struct ServerTerminalRaw{pub(crate)checkpoint:ServerBytes,pub(crate)namespace_prefix:ServerBytes,pub(crate)account_result:ServerBytes}
pub(crate)struct ServerInputBytes{fields:[zeroize::Zeroizing<Vec<u8>>;8],nonce:[u8;32],history:Vec<zeroize::Zeroizing<Vec<u8>>>,verified:crate::account_instance::ServerVerifiedOriginal,source_verified:crate::source_evidence::UnadmittedSourceEvidence}
pub(crate)struct ServerCoreOriginals<'a>{
 pub(crate)originals:[&'a[u8];6],pub(crate)history:&'a[zeroize::Zeroizing<Vec<u8>>],
 pub(crate)account_nonce:&'a[u8;32],pub(crate)source_nonce:&'a[u8;32],
 pub(crate)classic:&'a[u8;33],pub(crate)pq:&'a[u8;2592],
}
unsafe fn server_copy(b:ServerBytes,total:&mut usize)->Result<zeroize::Zeroizing<Vec<u8>>,Error>{if b.data.is_null()||b.size==0||b.size>393216usize.saturating_sub(*total){return Err(Error::Required)}*total+=b.size;Ok(zeroize::Zeroizing::new(unsafe{std::slice::from_raw_parts(b.data,b.size)}.to_vec()))}
impl ServerInputBytes{
 fn physical_resource_deadline(&self,root:&[u8;32],registration:&[u8;32],issuer:&[u8],anchor:&[u8])->Result<(u64,u64),Error>{
  use sha2::{Digest,Sha256};
  self.current()?;
  let start=crate::source_infrastructure::message_monotonic_ns().map_err(|_|Error::Unknown)?;
  if <[u8;32]>::from(Sha256::digest(self.fields[0].as_slice()))!=*root||
   <[u8;32]>::from(Sha256::digest(self.fields[1].as_slice()))!=*registration{return Err(Error::Required)}
  let operation=self.verified.operation().map_err(|_|Error::Required)?;
  // Exact fixed policy credentials must be the SAME two signed originals in
  // this account-bound Source carrier. No caller public key/Root replacement.
  let keys=self.source_verified.message_keys(operation,issuer,anchor).map_err(|_|Error::Required)?;
  keys.recheck().map_err(|_|Error::Required)?;
  let account=self.verified.physical_server_remaining_budget().map_err(|_|Error::Required)?;
  let source=self.source_verified.physical_server_remaining_budget(operation).map_err(|_|Error::Required)?;
  let remaining=u64::try_from(account.min(source).as_nanos()).map_err(|_|Error::Unknown)?;
  if remaining==0{return Err(Error::Required)}
  let deadline=start.checked_add(remaining).ok_or(Error::Unknown)?;
  keys.recheck().map_err(|_|Error::Required)?;self.current()?;
  let after=crate::source_infrastructure::message_monotonic_ns().map_err(|_|Error::Unknown)?;
  if after<start||after>=deadline{return Err(Error::Unknown)}Ok((start,deadline))
 }
 pub(crate)unsafe fn copy(raw:&ServerInputRaw)->Result<Self,Error>{let r=&raw.original;if r.nonce.is_null()||r.nonce_size!=32||r.status_history_count>255||(r.status_history_count!=0&&r.status_history.is_null()){return Err(Error::Required)}let mut total=32;let mut fields=std::array::from_fn(|_|zeroize::Zeroizing::new(Vec::new()));for(n,b)in [r.root,r.registration,r.status,r.source,r.namespace_prefix,r.request,raw.account_original,raw.prepared_original].into_iter().enumerate(){fields[n]=unsafe{server_copy(b,&mut total)}?;}let mut nonce=[0;32];nonce.copy_from_slice(unsafe{std::slice::from_raw_parts(r.nonce,32)});let mut history=Vec::new();if r.status_history_count!=0{for b in unsafe{std::slice::from_raw_parts(r.status_history,r.status_history_count)}{history.push(unsafe{server_copy(*b,&mut total)}?);}}let verified=crate::account_instance::ServerVerifiedOriginal::receive(&fields[0],&fields[1],&fields[2],&history,&fields[5],&fields[6],&fields[7]).map_err(|_|Error::Required)?;let source_verified=crate::source_evidence::verify_server_original(&fields[3],&fields[4],&nonce,&verified).map_err(|_|Error::Required)?;Ok(Self{fields,nonce,history,verified,source_verified})}
 fn current(&self)->Result<(),Error>{self.verified.current().map_err(|_|Error::Required)?;self.source_verified.recheck(self.verified.operation().map_err(|_|Error::Required)?).map_err(|_|Error::Required)?;self.verified.current().map_err(|_|Error::Required)}
 fn with_raw<R>(&self,f:impl FnOnce(&ServerInputRaw)->R)->R{let a=&self.fields;let history:Vec<_>=self.history.iter().map(|b|ServerBytes::of(b)).collect();let original=ServerOriginalRaw{root:ServerBytes::of(&a[0]),registration:ServerBytes::of(&a[1]),status:ServerBytes::of(&a[2]),source:ServerBytes::of(&a[3]),namespace_prefix:ServerBytes::of(&a[4]),request:ServerBytes::of(&a[5]),nonce:self.nonce.as_ptr(),nonce_size:32,status_history:history.as_ptr(),status_history_count:history.len()};f(&ServerInputRaw{original,account_original:ServerBytes::of(&a[6]),prepared_original:ServerBytes::of(&a[7])})}
}
unsafe extern "C"{fn ynx_source_client_server_first_cause(h:*mut c_void)->i32;fn ynx_source_client_server_acquire(i:*const ServerInputRaw,out:*mut *mut c_void)->i32;fn ynx_source_client_server_current(h:*mut c_void)->i32;fn ynx_source_client_server_completed_current(h:*mut c_void)->i32;fn ynx_source_client_server_enter(h:*mut c_void)->i32;fn ynx_source_client_server_retire(h:*mut c_void,i:*const ServerTerminalRaw)->i32;fn ynx_source_client_server_close(h:*mut *mut c_void)->i32;fn ynx_source_client_server_unknown(h:*mut c_void)->i32;}
pub(crate)struct ServerParticipant{handle:Option<NonNull<c_void>>,thread:ThreadId,phase:Phase,input:ServerInputBytes,enter_attempted:bool,retire_attempted:bool,close_code:Option<i32>,local:PhantomData<Rc<()>>}
pub(crate)struct ServerAcquireFailure{pub(crate)error:Error,pub(crate)retained:Option<ServerParticipant>}
impl ServerParticipant{
 pub(crate)fn core_facts(&mut self,original:&ServerCoreOriginals<'_>)->Result<crate::account_instance::ServerCoreFacts,Error>{
  self.current()?;
  if self.input.fields[..6].iter().zip(original.originals).any(|(a,b)|a.as_slice()!=b)||
   self.input.nonce!=*original.source_nonce||self.input.history.len()!=original.history.len()||
   self.input.history.iter().zip(original.history).any(|(a,b)|a.as_slice()!=b.as_slice()){
   return Err(Error::Foreign(7))
  }
  let facts=self.input.verified.core_facts(&self.input.fields[6],&self.input.fields[7],original.originals[5],original.account_nonce,original.classic,original.pq).map_err(|_|Error::Foreign(7))?;
  self.current()?;Ok(facts)
 }
 pub(crate)fn acquire(input:ServerInputBytes)->Result<Self,ServerAcquireFailure>{input.current().map_err(|_|ServerAcquireFailure{error:Error::Required,retained:None})?;let mut out=ptr::null_mut();let s=input.with_raw(|raw|unsafe{ynx_source_client_server_acquire(raw,&mut out)});let retained=NonNull::new(out).map(|h|Self{handle:Some(h),thread:thread::current().id(),phase:if s==0{Phase::Acquired}else{Phase::Unknown},input,enter_attempted:false,retire_attempted:false,close_code:None,local:PhantomData});match(status(s),retained){(Ok(()),Some(mut owner))=>match owner.current(){Ok(())=>Ok(owner),Err(error)=>Err(ServerAcquireFailure{error,retained:Some(owner)})},(Ok(()),None)=>Err(ServerAcquireFailure{error:Error::Abi,retained:None}),(Err(error),retained)=>Err(ServerAcquireFailure{error,retained})}}
 fn raw(&self)->Result<*mut c_void,Error>{if self.thread!=thread::current().id(){return Err(Error::Thread)}self.handle.map(|h|h.as_ptr()).ok_or(Error::Required)}
 pub(crate)fn current(&mut self)->Result<(),Error>{
  let p=self.raw()?;
  if self.phase==Phase::Unknown{return Err(Error::Unknown)}
  if self.phase!=Phase::Acquired&&self.phase!=Phase::Entered{return Err(Error::Required)}
  let r=self.input.current()
   .and_then(|_|status(unsafe{ynx_source_client_server_current(p)}))
   .and_then(|_|self.input.verified.current().map_err(|_|Error::Required));
  if r.is_err(){
   let entered=self.phase==Phase::Entered;self.phase=Phase::Unknown;
   // Even a refusal before the C call belongs to this retained ORIGINAL. Mark
   // its same C custody uncertain too; never re-acquire/re-enter an effect.
   let _=unsafe{ynx_source_client_server_unknown(p)};
   if entered{return Err(Error::Unknown)}
  }
  r
 }
 /* Post-retirement is independent of old pre-commit account/floor current.
  * The physical SAME-owner supplier checks its retained terminal and current
  * floor; public records, this phase and a Rust handle alone do not grant. */
 pub(crate)fn completed_current(&mut self)->Result<(),Error>{
  let p=self.raw()?;if self.phase==Phase::Unknown{return Err(Error::Unknown)}
  if self.phase!=Phase::Closed||!self.retire_attempted{return Err(Error::Required)}
  // These are the immutable signed Source/bootstrap/request windows, NOT
  // the old physical account/floor. Keep physical completed-current separate
  // from pre-effect current, but never let its callback renew the local window.
  // Select UNKNOWN before foreign entry so an unwind cannot reopen this owner.
  self.phase=Phase::Unknown;
  let result=self.input.current()
   .and_then(|_|status(unsafe{ynx_source_client_server_completed_current(p)}))
   .and_then(|_|self.input.current());
  if result.is_err(){let _=unsafe{ynx_source_client_server_unknown(p)};return Err(Error::Unknown)}
  self.phase=Phase::Closed;Ok(())
 }
 pub(crate)fn enter(&mut self)->Result<(),Error>{self.current()?;if self.phase!=Phase::Acquired||self.enter_attempted{return Err(Error::Unknown)}let p=self.raw()?;self.enter_attempted=true;self.phase=Phase::Unknown;status(unsafe{ynx_source_client_server_enter(p)})?;self.phase=Phase::Entered;self.current()}
 pub(crate)unsafe fn retire(&mut self,raw:&ServerTerminalRaw)->Result<(),Error>{self.current()?;if self.phase!=Phase::Entered||self.retire_attempted{return Err(Error::Unknown)}let mut total=0;let copied=(||{let a=unsafe{server_copy(raw.checkpoint,&mut total)}?;let b=unsafe{server_copy(raw.namespace_prefix,&mut total)}?;let c=unsafe{server_copy(raw.account_result,&mut total)}?;Ok::<_,Error>((a,b,c))})();let (a,b,c)=match copied{Ok(v)=>v,Err(_)=>{self.phase=Phase::Unknown;return Err(Error::Unknown)}};self.input.current().map_err(|_|{self.phase=Phase::Unknown;Error::Unknown})?;let input=ServerTerminalRaw{checkpoint:ServerBytes::of(&a),namespace_prefix:ServerBytes::of(&b),account_result:ServerBytes::of(&c)};let p=self.raw()?;self.retire_attempted=true;self.phase=Phase::Unknown;status(unsafe{ynx_source_client_server_retire(p,&input)})?;self.phase=Phase::Closed;/* Retired floor/account is not the pre-effect input current. Independently fence the SAME physical completed owner; never retry retirement. */self.completed_current()}
 pub(crate)fn first_cause(&self)->Result<i32,Error>{let p=self.raw()?;Ok(unsafe{ynx_source_client_server_first_cause(p)})}
 pub(crate)fn mark_unknown(&mut self)->Result<(),Error>{let p=self.raw()?;self.phase=Phase::Unknown;let _=unsafe{ynx_source_client_server_unknown(p)};Err(Error::Unknown)}
 pub(crate)fn close(&mut self)->Result<(),Error>{
  if self.handle.is_none(){return self.close_code.map_or(Ok(()),status)}
  let original=self.raw()?;let mut p=original;
  let s=unsafe{ynx_source_client_server_close(&mut p)};
  if s!=0&&self.close_code.is_none(){self.close_code=Some(s)}
  if p.is_null(){let code=self.close_code.unwrap_or(s);self.handle=None;self.phase=if code==0{Phase::Closed}else{Phase::Unknown};self.close_code=Some(code);return status(code)}
  self.phase=Phase::Unknown;if p!=original{return Err(Error::Abi)}status(s)?;Err(Error::Abi)
 }
}
impl Drop for ServerParticipant{fn drop(&mut self){if self.handle.is_some(){std::process::abort();}}}

// Pre-source private input. These borrowed carriers are UNADMITTED facts; only
// the separately enrolled static role platform can create the owning output.
#[repr(C)]pub(crate)struct RoleInputRaw{
 root:OriginalBytes,registration:OriginalBytes,status:OriginalBytes,credential:OriginalBytes,account_original:OriginalBytes,request:OriginalBytes,prepared_original:OriginalBytes,directory_checkpoint:OriginalBytes,namespace_prefix:OriginalBytes,
 status_history:*const OriginalBytes,status_history_count:usize,nonce:*const u8,nonce_size:usize,purpose:u32,role:u32,
}
#[repr(C)]struct RoleBindingRaw{operation:OriginalBytes,custodian:OriginalBytes,frame:OriginalBytes,nonce:[u8;32],head:[u8;32],classic_public:[u8;33],pq_public:[u8;2592],sequence:u64,purpose:u32,role:u32}
unsafe extern "C"{
 fn ynx_source_client_role_acquire(i:*const RoleInputRaw,o:*mut *mut c_void)->i32;
 fn ynx_source_client_role_current(h:*mut c_void)->i32;
 fn ynx_source_client_role_projection(h:*mut c_void,o:*mut RoleBindingRaw)->i32;
 fn ynx_source_client_role_enter(h:*mut c_void)->i32;
 fn ynx_source_client_role_close(h:*mut *mut c_void)->i32;
}
pub(crate)struct ProtectedRole{handle:Option<NonNull<c_void>>,thread:ThreadId,unknown:bool,entered:bool,nonce:[u8;32],role:u32,purpose:u32,local:PhantomData<Rc<()>>}
pub(crate)struct RoleFailure{pub(crate)error:Error,pub(crate)retained:Option<ProtectedRole>}
impl ProtectedRole{
 // Caller must hold actual original carriers alive for this bounded synchronous
 // copy. Platform retains its own authenticated original lifetime before return.
 pub(crate)unsafe fn acquire(input:&RoleInputRaw,credential:&[u8])->Result<Self,RoleFailure>{
  use zeroize::Zeroizing;
  let refused=||RoleFailure{error:Error::Required,retained:None};
  if !(1..=2).contains(&input.role)||!(1..=2).contains(&input.purpose)||input.nonce.is_null()||input.nonce_size!=32||input.status_history_count>255||(input.status_history_count!=0&&input.status_history.is_null()){return Err(refused())}
  let mut total=32usize;
  let copy=|r:&OriginalBytes,total:&mut usize|->Result<Zeroizing<Vec<u8>>,RoleFailure>{if r.data.is_null()||r.size==0||r.size>393216{return Err(refused())}*total=total.checked_add(r.size).filter(|n|*n<=393216).ok_or_else(refused)?;Ok(Zeroizing::new(unsafe{std::slice::from_raw_parts(r.data,r.size)}.to_vec()))};
  let roots=[&input.root,&input.registration,&input.status,&input.credential,&input.account_original,&input.request,&input.prepared_original,&input.directory_checkpoint,&input.namespace_prefix];
  let mut values=Vec::new();for (index,r) in roots.into_iter().enumerate(){if index==6&&input.purpose==1{if r.size!=0{return Err(refused())}values.push(Zeroizing::new(Vec::new()));}else{values.push(copy(r,&mut total)?)}}
  if values[3].as_slice()!=credential{return Err(refused())}
  let histories=if input.status_history_count==0{&[]}else{unsafe{std::slice::from_raw_parts(input.status_history,input.status_history_count)}};
  let mut retained_history=Vec::new();for r in histories{retained_history.push(copy(r,&mut total)?)}
  let history:Vec<_>=retained_history.iter().map(|r|OriginalBytes::of(r)).collect();
  let nonce=unsafe{std::slice::from_raw_parts(input.nonce,32)}.to_vec();
  let raw=RoleInputRaw{root:OriginalBytes::of(&values[0]),registration:OriginalBytes::of(&values[1]),status:OriginalBytes::of(&values[2]),credential:OriginalBytes::of(&values[3]),account_original:OriginalBytes::of(&values[4]),request:OriginalBytes::of(&values[5]),prepared_original:OriginalBytes::of(&values[6]),directory_checkpoint:OriginalBytes::of(&values[7]),namespace_prefix:OriginalBytes::of(&values[8]),status_history:history.as_ptr(),status_history_count:history.len(),nonce:nonce.as_ptr(),nonce_size:32,purpose:input.purpose,role:input.role};
  let mut out=ptr::null_mut();let s=unsafe{ynx_source_client_role_acquire(&raw,&mut out)};
  let retained=NonNull::new(out).map(|h|Self{handle:Some(h),thread:thread::current().id(),unknown:s!=0,entered:false,nonce:nonce.as_slice().try_into().unwrap(),role:input.role,purpose:input.purpose,local:PhantomData});
  match(status(s),retained){(Ok(()),Some(mut owner))=>match owner.current(){Ok(())=>Ok(owner),Err(error)=>Err(RoleFailure{error,retained:Some(owner)})},(Ok(()),None)=>Err(RoleFailure{error:Error::Abi,retained:None}),(Err(error),retained)=>Err(RoleFailure{error,retained})}
 }
 fn raw(&self)->Result<*mut c_void,Error>{if self.thread!=thread::current().id(){return Err(Error::Thread)}self.handle.map(|h|h.as_ptr()).ok_or(Error::Required)}
 pub(crate)fn current(&mut self)->Result<(),Error>{let p=self.raw()?;if self.unknown{return Err(Error::Unknown)}let r=status(unsafe{ynx_source_client_role_current(p)});if r.is_err(){self.unknown=true}r}
 pub(crate)fn enter(&mut self)->Result<(),Error>{self.current()?;if self.entered{return Err(Error::Unknown)}let p=self.raw()?;self.entered=true;self.unknown=true;status(unsafe{ynx_source_client_role_enter(p)})?;self.unknown=false;self.current()}
 pub(crate)fn invalidate(&mut self){self.unknown=true;}
 pub(crate)fn binding(&mut self)->Result<super::SourceAttemptBinding,Error>{
  self.current()?;let mut out:RoleBindingRaw=unsafe{std::mem::zeroed()};let s=unsafe{ynx_source_client_role_projection(self.raw()?,&mut out)};
  if let Err(e)=status(s).and_then(|_|self.current()){self.unknown=true;return Err(e)}
  let copy=|r:&OriginalBytes,max|->Result<Vec<u8>,Error>{if r.data.is_null()||r.size==0||r.size>max{return Err(Error::Abi)}Ok(unsafe{std::slice::from_raw_parts(r.data,r.size)}.to_vec())};
  if out.nonce!=self.nonce||out.role!=self.role||out.purpose!=self.purpose{self.unknown=true;return Err(Error::Abi)}
  let result=(||{
   let op=copy(&out.operation,128)?;let custodian=copy(&out.custodian,512)?;let frame=copy(&out.frame,49152)?;
   let role=match out.role{1=>super::SourceRole::Issuer,2=>super::SourceRole::Anchor,_=>return Err(Error::Abi)};
   match out.purpose{1=>super::SourceAttemptBinding::bounded(&op,out.nonce,out.sequence,out.head,role,&custodian,out.classic_public,&out.pq_public,&frame),2=>super::SourceAttemptBinding::bounded_first_prepared(&op,out.nonce,out.sequence,out.head,role,&custodian,out.classic_public,&out.pq_public,&frame),_=>return Err(Error::Abi)}.map_err(|_|Error::Abi)
  })();
  if result.is_err(){self.unknown=true}self.current()?;result
 }
 pub(crate)fn close(&mut self)->Result<(),Error>{let Some(old)=self.handle else{return Ok(())};let mut out=self.raw()?;let s=unsafe{ynx_source_client_role_close(&mut out)};if s==0&&out.is_null(){self.handle=None;return Ok(())}self.unknown=true;if out!=old.as_ptr(){return Err(Error::Abi)}status(s)?;Err(Error::Abi)}
}
impl Drop for ProtectedRole{fn drop(&mut self){if self.handle.is_some(){std::process::abort()}}}

impl RoleInputRaw{pub(super)fn purpose_value(&self)->u32{self.purpose}}

#[cfg(test)]mod role_abi_delta_controls{
 use super::*;
 #[test]fn exact_private_role_c_layout(){assert_eq!(std::mem::size_of::<RoleInputRaw>(),184);assert_eq!(std::mem::size_of::<RoleBindingRaw>(),2760);}
 #[cfg(feature="source-server-collector")]
 #[test]fn exact_private_server_collector_layout(){assert_eq!(std::mem::size_of::<crate::source_infrastructure::source_collector::ClaimedIntentRaw>(),104);}
 #[test]fn missing_original_input_never_calls_qualified_acquisition(){let r:RoleInputRaw=unsafe{std::mem::zeroed()};let e=match unsafe{ProtectedRole::acquire(&r,b"PUBLIC")}{Err(e)=>e,Ok(_)=>panic!("missing input acquired")};assert!(matches!(e.error,Error::Required));assert!(e.retained.is_none());}
}

#[repr(C)]struct ServerDeviceOriginalRaw{version:u32,final_raw:ServerBytes,current:ServerBytes,terminal:ServerBytes,checkpoint:ServerBytes,predecessors:*const ServerBytes,predecessor_count:usize}
unsafe extern "C"{fn ynx_source_client_server_device_originals(h:*mut c_void,out:*mut ServerDeviceOriginalRaw)->i32;}
impl ServerParticipant{
 pub(crate)fn device_records_transport(&mut self)->Result<Vec<u8>,Error>{
  let p=self.raw()?;if self.phase==Phase::Unknown{return Err(Error::Unknown)}if self.phase!=Phase::Closed||!self.retire_attempted{return Err(Error::Required)}
  let mut raw=ServerDeviceOriginalRaw{version:0,final_raw:ServerBytes{data:ptr::null(),size:0},current:ServerBytes{data:ptr::null(),size:0},terminal:ServerBytes{data:ptr::null(),size:0},checkpoint:ServerBytes{data:ptr::null(),size:0},predecessors:ptr::null(),predecessor_count:0};
  let s=unsafe{ynx_source_client_server_device_originals(p,&mut raw)};if s!=0{if !matches!(status(s),Err(Error::Required)){self.phase=Phase::Unknown;}return status(s).and(Err(Error::Required));}
  let result=(||{if raw.version!=1||raw.predecessor_count>255||(raw.predecessor_count>0&&raw.predecessors.is_null()){return Err(Error::Abi)}let mut total=0;let a=unsafe{server_copy(raw.final_raw,&mut total)}?;let b=unsafe{server_copy(raw.current,&mut total)}?;let c=unsafe{server_copy(raw.terminal,&mut total)}?;let d=unsafe{server_copy(raw.checkpoint,&mut total)}?;let mut history=Vec::new();if raw.predecessor_count>0{for part in unsafe{std::slice::from_raw_parts(raw.predecessors,raw.predecessor_count)}{history.push(unsafe{server_copy(*part,&mut total)}?);}}let parts:Vec<_>=history.iter().map(|x|x.as_slice()).collect();let transport=crate::message_evidence::OriginalDeviceRecords::canonical_transport(&a,&b,&parts,&c,&d).map_err(|_|Error::Abi)?;let mut late=ServerDeviceOriginalRaw{version:0,..raw};status(unsafe{ynx_source_client_server_device_originals(p,&mut late)})?;if late.version!=1||late.predecessor_count!=history.len(){return Err(Error::Unknown)}let mut late_total=0;if unsafe{server_copy(late.final_raw,&mut late_total)}?!=a||unsafe{server_copy(late.current,&mut late_total)}?!=b||unsafe{server_copy(late.terminal,&mut late_total)}?!=c||unsafe{server_copy(late.checkpoint,&mut late_total)}?!=d{return Err(Error::Unknown)}if !history.is_empty(){if late.predecessors.is_null(){return Err(Error::Unknown)}for (original,same) in history.iter().zip(unsafe{std::slice::from_raw_parts(late.predecessors,late.predecessor_count)}){if unsafe{server_copy(*same,&mut late_total)}?.as_slice()!=original.as_slice(){return Err(Error::Unknown)}}}Ok(transport)})();if result.is_err(){self.phase=Phase::Unknown;}result
 }
}

#[cfg(test)]mod first_device_core_intake_controls{
 use super::*;
 fn raw(intent:&[u8])->OriginalInput{
  OriginalInput{root:OriginalBytes::of(b"root"),registration:OriginalBytes::of(b"registration"),
   status:OriginalBytes::of(b"status"),source:OriginalBytes::of(b"source"),
   namespace_prefix:OriginalBytes::of(b"namespace"),request:OriginalBytes::of(intent),
   nonce:ptr::null(),nonce_size:32,status_history:ptr::null(),status_history_count:0,
   native_classic:[0;33],native_pq:[0;2592],source_nonce:[0;32],monotonic_deadline_ns:17}
 }
 #[test]fn existing_read_never_requests_first_device_mutations(){
  let v=OriginalInputV2::original_read(raw(b"original-intent"));
  assert_eq!((v.rights.purpose,v.rights.operation,v.rights.key_uses,v.rights.required_operations),(1,3,1,4));
  assert!(v.android_own_key_platform.is_null());
  assert_eq!(std::mem::size_of::<OriginalInputV2>(),2888);
  assert_eq!(std::mem::offset_of!(OriginalInputV2,android_own_key_platform),2880);
 }
 #[test]fn first_device_request_pins_complete_initialization_intent(){
  use sha2::{Digest,Sha256};
  let bytes=b"original-intent";
  let v=OriginalInputV2::for_intent(raw(bytes),OriginalCoreIntent::InitializeFirstDevice);
  assert_eq!((v.rights.purpose,v.rights.operation,v.rights.key_uses,v.rights.required_operations),(1,1,15,63));
  assert_eq!((v.rights.version,v.rights.size,v.rights.context_id,v.rights.context_generation),(2,80,0,0));
  assert_eq!(v.rights.deadline,17);
  assert_eq!(v.original.request.data,bytes.as_ptr());
  assert_eq!(v.rights.intent_digest,<[u8;32]>::from(Sha256::digest(bytes)));
  // This request is deliberately NOT an authorization assertion.
 }
}

// Private original-fact custody for the physical producer; not qualification.
#[path="server_original_owner.rs"] mod server_original_owner;

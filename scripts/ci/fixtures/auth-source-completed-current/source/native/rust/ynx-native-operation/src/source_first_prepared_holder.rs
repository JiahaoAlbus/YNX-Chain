//! Independently verified protected holder loading. Not a signing dispatcher.
//! Current-operation/history/once/through-effect authorization is still required.
use super::*;
use crate::source_evidence::{Error as EvidenceError,VerifiedFirstPreparedHolderCredential,VerifiedDirectoryHolderCredential};
pub(super)enum HolderCredential{FirstPrepared(VerifiedFirstPreparedHolderCredential),Directory(VerifiedDirectoryHolderCredential)}
impl HolderCredential{
 pub(super)fn recheck(&self)->Result<(),EvidenceError>{match self{Self::FirstPrepared(c)=>c.recheck(),Self::Directory(c)=>c.recheck()}}
 fn storage(&self)->(SourceRole,&[u8],&std::ffi::CStr,u64,&[u8;33],&[u8;2592]){match self{Self::FirstPrepared(c)=>c.storage(),Self::Directory(c)=>c.storage()}}
 fn sealed_borrow(&self)->Result<crate::source_infrastructure::VerifiedSealedCredentialBorrow<'_>,EvidenceError>{match self{Self::FirstPrepared(c)=>c.sealed_borrow(),Self::Directory(c)=>c.sealed_borrow()}}
 fn purpose(&self)->u32{match self{Self::FirstPrepared(_)=>2,Self::Directory(_)=>1}}
}

pub(crate)enum FirstPreparedHolderError{Credential(EvidenceError),Custody(SourceError),#[cfg(feature="abi5-final-native-link")]Platform(platform::Error),#[cfg(feature="abi5-final-native-link")]Original(crate::staging::platform::SourceOwnerError)}
pub(crate)struct FirstPreparedHolderOpenFailure{
 pub(crate)error:FirstPreparedHolderError,
 // Partial custody must be retained and explicitly closed, not dropped on error.
 pub(crate)retained:Option<FirstPreparedProtectedHolder>,
}
pub(crate)struct FirstPreparedProtectedHolder{
 pair:InfrastructurePair,credential:HolderCredential,credential_raw:Zeroizing<Vec<u8>>,
 #[cfg(feature="abi5-final-native-link")]progress:RecoveryProgress,
}
impl FirstPreparedProtectedHolder{
 // Called only with the actual original loan retained by the normal receiver.
 // Output remains storage-only. Cannot invoke sign_original_source_frame or
 // construct accepted Native/Source capability, independently locked anchor,
 // complete account namespace prefix, CAS or terminal ownership.
 pub(crate)fn original_storage_binding(&self,loan:&crate::private_custodian_ffi::RecoveryLoan<'_>)->Result<SourceAttemptBinding,FirstPreparedHolderError>{
  self.checked_current()?;
  let original=SourceAttemptBinding::original_first_prepared(loan,match &self.credential{HolderCredential::FirstPrepared(c)=>c,HolderCredential::Directory(_)=>return Err(FirstPreparedHolderError::Custody(SourceError::Pair))}).map_err(FirstPreparedHolderError::Custody)?;
  self.checked_current()?;Ok(original)
 }
 // Read only the retained result for this actual loan and this holder. Missing
 // custody is an error, never evidence of no effect or permission to dispatch.
 // Encoded signatures, if present, remain unverified transport artifacts.
 pub(crate)fn observe_original_outcome(&self,loan:&crate::private_custodian_ffi::RecoveryLoan<'_>)->Result<Vec<u8>,FirstPreparedHolderError>{
  let binding=self.original_storage_binding(loan)?;
  let outcome=self.pair.observe_original(&binding).and_then(|attempt|attempt.encode_unverified_outcome()).map_err(FirstPreparedHolderError::Custody)?;
  loan.original_provider_input().and_then(|input|input.recheck()).map_err(|_|FirstPreparedHolderError::Custody(SourceError::Unknown))?;
  self.checked_current()?;Ok(outcome)
 }

 pub(super)fn sealed_custody_current(&self)->Result<(),SourceError>{self.pair.sealed_current()}
 pub(super)fn current(&self)->Result<(),EvidenceError>{self.credential.recheck()}
 // The physical current call is foreign and can consume the original window.
 // Never publish a successful status after checking only one side of it.
 pub(super)fn checked_current(&self)->Result<(),FirstPreparedHolderError>{
  self.current().map_err(FirstPreparedHolderError::Credential)?;
  self.sealed_custody_current().map_err(FirstPreparedHolderError::Custody)?;
  self.current().map_err(FirstPreparedHolderError::Credential)
 }
 pub(crate)fn open(credential_fd:i32,role:SourceRole,credential:&[u8],q:&SourcePqRecord,c:&SourceClassicRecord)->Result<Self,FirstPreparedHolderOpenFailure>{
  let credential_raw=Zeroizing::new(credential.to_vec());
  let credential=HolderCredential::FirstPrepared(VerifiedFirstPreparedHolderCredential::verify(credential,role).map_err(|e|FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(e),retained:None})?);
  credential.recheck().map_err(|e|FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(e),retained:None})?;
  let (role,custodian,alias,generation,classic,pq)=credential.storage();
  let pair=match InfrastructurePair::reload(credential_fd,role,custodian,alias,generation,classic,pq,q,c){
   Ok(pair)=>pair,
   Err((error,pair))=>return Err(FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Custody(error),retained:Some(Self{pair,credential,credential_raw,#[cfg(feature="abi5-final-native-link")]progress:RecoveryProgress::New})}),
  };
  let owner=Self{pair,credential,credential_raw,#[cfg(feature="abi5-final-native-link")]progress:RecoveryProgress::New};
  if let Err(error)=owner.checked_current(){return Err(FirstPreparedHolderOpenFailure{error,retained:Some(owner)})}
  Ok(owner)
 }
 pub(crate)fn open_directory(credential_fd:i32,role:SourceRole,credential:&[u8],q:&SourcePqRecord,c:&SourceClassicRecord)->Result<Self,FirstPreparedHolderOpenFailure>{
  let credential_raw=Zeroizing::new(credential.to_vec());
  let credential=HolderCredential::Directory(VerifiedDirectoryHolderCredential::verify(credential,role).map_err(|e|FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(e),retained:None})?);
  credential.recheck().map_err(|e|FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(e),retained:None})?;
  let (role,custodian,alias,generation,classic,pq)=credential.storage();
  let pair=match InfrastructurePair::reload(credential_fd,role,custodian,alias,generation,classic,pq,q,c){
   Ok(pair)=>pair,
   Err((error,pair))=>return Err(FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Custody(error),retained:Some(Self{pair,credential,credential_raw,#[cfg(feature="abi5-final-native-link")]progress:RecoveryProgress::New})}),
  };
  let owner=Self{pair,credential,credential_raw,#[cfg(feature="abi5-final-native-link")]progress:RecoveryProgress::New};
  if let Err(error)=owner.checked_current(){return Err(FirstPreparedHolderOpenFailure{error,retained:Some(owner)})}
  Ok(owner)
 }
 // Existing signed credential verifiers run before any protected selection.
 // Resolver refusal is not bypassed by storage bytes, token or public pair.
 pub(crate)fn open_sealed(role:SourceRole,purpose:u32,raw:&[u8],q:&SourcePqRecord,c:&SourceClassicRecord)->Result<Self,FirstPreparedHolderOpenFailure>{
  let verified=match purpose{
   1=>VerifiedDirectoryHolderCredential::verify(raw,role).map(HolderCredential::Directory),
   2=>VerifiedFirstPreparedHolderCredential::verify(raw,role).map(HolderCredential::FirstPrepared),
   _=>Err(EvidenceError::Binding),
  }.map_err(|e|FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(e),retained:None})?;
  Self::open_verified_sealed(raw,q,c,verified)
 }
 /// Explicit V4 sealed-custody factory. Legacy open_sealed stays V3-only;
 /// this method cannot infer Root approval from an FD2 proposal or purpose.
 #[cfg(feature="predevice-initial-prekeys-v1")]
 pub(crate)fn open_sealed_initial_prekeys(role:SourceRole,purpose:u32,raw:&[u8],q:&SourcePqRecord,c:&SourceClassicRecord)->Result<Self,FirstPreparedHolderOpenFailure>{
  let verified=match purpose{
   1=>VerifiedDirectoryHolderCredential::verify_initial_prekeys(raw,role).map(HolderCredential::Directory),
   2=>VerifiedFirstPreparedHolderCredential::verify_initial_prekeys(raw,role).map(HolderCredential::FirstPrepared),
   _=>Err(EvidenceError::Binding),
  }.map_err(|e|FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(e),retained:None})?;
  Self::open_verified_sealed(raw,q,c,verified)
 }
 fn open_verified_sealed(raw:&[u8],q:&SourcePqRecord,c:&SourceClassicRecord,verified:HolderCredential)->Result<Self,FirstPreparedHolderOpenFailure>{
  verified.recheck().map_err(|e|FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(e),retained:None})?;
  let borrow=verified.sealed_borrow().map_err(|e|FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(e),retained:None})?;
  let pair=match InfrastructurePair::reload_sealed(&borrow,q,c){
   Ok(p)=>p,
   Err((e,pair))=>{
    if pair.sealed.is_null()&&pair.wrapping.is_null()&&pair.pq.is_null()&&pair.classic.is_none(){drop(pair);return Err(FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Custody(e),retained:None})}
    return Err(FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Custody(e),retained:Some(Self{pair,credential:verified,credential_raw:Zeroizing::new(raw.to_vec()),#[cfg(feature="abi5-final-native-link")]progress:RecoveryProgress::New})})
   },
  };
  let owner=Self{pair,credential:verified,credential_raw:Zeroizing::new(raw.to_vec()),#[cfg(feature="abi5-final-native-link")]progress:RecoveryProgress::New};
  if let Err(error)=owner.checked_current(){return Err(FirstPreparedHolderOpenFailure{error,retained:Some(owner)})}
  Ok(owner)
 }
 // Closing stale/partially loaded custody must remain possible. No renewal,
 // signing, key export, collector installation or device permission API here.
 pub(crate)fn close(&mut self)->Result<(),SourceError>{
  #[cfg(feature="abi5-final-native-link")]if !self.pair.used&&self.pair.attempt.as_ref().is_some_and(|a|a.phase==AttemptPhase::Ready){
   // Holder still owns untransferred Ready custody: no Go owner was issued.
   // The real platform must accept unentered close before RAM cancellation.
   if let Some(g)=self.pair.role_guard.as_mut(){g.close().map_err(|_|SourceError::Unknown)?;}else{return Err(SourceError::Unknown)}
   self.pair.role_guard=None;drop(self.pair.attempt.take());self.pair.used=true;self.pair.unknown=true;
  }
  self.pair.close()
 }
 // Borrow only an owner acquired by Main's private normal producer. This
 // cannot construct an original owner, an Attempt binding or signing rights.
 #[cfg(feature="abi5-final-native-link")]
 pub(crate)fn borrow_original<'supplier,'held,'op>(&'supplier mut self,held:&'supplier mut crate::staging::platform::SourceHeldOriginal<'held,'op>)->Result<FirstPreparedOriginalBorrow<'supplier,'held,'op>,FirstPreparedHolderError>{
  self.checked_current()?;
  held.validate().map_err(FirstPreparedHolderError::Original)?;
  self.checked_current()?;
  if self.progress!=RecoveryProgress::New{return Err(FirstPreparedHolderError::Custody(SourceError::Unknown))}
  Ok(FirstPreparedOriginalBorrow{holder:self,held})
 }
}

#[cfg(feature="abi5-final-native-link")]
pub(crate)struct FirstPreparedOriginalBorrow<'supplier,'held,'op>{
 holder:&'supplier mut FirstPreparedProtectedHolder,
 held:&'supplier mut crate::staging::platform::SourceHeldOriginal<'held,'op>,
}
// Local exclusion only. No transition confers currentness or authority.
#[cfg(feature="abi5-final-native-link")]
#[derive(PartialEq,Eq)]enum RecoveryProgress{New,RecoveryAttempted,AckAttempted}
#[cfg(feature="abi5-final-native-link")]
impl RecoveryProgress{
 fn claim_recovery(&mut self)->Result<(),FirstPreparedHolderError>{if *self!=Self::New{return Err(FirstPreparedHolderError::Custody(SourceError::Unknown))}*self=Self::RecoveryAttempted;Ok(())}
 fn claim_ack(&mut self)->Result<(),FirstPreparedHolderError>{if *self!=Self::RecoveryAttempted{return Err(FirstPreparedHolderError::Custody(SourceError::Unknown))}*self=Self::AckAttempted;Ok(())}
}
#[cfg(feature="abi5-final-native-link")]
pub(crate)struct FirstPreparedRecoveryFailure<'held,'op>{
 pub(crate)error:FirstPreparedHolderError,
 // Caller retains and explicitly disposes the genuine Main owner. Never
 // silently Drop an acquired commit after a later credential/current failure.
 pub(crate)retained:Option<crate::staging::platform::SourceCommitOwner<'held,'op>>,
}
#[cfg(feature="abi5-final-native-link")]
impl<'supplier,'held,'op> FirstPreparedOriginalBorrow<'supplier,'held,'op>{
 pub(crate)fn current(&mut self)->Result<(),FirstPreparedHolderError>{
  self.holder.checked_current()?;
  self.held.validate().map_err(FirstPreparedHolderError::Original)?;
  self.holder.checked_current()
 }
 pub(crate)fn recover(&mut self)->Result<crate::staging::platform::SourceCommitOwner<'held,'op>,FirstPreparedRecoveryFailure<'held,'op>>{
  if self.holder.progress!=RecoveryProgress::New{return Err(FirstPreparedRecoveryFailure{error:FirstPreparedHolderError::Custody(SourceError::Unknown),retained:None})}
  self.current().map_err(|error|FirstPreparedRecoveryFailure{error,retained:None})?;
  self.holder.progress.claim_recovery().map_err(|error|FirstPreparedRecoveryFailure{error,retained:None})?;
  let commit=self.held.recover().map_err(|error|FirstPreparedRecoveryFailure{error:FirstPreparedHolderError::Original(error),retained:None})?;
  if let Err(error)=self.current(){return Err(FirstPreparedRecoveryFailure{error,retained:Some(commit)})}
  Ok(commit)
 }
 pub(crate)fn acknowledge(&mut self,commit:&mut crate::staging::platform::SourceCommitOwner<'held,'op>)->Result<(),FirstPreparedHolderError>{
  if self.holder.progress!=RecoveryProgress::RecoveryAttempted{return Err(FirstPreparedHolderError::Custody(SourceError::Unknown))}
  self.current()?;self.holder.progress.claim_ack()?;
  commit.acknowledge(self.held).map_err(FirstPreparedHolderError::Original)?;
  self.current()
 }
}

#[cfg(test)]mod controls{
 use super::*;
 #[test]fn malformed_credential_does_not_acquire_partial_holder(){
  let q=SourcePqRecord{version:0,aad_size:0,aad:[0;7168],nonce:[0;12],cipher:[0;4912]};
  let c=SourceClassicRecord{version:0,aad_size:0,cipher_size:0,aad:[0;7168],nonce:[0;12],cipher:[0;272]};
  let failure=match FirstPreparedProtectedHolder::open(-1,SourceRole::Issuer,b"{}",&q,&c){Err(e)=>e,Ok(_)=>panic!("malformed credential acquired holder")};
  assert!(failure.retained.is_none());
  assert!(matches!(failure.error,FirstPreparedHolderError::Credential(_)));
 }
}

#[cfg(all(test,feature="abi5-final-native-link"))]
mod supplier_typed_bridge_controls{
 use super::*;
 // Compile the actual borrowed method types without a fabricated credential,
 // original owner, raw pointer, native invocation or cryptographic operation.
 fn borrow<'s,'h,'o>(holder:&'s mut FirstPreparedProtectedHolder,held:&'s mut crate::staging::platform::SourceHeldOriginal<'h,'o>)->Result<FirstPreparedOriginalBorrow<'s,'h,'o>,FirstPreparedHolderError>{holder.borrow_original(held)}
 fn recover<'h,'o>(borrow:&mut FirstPreparedOriginalBorrow<'_,'h,'o>)->Result<crate::staging::platform::SourceCommitOwner<'h,'o>,FirstPreparedRecoveryFailure<'h,'o>>{borrow.recover()}
 fn ack<'h,'o>(borrow:&mut FirstPreparedOriginalBorrow<'_,'h,'o>,commit:&mut crate::staging::platform::SourceCommitOwner<'h,'o>)->Result<(),FirstPreparedHolderError>{borrow.acknowledge(commit)}
 #[test]fn supplier_actual_typed_borrow_compile_only(){let _=borrow;let _=recover;let _=ack;}
 #[test]fn supplier_recovery_exclusion_never_resets_after_failure(){
  let mut p=RecoveryProgress::New;assert!(p.claim_ack().is_err());assert!(p==RecoveryProgress::New);
  assert!(p.claim_recovery().is_ok());assert!(p.claim_recovery().is_err());
  assert!(p.claim_ack().is_ok());assert!(p.claim_ack().is_err());assert!(p.claim_recovery().is_err());
 }
}

// Distinct first-device server participant: normal acquisition delegates to
// the genuine static platform, not HolderToken/status/storage-only recovery.
#[cfg(feature="abi5-final-native-link")]
pub(crate)struct ServerFirstDeviceParticipant{owner:crate::source_infrastructure::platform::ServerParticipant}
#[cfg(feature="abi5-final-native-link")]
pub(crate)struct ServerFirstDeviceAcquireFailure{pub(crate)error:crate::source_infrastructure::platform::Error,pub(crate)retained:Option<ServerFirstDeviceParticipant>}
#[cfg(feature="abi5-final-native-link")]
impl ServerFirstDeviceParticipant{
 pub(crate)fn core_facts(&mut self,original:&crate::source_infrastructure::platform::ServerCoreOriginals<'_>)->Result<crate::account_instance::ServerCoreFacts,crate::source_infrastructure::platform::Error>{self.owner.core_facts(original)}
 pub(crate)unsafe fn acquire(raw:&crate::source_infrastructure::platform::ServerInputRaw)->Result<Self,ServerFirstDeviceAcquireFailure>{let input=unsafe{crate::source_infrastructure::platform::ServerInputBytes::copy(raw)}.map_err(|error|ServerFirstDeviceAcquireFailure{error,retained:None})?;match crate::source_infrastructure::platform::ServerParticipant::acquire(input){Ok(owner)=>Ok(Self{owner}),Err(f)=>Err(ServerFirstDeviceAcquireFailure{error:f.error,retained:f.retained.map(|owner|Self{owner})})}}
 pub(crate)fn current(&mut self)->Result<(),crate::source_infrastructure::platform::Error>{self.owner.current()}
 pub(crate)fn completed_current(&mut self)->Result<(),crate::source_infrastructure::platform::Error>{self.owner.completed_current()}
 pub(crate)fn enter(&mut self)->Result<(),crate::source_infrastructure::platform::Error>{self.owner.enter()}
 pub(crate)unsafe fn retire(&mut self,input:&crate::source_infrastructure::platform::ServerTerminalRaw)->Result<(),crate::source_infrastructure::platform::Error>{unsafe{self.owner.retire(input)}}
 pub(crate)fn device_records_transport(&mut self)->Result<Vec<u8>,crate::source_infrastructure::platform::Error>{self.owner.device_records_transport()}
 pub(crate)fn mark_unknown(&mut self)->Result<(),crate::source_infrastructure::platform::Error>{self.owner.mark_unknown()}
 pub(crate)fn close(&mut self)->Result<(),crate::source_infrastructure::platform::Error>{self.owner.close()}
}

#[cfg(feature="abi5-final-native-link")]
impl FirstPreparedProtectedHolder{
 pub(crate)unsafe fn prepare_ready_role(&mut self,input:&platform::RoleInputRaw)->Result<(),FirstPreparedHolderError>{
  self.checked_current()?;
  if input.purpose_value()!=self.credential.purpose(){return Err(FirstPreparedHolderError::Custody(SourceError::Pair))}
  if self.pair.role_guard.is_some()||self.pair.attempt.is_some()||self.pair.used||self.pair.unknown{return Err(FirstPreparedHolderError::Custody(SourceError::Unknown))}
  match unsafe{platform::ProtectedRole::acquire(input,&self.credential_raw)}{
   Ok(g)=>self.pair.role_guard=Some(g),
   Err(f)=>{self.pair.role_guard=f.retained;return Err(FirstPreparedHolderError::Platform(f.error))}
  }
  self.checked_current()?;
  self.pair.prepare_role_ready().map_err(FirstPreparedHolderError::Custody)?;
  self.checked_current()
 }
 // Owning collector transfer belongs only to the normal server bridge.
 // Mobile ABI5 retains native custody but has no Go collector owner/output.
 #[cfg(feature="source-server-collector")]
 pub(crate)fn into_ready_collector(self)->Result<u64,Self>{
  if self.checked_current().is_err()||self.pair.role_guard.is_none()||!self.pair.attempt.as_ref().is_some_and(|a|a.phase==AttemptPhase::Ready){return Err(self)}
  let Self{pair,credential,credential_raw,progress}=self;
  match pair.retain_ready_for_collection(credential){Ok(id)=>Ok(id),Err((pair,credential))=>Err(Self{pair,credential,credential_raw,progress})}
 }
}

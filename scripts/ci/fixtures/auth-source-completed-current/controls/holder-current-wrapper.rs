#![allow(dead_code,unsafe_code)]
mod source_evidence {
 #[derive(Debug)] pub enum Error { Bounds,Canonical,ProfileRequired,Signature,Binding,Window }
}
mod source {
 use crate::source_evidence::Error as EvidenceError;
 use std::cell::RefCell;
 #[derive(Clone,Copy,PartialEq,Eq)] enum SourceRole { Issuer,Anchor }
 enum SourceError { Bounds,Thread,Pair,Closed,Unknown,Foreign(i32) }
 #[repr(C)] struct SourcePqRecord { bytes:[u8;12100] }
 #[repr(C)] struct SourceClassicRecord { bytes:[u8;7464] }
 mod first_prepared_holder {
  use super::*;
  pub(super) enum FirstPreparedHolderError { Credential(EvidenceError),Custody(SourceError) }
 }
 use first_prepared_holder::FirstPreparedHolderError;
 struct FirstPreparedHolderOpenFailure { error:FirstPreparedHolderError,retained:Option<FirstPreparedProtectedHolder> }
 struct FirstPreparedProtectedHolder;
 #[derive(Default)] struct PhysicalMock { events:Vec<&'static str>,expired:bool,expire_during_physical:bool,revoke:bool,panic:bool,close_fail:bool }
 thread_local! { static MOCK:RefCell<PhysicalMock>=RefCell::new(PhysicalMock::default()); }
 impl FirstPreparedProtectedHolder {
  fn current(&self)->Result<(),EvidenceError>{MOCK.with(|m|{let mut m=m.borrow_mut();m.events.push("credential");if m.expired{Err(EvidenceError::Window)}else{Ok(())}})}
  fn sealed_custody_current(&self)->Result<(),SourceError>{MOCK.with(|m|{let mut m=m.borrow_mut();m.events.push("physical");if m.panic{panic!("PUBLIC physical callback panic")}if m.expire_during_physical{m.expired=true}if m.revoke{Err(SourceError::Unknown)}else{Ok(())}})}
  @@ACTUAL_CHECKED_CURRENT@@
  fn refused()->Result<Self,FirstPreparedHolderOpenFailure>{Err(FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Credential(EvidenceError::Binding),retained:None})}
  fn open(_:i32,_:SourceRole,_:&[u8],_:&SourcePqRecord,_:&SourceClassicRecord)->Result<Self,FirstPreparedHolderOpenFailure>{Self::refused()}
  fn open_directory(_:i32,_:SourceRole,_:&[u8],_:&SourcePqRecord,_:&SourceClassicRecord)->Result<Self,FirstPreparedHolderOpenFailure>{Self::refused()}
  fn open_sealed(_:SourceRole,_:u32,_:&[u8],_:&SourcePqRecord,_:&SourceClassicRecord)->Result<Self,FirstPreparedHolderOpenFailure>{Self::refused()}
  fn open_sealed_initial_prekeys(_:SourceRole,_:u32,raw:&[u8],_:&SourcePqRecord,_:&SourceClassicRecord)->Result<Self,FirstPreparedHolderOpenFailure>{
   MOCK.with(|m|m.borrow_mut().events.push("V4-open-PUBLIC-boundary"));
   if raw==b"PUBLIC_PARTIAL"{return Err(FirstPreparedHolderOpenFailure{error:FirstPreparedHolderError::Custody(SourceError::Unknown),retained:Some(Self)})}
   if raw!=b"PUBLIC_V4"{return Self::refused()}
   let owner=Self;match owner.checked_current(){Ok(())=>Ok(owner),Err(error)=>Err(FirstPreparedHolderOpenFailure{error,retained:Some(owner)})}
  }
  fn close(&mut self)->Result<(),SourceError>{MOCK.with(|m|{let mut m=m.borrow_mut();m.events.push("close");if m.close_fail{Err(SourceError::Unknown)}else{Ok(())}})}
 }
 #[path="@@ACTUAL_FFI_PATH@@"] mod ffi;
}

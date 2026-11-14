use std::{cell::{Cell,RefCell},sync::atomic::{AtomicU64,Ordering}};
mod account_instance { #[derive(Clone,PartialEq,Eq)] pub(crate) struct ServerCoreFacts; }
mod source_infrastructure { pub(crate) mod platform {
 #[derive(Clone,Copy)]pub(crate)enum Error{Required,Thread,Unknown}
 pub(crate)struct ServerInputRaw;pub(crate)struct ServerTerminalRaw;
 pub(crate)struct ServerCoreOriginals<'a>(pub &'a ());
}}
thread_local! {static MODE:Cell<u32>=const{Cell::new(0)}; static COUNT:Cell<u32>=const{Cell::new(0)};static MARKS:Cell<u32>=const{Cell::new(0)}; static GETTERS:Cell<u32>=const{Cell::new(0)};static PINS:Cell<u32>=const{Cell::new(0)};}
mod first_prepared_holder {
 use crate::source_infrastructure::platform::{Error,ServerInputRaw,ServerTerminalRaw,ServerCoreOriginals};
 pub(crate)struct ServerFirstDeviceParticipant{closed:bool}
 pub(crate)struct Failure{pub(crate)error:Error,pub(crate)retained:Option<ServerFirstDeviceParticipant>}
 impl ServerFirstDeviceParticipant{
  pub(crate)unsafe fn acquire(_: &ServerInputRaw)->Result<Self,Failure>{Ok(Self{closed:false})}
  pub(crate)fn core_facts(&mut self,_:&ServerCoreOriginals<'_>)->Result<crate::account_instance::ServerCoreFacts,Error>{Ok(crate::account_instance::ServerCoreFacts)}
  pub(crate)fn current(&mut self)->Result<(),Error>{Ok(())}
  pub(crate)fn completed_current(&mut self)->Result<(),Error>{
   let n=crate::COUNT.with(|x|{let n=x.get()+1;x.set(n);n});
   if n==2&&crate::MODE.with(|x|x.get())==2 {Err(Error::Unknown)}else{Ok(())}
  }
  pub(crate)fn enter(&mut self)->Result<(),Error>{Ok(())}
  pub(crate)unsafe fn retire(&mut self,_:&ServerTerminalRaw)->Result<(),Error>{Ok(())}
  pub(crate)fn mark_unknown(&mut self)->Result<(),Error>{crate::MARKS.with(|x|x.set(x.get()+1));Err(Error::Unknown)}
  pub(crate)fn physical_closed(&self)->bool{self.closed}
  pub(crate)fn close(&mut self)->Result<(),Error>{self.closed=true;if crate::MODE.with(|m|m.get())==12{Err(Error::Unknown)}else{Ok(())}}
  pub(crate)fn device_records_transport(&mut self)->Result<Vec<u8>,Error>{
   crate::first_prepared_holder_ffi::server_participant::test_callback();
   let n=crate::GETTERS.with(|x|{let n=x.get()+1;x.set(n);n});
   match crate::MODE.with(|x|x.get()){1=>Err(Error::Required),3=>panic!("controlled cancellation"),4 if n>1=>Ok(b"changed output".to_vec()),_=>Ok(b"actual mock output".to_vec())}
  }
 }
}
mod message_custody_ffi { pub(crate)fn selected_first_server_startup()->Result<usize,i32>{Ok(9)} pub(crate)mod r5_source_policy {pub(crate)mod operations {pub(crate)fn recheck_server_device()->Result<(),i32>{match crate::MODE.with(|m|m.get()){13=>Err(1),14=>Err(8),_=>Ok(())}}}} pub(crate)mod message3_producer{
 pub(crate)struct ServerEngineReadPin{selected:(usize,usize)}
 impl ServerEngineReadPin{
  pub(crate)fn acquire(selected:(usize,usize))->Result<Self,i32>{crate::PINS.with(|p|p.set(p.get()+1));Ok(Self{selected})}
  pub(crate)fn matches(&self,selected:(usize,usize))->bool{self.selected==selected}
  pub(crate)fn close(&mut self)->i32{if crate::MODE.with(|m|m.get())==8{return 8}if crate::MODE.with(|m|m.get())==14{panic!("injected release unwind")}crate::PINS.with(|p|p.set(p.get()-1));0}
 }
 pub(crate)fn same_participant_completed_read_ready()->Result<(usize,usize),i32>{crate::first_prepared_holder_ffi::server_participant::test_preflight()?;Ok(if crate::MODE.with(|m|m.get())==9{(1,11)}else{(1,10)})}
}}
mod first_prepared_holder_ffi {
 use super::*;
 static NEXT:AtomicU64=AtomicU64::new(1);
 fn boundary(f:impl FnOnce()->i32)->i32{std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(16)}
 include!("test_server_completed_r5_module.rs");
}

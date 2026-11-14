 #[cfg(test)]mod worker_pin_tests{
  use super::*;
  fn open()->ServerToken{
   crate::MODE.with(|v|v.set(0));crate::PINS.with(|v|v.set(0));
   let mut t=ServerToken::default();let input=crate::source_infrastructure::platform::ServerInputRaw;
   assert_eq!(unsafe{ynx_source_first_device_server_acquire_v1(&input,&mut t)},0);t
  }
  fn select(t:ServerToken){let mut n=0;assert_eq!(unsafe{ynx_source_first_device_server_copy_device_records_v1(t,std::ptr::null_mut(),0,&mut n)},2);assert_eq!(n,18);}
  fn close(mut t:ServerToken,expected:i32){assert_eq!(unsafe{ynx_source_first_device_server_close_v1(&mut t)},expected);assert!(t==ServerToken::default());}
  #[test]fn release_fences_recapture_and_retains_original(){
   let t=open();select(t);assert_eq!(crate::PINS.with(|p|p.get()),1);
   assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),0);assert_eq!(crate::PINS.with(|p|p.get()),0);
   assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),0);
   let mut n=0;assert_eq!(unsafe{ynx_source_first_device_server_copy_device_records_v1(t,std::ptr::null_mut(),0,&mut n)},16);
   SERVERS.with(|v|{let v=v.borrow();assert_eq!(v[0].device_partial.borrow().as_deref(),Some(b"actual mock output".as_slice()));assert!(v[0].owner.is_some())});close(t,0);
  }
  #[test]fn failed_release_keeps_exact_pin_and_first_cause_on_retry(){
   let t=open();select(t);crate::MODE.with(|m|m.set(8));
   assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),16);
   SERVERS.with(|v|{let v=v.borrow();assert_eq!(v[0].first.get(),8);assert!(v[0].unknown.get());assert!(v[0].engine_pin.borrow().is_some());assert!(v[0].owner.is_some())});
   crate::MODE.with(|m|m.set(0));assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),0);
   assert_eq!(crate::PINS.with(|p|p.get()),0);SERVERS.with(|v|assert_eq!(v.borrow()[0].first.get(),8));close(t,16);
  }
  #[test]fn busy_and_wrong_thread_do_not_release(){
   let t=open();select(t);let lease=CompletedReadLease::acquire(t).unwrap();
   assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),16);assert_eq!(crate::PINS.with(|p|p.get()),1);
   let foreign=std::thread::spawn(move||ynx_source_first_device_server_release_read_pin_v1(t)).join().unwrap();assert_eq!(foreign,22);
   drop(lease);assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),0);close(t,16);
  }
  #[test]fn unwind_during_release_retains_pin_and_latches_unknown(){
   let t=open();select(t);crate::MODE.with(|m|m.set(14));
   assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),16);
   SERVERS.with(|v|{let v=v.borrow();assert_eq!(v[0].first.get(),16);assert!(v[0].unknown.get());assert!(v[0].read_closed.get());assert!(v[0].engine_pin.borrow().is_some());});
   crate::MODE.with(|m|m.set(0));assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),0);close(t,16);
  }
  #[test]fn clean_worker_thread_exits_only_after_pin_and_owner_close(){
   std::thread::spawn(||{let t=open();select(t);assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),0);close(t,0);assert!(SERVERS.with(|v|v.borrow().is_empty()));}).join().unwrap();
  }
  #[test]fn no_pin_still_closes_read_path(){let t=open();assert_eq!(ynx_source_first_device_server_release_read_pin_v1(t),0);let mut n=0;assert_eq!(unsafe{ynx_source_first_device_server_copy_device_records_v1(t,std::ptr::null_mut(),0,&mut n)},16);close(t,0);}
 }

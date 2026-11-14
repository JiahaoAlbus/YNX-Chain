 #[cfg(test)]pub(crate)fn test_preflight()->Result<(),i32>{
  let token=SERVERS.with(|s|s.borrow()[0].token);
  let link=ServerCoreLink{token,facts:crate::account_instance::ServerCoreFacts,first_startup:9};link.completed_read_snapshot()?;
  match crate::MODE.with(|m|m.get()){6=>Err(1),7=>Err(8),_=>Ok(())}
 }
 #[cfg(test)]pub(crate)fn test_callback(){
  let token=SERVERS.with(|s|s.borrow()[0].token);
  let link=ServerCoreLink{token,facts:crate::account_instance::ServerCoreFacts,first_startup:9};
  assert!(link.completed_read_snapshot().is_ok());
  assert_eq!(link.current(),Err(16));
  let mut alias=token;assert_eq!(unsafe{ynx_source_first_device_server_close_v1(&mut alias)},16);assert!(alias==token);
  assert_eq!(ynx_source_first_device_server_enter_v1(token),16);
  if crate::MODE.with(|m|m.get())==10{assert_eq!(ynx_source_first_device_server_unknown_v1(token),16);}
  let foreign=ServerCoreLink{token:ServerToken{kind:SERVER_KIND,serial:token.serial+1},facts:crate::account_instance::ServerCoreFacts,first_startup:9};
  assert!(foreign.completed_read_snapshot().is_err());
 }
 #[cfg(test)]mod completed_read_tests{
  use super::*;
  fn setup(mode:u32)->ServerToken{
   crate::MODE.with(|x|x.set(mode));crate::COUNT.with(|x|x.set(0));crate::MARKS.with(|x|x.set(0));crate::GETTERS.with(|x|x.set(0));crate::PINS.with(|x|x.set(0));
   let mut t=ServerToken::default();let input=crate::source_infrastructure::platform::ServerInputRaw;
   assert_eq!(unsafe{ynx_source_first_device_server_acquire_v1(&input,&mut t)},0);t
  }
  fn run(t:ServerToken,cap:usize)->(i32,usize,Vec<u8>){let mut output=vec![0;cap];let mut size=0;
   let rc=unsafe{ynx_source_first_device_server_copy_device_records_v1(t,output.as_mut_ptr(),cap,&mut size)};(rc,size,output)}
  fn close(mut t:ServerToken){let expected=SERVERS.with(|s|{let s=s.borrow();let slot=s.iter().find(|x|x.token==t).unwrap();if slot.unknown.get()||slot.first.get()!=0{16}else{0}});assert_eq!(unsafe{ynx_source_first_device_server_close_v1(&mut t)},expected);assert!(t==ServerToken::default());}
  #[test]fn reentry_fenced_and_scope_closes(){let t=setup(0);let(rc,n,out)=run(t,64);assert_eq!(rc,0);assert_eq!(&out[..n],b"actual mock output");
   let link=ServerCoreLink{token:t,facts:crate::account_instance::ServerCoreFacts,first_startup:9};assert_eq!(link.completed_read_snapshot(),Err(1));close(t)}
  #[test]fn missing_original_required_preserves_owner(){let t=setup(1);let(rc,n,_)=run(t,64);assert_eq!((rc,n),(1,0));assert_eq!(ynx_source_first_device_server_current_v1(t),0);close(t)}
  #[test]fn late_failure_retains_partial_and_unknown(){let t=setup(2);let(rc,n,_)=run(t,64);assert_eq!((rc,n),(16,0));SERVERS.with(|s|{let slots=s.borrow();let slot=&slots[0];assert!(slot.unknown.get());assert_eq!(slot.device_partial.borrow().as_deref(),Some(b"actual mock output".as_slice()));assert!(!slot.completed_read.get())});assert!(crate::MARKS.with(|x|x.get())>0);close(t)}
  #[test]fn unwind_restores_original_owner_unknown(){let t=setup(3);let(rc,_,_)=run(t,64);assert_eq!(rc,16);SERVERS.with(|s|{let slots=s.borrow();assert!(slots[0].unknown.get()&&slots[0].owner.is_some()&&!slots[0].completed_read.get())});close(t)}
  #[test]fn short_buffer_returns_size_without_poison(){let t=setup(0);let(rc,n,_)=run(t,4);assert_eq!(rc,2);assert_eq!(n,18);SERVERS.with(|s|assert!(!s.borrow()[0].unknown.get()));close(t)}
  #[test]fn zero_then_copy_pins_same_original_even_if_supplier_changes(){let t=setup(4);let mut size=0;
   assert_eq!(unsafe{ynx_source_first_device_server_copy_device_records_v1(t,std::ptr::null_mut(),0,&mut size)},2);assert_eq!(size,18);
   let(rc,n,out)=run(t,64);assert_eq!(rc,0);assert_eq!(&out[..n],b"actual mock output");
   assert_eq!(crate::GETTERS.with(|x|x.get()),1);assert_eq!(crate::PINS.with(|x|x.get()),1);close(t);assert_eq!(crate::PINS.with(|x|x.get()),0)}
  #[test]fn multiple_short_calls_never_select_a_second_original(){let t=setup(4);
   assert_eq!(run(t,1).0,2);assert_eq!(run(t,4).0,2);let(rc,n,out)=run(t,64);
   assert_eq!(rc,0);assert_eq!(&out[..n],b"actual mock output");assert_eq!(crate::GETTERS.with(|x|x.get()),1);assert_eq!(crate::PINS.with(|x|x.get()),1);close(t);assert_eq!(crate::PINS.with(|x|x.get()),0)}
  #[test]fn cancellation_during_registry_borrow_retains_physical_owner(){let t=setup(0);
   let lease=CompletedReadLease::acquire(t).unwrap();SERVERS.with(|s|{let slots=s.borrow_mut();drop(lease);
    assert!(slots[0].unknown.get());assert!(slots[0].owner.is_some());assert!(!slots[0].busy.get());
   });assert_eq!(ynx_source_first_device_server_current_v1(t),16);close(t);
   assert!(crate::MARKS.with(|x|x.get())>0)}
  #[test]fn cancellation_during_owner_borrow_retains_owner_without_foreign_callback(){let t=setup(0);
   let lease=CompletedReadLease::acquire(t).unwrap();let owner=lease.owner.clone();let held=owner.borrow_mut();drop(lease);
   assert_eq!(crate::MARKS.with(|x|x.get()),0);drop(held);close(t);assert!(crate::MARKS.with(|x|x.get())>0)}

  #[test]fn wrong_thread_cannot_use_token(){let t=setup(0);let code=std::thread::spawn(move||ynx_source_first_device_server_current_v1(t)).join().unwrap();assert_eq!(code,22);close(t)}
  #[test]fn invalid_output_alias_does_not_touch_input_or_select(){let t=setup(0);let mut len=42usize;
   let code=unsafe{ynx_source_first_device_server_copy_device_records_v1(t,(&mut len as *mut usize).cast(),std::mem::size_of::<usize>(),&mut len)};
   assert_eq!(code,2);assert_eq!(len,42);assert_eq!(crate::GETTERS.with(|x|x.get()),0);close(t)}
  #[test]fn cancellation_latches_first_cause_before_close(){let t=setup(0);let lease=CompletedReadLease::acquire(t).unwrap();drop(lease);
   SERVERS.with(|s|assert_eq!(s.borrow()[0].first.get(),16));close(t)}

  #[test]fn missing_same_attempt_refuses_before_producer(){let t=setup(6);assert_eq!(run(t,64).0,1);assert_eq!(crate::GETTERS.with(|x|x.get()),0);SERVERS.with(|s|assert!(!s.borrow()[0].unknown.get()));close(t)}
  #[test]fn failed_same_attempt_refuses_and_latches_unknown(){let t=setup(7);assert_eq!(run(t,64).0,16);assert_eq!(crate::GETTERS.with(|x|x.get()),0);SERVERS.with(|s|assert!(s.borrow()[0].unknown.get()));close(t)}

  #[test]fn failed_child_close_keeps_pin_and_participant_for_retry(){let mut t=setup(0);assert_eq!(run(t,0).0,2);crate::MODE.with(|m|m.set(8));
   assert_eq!(unsafe{ynx_source_first_device_server_close_v1(&mut t)},16);assert!(t!=ServerToken::default());assert_eq!(crate::PINS.with(|p|p.get()),1);
   SERVERS.with(|s|{let s=s.borrow();assert!(s[0].unknown.get());assert!(s[0].engine_pin.borrow().is_some());assert!(s[0].owner.is_some())});
   crate::MODE.with(|m|m.set(0));close(t);assert_eq!(crate::PINS.with(|p|p.get()),0)}
  #[test]fn changed_engine_locator_after_size_cannot_select_another_owner(){let t=setup(0);assert_eq!(run(t,0).0,2);crate::MODE.with(|m|m.set(9));assert_eq!(run(t,64).0,16);assert_eq!(crate::GETTERS.with(|p|p.get()),1);close(t)}

  #[test]fn reentrant_unknown_keeps_actual_partial_and_never_reports_success(){let t=setup(10);let(rc,n,_)=run(t,64);assert_eq!((rc,n),(16,0));
   SERVERS.with(|s|{let s=s.borrow();assert!(s[0].unknown.get());assert_eq!(s[0].first.get(),16);assert_eq!(s[0].device_partial.borrow().as_deref(),Some(b"actual mock output".as_slice()))});close(t)}

  #[test]fn physical_close_error_with_cleared_owner_retires_token_and_preserves_failure(){let mut t=setup(0);crate::MODE.with(|m|m.set(12));
   assert_eq!(unsafe{ynx_source_first_device_server_close_v1(&mut t)},16);assert!(t==ServerToken::default());assert!(SERVERS.with(|s|s.borrow().is_empty()));}

 }
#[cfg(test)]mod r5_cached_controls{
 use super::*;
 #[test]fn equal_public_facts_cannot_join_another_token_or_startup(){
  let token=ServerToken{kind:SERVER_KIND,serial:1};let link=ServerCoreLink{token,facts:crate::account_instance::ServerCoreFacts,first_startup:9};
  let mut other=link.clone();assert!(link.same_participant(&other));other.token.serial=2;assert!(!link.same_participant(&other));
  other=link.clone();other.first_startup=10;assert!(!link.same_participant(&other));
 }
 #[test]fn cached_copy_rechecks_r5_and_preserves_partial_on_required(){
  crate::MODE.with(|m|m.set(0));crate::COUNT.with(|c|c.set(0));crate::GETTERS.with(|c|c.set(0));crate::PINS.with(|c|c.set(0));
  let mut token=ServerToken::default();let input=crate::source_infrastructure::platform::ServerInputRaw;assert_eq!(unsafe{ynx_source_first_device_server_acquire_v1(&input,&mut token)},0);
  let mut size=0;assert_eq!(unsafe{ynx_source_first_device_server_copy_device_records_v1(token,std::ptr::null_mut(),0,&mut size)},2);
  crate::MODE.with(|m|m.set(13));let mut output=[0u8;64];assert_eq!(unsafe{ynx_source_first_device_server_copy_device_records_v1(token,output.as_mut_ptr(),output.len(),&mut size)},16);
  assert_eq!(crate::GETTERS.with(|c|c.get()),1);SERVERS.with(|r|{let r=r.borrow();assert!(r[0].unknown.get());assert_eq!(r[0].first.get(),1);assert_eq!(r[0].device_partial.borrow().as_deref(),Some(b"actual mock output".as_slice()))});
  assert_eq!(unsafe{ynx_source_first_device_server_close_v1(&mut token)},16);
 }
}


//! Existing R5 actions over SAME Source-local policy and actual C guard.
//! C calls are outside SDK/Startup mutable borrows. No client Core loan lookup.
use super::*;use crate::source_infrastructure::{SourceError,SourceRole};
use super::super::r5_action_inputs::Action;
unsafe extern "C"{
 fn ynx_native_core_resource_driver_r5_open(policy:*mut c_void,holder:*mut c_void,kind:u32,out:*mut*mut c_void)->i32;
 fn ynx_native_core_resource_driver_r5_enter(guard:*mut c_void)->i32;
 fn ynx_native_core_resource_driver_r5_recover_completed(guard:*mut c_void,out:*mut NativeRecoveryRaw)->i32;
 fn ynx_native_core_resource_driver_r5_current(guard:*mut c_void)->i32;
 fn ynx_native_core_resource_driver_r5_device_records_current(guard:*mut c_void,records:*const c_void)->i32;
 fn ynx_native_core_resource_driver_r5_key_enter(guard:*mut c_void,pq:u32)->i32;
 fn ynx_native_core_resource_driver_r5_key_leave(guard:*mut c_void,status:i32)->i32;
 fn ynx_native_core_resource_driver_r5_retire(guard:*mut c_void,out:*mut u8,capacity:usize,written:*mut usize)->i32;
 fn ynx_native_core_resource_driver_r5_first_cause(guard:*mut c_void)->i32;
 fn ynx_native_core_resource_driver_r5_close(guard:*mut*mut c_void)->i32;
}
const DUPLICATE:i32=9;
fn row<T>(holder:*mut c_void,id:usize,run:impl FnOnce(&mut SourcePolicy)->Result<T,i32>)->Result<T,i32>{
 SDK_CUSTODY.with(|v|{let mut v=v.try_borrow_mut().map_err(|_|UNKNOWN)?;let sdk=v.get_mut(&(holder as usize)).ok_or(1)?;let p=sdk.r5_source_policies.get_mut(&id).ok_or(1)?;if p.startup!=sdk.startup{return Err(MISMATCH)}run(p)})
}
fn status(code:i32)->Result<(),i32>{if code==OK{Ok(())}else{Err(code)}}
fn unknown(holder:*mut c_void,id:usize,cause:i32)->i32{
 let _=row(holder,id,|p|{if p.operation.first==OK{p.operation.first=if cause==OK{UNKNOWN}else{cause}}p.operation.unknown=true;p.operation.phase=8;p.operation.busy=false;Ok(())});if cause==OK{UNKNOWN}else{cause}
}
// First-cause is PURE LOCAL on this same live C guard. Never call under
// the key fence or after close; never use diagnostics as authorization.
fn guard_failure(holder:*mut c_void,id:usize,guard:usize,code:i32)->i32{
 let first=unsafe{ynx_native_core_resource_driver_r5_first_cause(guard as*mut c_void)};
 unknown(holder,id,if first==OK{code}else{first});
 if code==OK{UNKNOWN}else{code}
}
fn guard_current(holder:*mut c_void,id:usize,guard:usize)->Result<(),i32>{
 let code=unsafe{ynx_native_core_resource_driver_r5_current(guard as*mut c_void)};
 if code==OK{Ok(())}else{Err(guard_failure(holder,id,guard,code))}
}
// Called only by the exact participant's scoped completed read. The caller
// owns the EngineAttempt pin; no pre-retirement ServerCoreLink current is
// re-entered while that participant is mutably borrowed by the C getter.
#[cfg(all(unix,not(target_os="android")))]
struct ServerOriginalRead{holder:*mut c_void,id:usize,finished:bool}
#[cfg(all(unix,not(target_os="android")))]
impl Drop for ServerOriginalRead{fn drop(&mut self){if !self.finished{unknown(self.holder,self.id,UNKNOWN);}}}
#[cfg(all(unix,not(target_os="android")))]
fn server_read_failure(holder:*mut c_void,id:usize,cause:i32)->i32{
 unknown(holder,id,cause);
 // Preserve the underlying first cause for the parent C owner. REQUIRED after
 // a selected/partial read remains UNKNOWN at the ABI, while its exact first
 // cause stays on this same retained R5 operation.
 let first=row(holder,id,|p|Ok(p.operation.first)).unwrap_or(UNKNOWN);
 if first==OK||first==1{UNKNOWN}else{first}
}
#[cfg(all(unix,not(target_os="android")))]
pub(super)fn read_server_original(holder:usize,id:usize)->Result<Vec<u8>,i32>{
 let ptr=holder as *mut c_void;
 let selected=row(ptr,id,|p|{
  if p.unknown||p.operation.unknown{return Err(if p.operation.first!=OK{p.operation.first}else{UNKNOWN})}
  if p.operation.busy{return Err(6)}
  if p.operation.guard==0||!(p.operation.phase==5||p.operation.recovery_complete)||
   p.operation.application.is_empty()||p.operation.application!=p.operation.completion{return Err(1)}
  let plan=super::application_receipt::actual_read_plan(&p.inputs,&p.matched,&p.operation.classic,&p.operation.pq,&p.operation.application)?;
  p.operation.busy=true;
  Ok((p.startup,p.kind,p.inputs.body.clone(),p.operation.guard,plan,p.operation.original_envelope.clone()))
 });
 let(startup,kind,body,guard,plan,cached)=match selected{Ok(value)=>value,Err(1)=>return Err(1),Err(cause)=>return Err(server_read_failure(ptr,id,cause))};
 let mut attempt=ServerOriginalRead{holder:ptr,id,finished:false};
 let result=(||{
  guard_current(ptr,id,guard)?;
  let bytes=if cached.is_empty(){
   let(bytes,read)=super::application_receipt::read_selected(plan,&cached);
   // Adopt all bytes, including a short or late-failed read, before status.
   row(ptr,id,|p|{if !p.operation.original_envelope.is_empty(){return Err(UNKNOWN)}p.operation.original_envelope=bytes.clone();Ok(())})?;
   if let Err(cause)=read{if cause==1&&bytes.is_empty(){return Err(1)}return Err(server_read_failure(ptr,id,cause))}bytes
  }else{super::application_receipt::read_selected(plan,&cached).0};
  STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let source=s.get_mut(&startup).ok_or(UNKNOWN)?;
   if SELECTED_STARTUP.with(|v|v.get())!=Some(startup)||!source.sdk_held{return Err(MISMATCH)}
   selected_current(source)?;
   let signed=source.source.verify_r5_accepted_original(kind,&bytes).map_err(evidence_status)?;
   if signed!=body{return Err(MISMATCH)}selected_current(source)
  })?;
  guard_current(ptr,id,guard)?;
  Ok(bytes)
 })();
 row(ptr,id,|p|{p.operation.busy=false;Ok(())})?;attempt.finished=true;
 match result{Ok(bytes)=>Ok(bytes),Err(1)=>{
  let ambiguous=row(ptr,id,|p|Ok(p.operation.unknown||!p.operation.original_envelope.is_empty())).unwrap_or(true);
  if ambiguous{Err(server_read_failure(ptr,id,1))}else{Err(1)}
 },Err(cause)=>Err(server_read_failure(ptr,id,cause))}
}

#[cfg(all(unix,not(target_os="android")))]
#[repr(C)]struct ServerDeviceRaw{version:u32,final_raw:NativeOriginalSpan,current:NativeOriginalSpan,terminal:NativeOriginalSpan,checkpoint:NativeOriginalSpan,predecessors:*const NativeOriginalSpan,predecessor_count:usize}
#[cfg(all(unix,not(target_os="android")))]
#[repr(C)]struct PhysicalRecordRaw{once_id:[u8;32],body:NativeOriginalSpan,frame:NativeOriginalSpan,parts:NativeOriginalSpan}
#[cfg(all(unix,not(target_os="android")))]
#[repr(C)]struct PhysicalRecordsRaw{version:u32,size:u32,current_sequence:u64,records:[PhysicalRecordRaw;4],final_original:NativeOriginalSpan,checkpoint_original:NativeOriginalSpan,revocation_checkpoint_digest:[u8;32]}
#[cfg(all(unix,not(target_os="android"),target_pointer_width="64"))]
const _:[();88]=[();std::mem::size_of::<ServerDeviceRaw>()];
#[cfg(all(unix,not(target_os="android"),target_pointer_width="64"))]
const _:[();400]=[();std::mem::size_of::<PhysicalRecordsRaw>()];
#[cfg(all(unix,not(target_os="android")))]
fn physical_records_current(holder:usize,id:usize,guard:usize,p:&crate::message_evidence::prekey_server_physical_records::PhysicalRecords)->Result<(),i32>{
 let span=|v:&[u8]|NativeOriginalSpan{data:v.as_ptr(),size:v.len()};
 let raw=PhysicalRecordsRaw{version:1,size:std::mem::size_of::<PhysicalRecordsRaw>()as u32,current_sequence:p.current_sequence,
  records:std::array::from_fn(|i|PhysicalRecordRaw{once_id:p.records[i].once_id,body:span(&p.records[i].body),frame:span(&p.records[i].frame),parts:span(&p.records[i].parts)}),
  final_original:span(&p.final_original),checkpoint_original:span(&p.checkpoint_original),revocation_checkpoint_digest:p.revocation_checkpoint_digest};
 let code=unsafe{ynx_native_core_resource_driver_r5_device_records_current(guard as *mut c_void,(&raw as *const PhysicalRecordsRaw).cast())};
 if code==OK{Ok(())}else{Err(guard_failure(holder as *mut c_void,id,guard,code))}
}
#[cfg(all(unix,not(target_os="android")))]
pub(crate)fn recheck_server_device()->Result<(),i32>{
 let(holder,_)=super::super::message3_producer::same_participant_completed_read_ready()?;
 let parent=SDK_CUSTODY.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;r.get(&holder).and_then(|sdk|sdk.first_server_parent).map(|v|v.0).ok_or(1)})?;
 let empty=||NativeOriginalSpan{data:std::ptr::null(),size:0};
 let mut raw=ServerDeviceRaw{version:0,final_raw:empty(),current:empty(),terminal:empty(),checkpoint:empty(),predecessors:std::ptr::null(),predecessor_count:0};
 let code=unsafe{ynx_sdk_first_server_device_originals_v1(parent as *mut c_void,&mut raw)};
 if code!=OK{return Err(code)}if raw.version!=1{return Err(UNKNOWN)}Ok(())
}
#[cfg(all(unix,not(target_os="android")))]
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_first_server_device_originals_v1(parent:*mut c_void,out:*mut ServerDeviceRaw)->i32{
 let result=catch_unwind(AssertUnwindSafe(||->Result<(),i32>{
  if parent.is_null()||out.is_null()||(out as usize)%std::mem::align_of::<ServerDeviceRaw>()!=0{return Err(BOUND)}
  let output=region(out.cast(),std::mem::size_of::<ServerDeviceRaw>()).ok_or(BOUND)?;
  let(holder,engine)=super::super::message3_producer::same_participant_completed_read_ready()?;
  SDK_CUSTODY.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let sdk=r.get(&holder).ok_or(1)?;
   if !disjoint(output,region((sdk.as_ref()as *const NativeCustodyOwner).cast(),std::mem::size_of::<NativeCustodyOwner>()).ok_or(BOUND)?){return Err(BOUND)}
   if sdk.first_server_parent.map(|v|v.0)!=Some(parent as usize){return Err(MISMATCH)}
   for p in sdk.r5_source_policies.values(){separate_policy(p,output)?;
    for v in [&p.operation.classic,&p.operation.pq,&p.operation.application,&p.operation.completion,&p.operation.original_envelope]{if !v.is_empty()&&!disjoint(output,region(v.as_ptr(),v.len()).ok_or(BOUND)?){return Err(BOUND)}}}
   Ok(())})?;
  if super::super::selected_first_server_startup()?!=parent as usize{return Err(MISMATCH)}
  super::super::FIRST_SERVER_STARTUPS.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let actual=r.get(&(parent as usize)).ok_or(UNKNOWN)?;
   if actual.unknown{return Err(if actual.first==OK{UNKNOWN}else{actual.first})}if actual.child!=Some(holder){return Err(MISMATCH)}Ok(())})?;
  let(facts,target)=super::super::message3_producer::server_device_engine_identity(holder,engine)?;
  // Select a final role only if its original operation and independent engine
  // records match the actual retained EngineAttempt, not caller-supplied IDs.
  let candidates=SDK_CUSTODY.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let sdk=r.get(&holder).ok_or(1)?;
   let mut candidates=Vec::new();for(id,p)in &sdk.r5_source_policies{
    if p.kind!=1||p.matched.account!=facts.account||p.matched.device!=facts.device||p.matched.device_public_digest!=target{continue}
    let get=|name:&str|p.inputs.originals.get(name).cloned().ok_or(BOUND);
    candidates.push((*id,get("firstDeviceOperation")?,get("independentTerminal")?,get("checkpoint")?,get("nativeCompletedFinal")?));
   }Ok::<_,i32>(candidates)})?;
  let mut selected=None;
  for(id,operation,terminal,checkpoint,completed)in candidates{
   match super::super::message3_producer::server_device_engine_match(holder,engine,&operation,&terminal,&checkpoint,&completed){
    Ok(())=>{if selected.is_some(){return Err(MISMATCH)}selected=Some((id,terminal,checkpoint))},
    Err(MISMATCH)=>{},Err(e)=>return Err(e),
   }
  }
  let(first,terminal,checkpoint)=selected.ok_or(1)?;
  let(first_body,first_originals,first_digest,startup)=row(holder as *mut c_void,first,|p|Ok((p.inputs.body.clone(),p.inputs.originals.clone(),p.matched.first_device_operation_digest.clone(),p.startup)))?;
  let find_role=|kind:u32,final_raw:Option<&[u8]>|->Result<usize,i32>{
   SDK_CUSTODY.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let sdk=r.get(&holder).ok_or(1)?;let mut found=None;
    for(id,p)in &sdk.r5_source_policies{
     if p.kind!=kind||p.startup!=startup||p.matched.account!=facts.account||p.matched.device!=facts.device||
      p.matched.device_public_digest!=target||p.matched.first_device_operation_digest!=first_digest{continue}
     if kind==2&&(p.inputs.body!=first_body||p.inputs.originals!=first_originals){continue}
     if let Some(final_raw)=final_raw{if p.inputs.originals.get("finalOriginal").map(Vec::as_slice)!=Some(final_raw){continue}}
     if found.replace(*id).is_some(){return Err(MISMATCH)}
    }found.ok_or(1)
   })
  };
  let second=find_role(2,None)?;
  let issuer=read_server_original(holder,first)?;let anchor=read_server_original(holder,second)?;
  let final_raw=crate::message_evidence::EngineCommitCompanions::encode(&issuer,&anchor).map_err(|_|MISMATCH)?;
  let third=find_role(3,Some(&final_raw))?;let fourth=find_role(4,Some(&final_raw))?;
  let(current_body,current_originals,predecessors)=row(holder as *mut c_void,third,|p|Ok((p.inputs.body.clone(),p.inputs.originals.clone(),p.inputs.predecessors.clone())))?;
  row(holder as *mut c_void,fourth,|p|{if p.inputs.body!=current_body||p.inputs.originals!=current_originals||p.inputs.predecessors!=predecessors{return Err(MISMATCH)}Ok(())})?;
  let current_issuer=read_server_original(holder,third)?;let current_anchor=read_server_original(holder,fourth)?;
  let current=crate::message_evidence::EngineCommitCompanions::encode(&current_issuer,&current_anchor).map_err(|_|MISMATCH)?;
  // Repeat the actual native linkage and signatures while the selected
  // Source is held; this includes current history and the 30-second window.
  let inputs=SDK_CUSTODY.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let sdk=r.get(&holder).ok_or(1)?;
   [first,second,third,fourth].into_iter().map(|id|sdk.r5_source_policies.get(&id).map(|p|(copied(&p.inputs),p.matched.once_id)).ok_or(1)).collect::<Result<Vec<_>,i32>>()})?;
  let verified=STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let h=s.get_mut(&startup).ok_or(UNKNOWN)?;
   selected_current(h)?;for(input,once)in &inputs{let m=crate::message_evidence::r5_device_originals::match_originals(&h.source,input.kind,&input.body,&input.originals,&input.predecessors).map_err(evidence_status)?;
    if m.once_id!=*once||m.account!=facts.account||m.device!=facts.device||m.device_public_digest!=target||m.revoked{return Err(MISMATCH)}}
   let history:Vec<&[u8]>=predecessors.iter().map(Vec::as_slice).collect();
   let transport=crate::message_evidence::OriginalDeviceRecords::canonical_transport(&final_raw,&current,&history,&terminal,&checkpoint).map_err(evidence_status)?;
   let records=crate::message_evidence::OriginalDeviceRecords::parse(&transport).map_err(evidence_status)?;
   let physical=records.physical_records(&h.source).map_err(evidence_status)?;
   selected_current(h)?;Ok(physical)
  });
  let physical=match verified{Ok(value)=>value,Err(cause)=>return Err(server_read_failure(holder as *mut c_void,first,cause))};
  for id in [first,second,third,fourth]{let guard=row(holder as *mut c_void,id,|p|Ok(p.operation.guard))?;guard_current(holder as *mut c_void,id,guard)?;}
  let first_guard=row(holder as *mut c_void,first,|p|Ok(p.operation.guard))?;
  physical_records_current(holder,first,first_guard,&physical)?;
  super::super::message3_producer::server_device_engine_identity(holder,engine)?;
  row(holder as *mut c_void,first,|p|{
   if let Some(held)=p.server_device.as_ref(){if held.final_raw!=final_raw||held.current!=current||held.terminal!=terminal||held.checkpoint!=checkpoint||held.predecessors!=predecessors{return Err(MISMATCH)}}
   if p.server_device.is_none(){let mut held=Box::new(ServerDeviceOriginals{final_raw,current,terminal,checkpoint,predecessors,prefix_spans:Vec::new()});
    held.prefix_spans=held.predecessors.iter().map(|v|NativeOriginalSpan{data:v.as_ptr(),size:v.len()}).collect();p.server_device=Some(held)}
   let held=p.server_device.as_ref().ok_or(UNKNOWN)?;let span=|v:&Vec<u8>|NativeOriginalSpan{data:v.as_ptr(),size:v.len()};
   if !disjoint(output,region((held.as_ref()as *const ServerDeviceOriginals).cast(),std::mem::size_of::<ServerDeviceOriginals>()).ok_or(BOUND)?){return Err(BOUND)}
   for v in [&held.final_raw,&held.current,&held.terminal,&held.checkpoint].into_iter().chain(held.predecessors.iter()){
    if !v.is_empty()&&!disjoint(output,region(v.as_ptr(),v.len()).ok_or(BOUND)?){return Err(BOUND)}
   }
   if !held.prefix_spans.is_empty()&&!disjoint(output,region(held.prefix_spans.as_ptr().cast(),held.prefix_spans.len().checked_mul(std::mem::size_of::<NativeOriginalSpan>()).ok_or(BOUND)?).ok_or(BOUND)?){return Err(BOUND)}
   let raw=ServerDeviceRaw{version:1,final_raw:span(&held.final_raw),current:span(&held.current),terminal:span(&held.terminal),checkpoint:span(&held.checkpoint),predecessors:if held.prefix_spans.is_empty(){std::ptr::null()}else{held.prefix_spans.as_ptr()},predecessor_count:held.prefix_spans.len()};
   unsafe{std::ptr::write(out,raw)};Ok(())
  })?;
  // The published DATA remains retained if this final same-guard check fails.
  physical_records_current(holder,first,first_guard,&physical)
 }));match result{Ok(Ok(()))=>OK,Ok(Err(e))=>e,Err(_)=>UNKNOWN}
}
fn source_current(holder:*mut c_void,id:usize)->Result<(),i32>{
 // A server child has no independent identity: direct R5 entry points must
 // fence the same physical participant just like the general SDK dispatcher.
 #[cfg(feature="source-server-collector")]
 if let Err(cause)=super::super::first_server_sdk_child_current(holder as usize){
  unknown(holder,id,cause);return Err(UNKNOWN)
 }
 let startup=row(holder,id,|p|{if p.unknown||p.operation.unknown{return Err(UNKNOWN)}Ok(p.startup)})?;
 STARTUP_EVIDENCE.with(|v|{let mut v=v.try_borrow_mut().map_err(|_|UNKNOWN)?;let h=v.get_mut(&startup).ok_or(UNKNOWN)?;if !h.sdk_held||SELECTED_STARTUP.with(|s|s.get())!=Some(startup){return Err(UNKNOWN)}selected_current(h)})?;
 SDK_CUSTODY.with(|v|{let v=v.try_borrow().map_err(|_|UNKNOWN)?;let sdk=v.get(&(holder as usize)).ok_or(1)?;let p=sdk.r5_source_policies.get(&id).ok_or(1)?;if sdk.unknown||p.unknown||p.operation.unknown||p.startup!=startup{return Err(UNKNOWN)}Ok(())})
}
fn locate(holder:*mut c_void,once:&[u8;32],kind:Option<u32>)->Result<usize,i32>{
 SDK_CUSTODY.with(|v|{let v=v.try_borrow().map_err(|_|UNKNOWN)?;let sdk=v.get(&(holder as usize)).ok_or(1)?;if sdk.unknown{return Err(UNKNOWN)}let mut found=None;for(id,p)in &sdk.r5_source_policies{if &p.matched.once_id==once&&kind.is_none_or(|kind|p.kind==kind){if found.is_some(){return Err(MISMATCH)}found=Some(*id)}}found.ok_or(1)})
}
pub(crate)fn check_inputs(holder:*mut c_void,inputs:&CopiedR5Inputs)->Result<(),i32>{
 let id=SDK_CUSTODY.with(|v|{let mut v=v.try_borrow_mut().map_err(|_|UNKNOWN)?;let sdk=v.get_mut(&(holder as usize)).ok_or(1)?;if sdk.unknown{return Err(UNKNOWN)}
  STARTUP_EVIDENCE.with(|s|{let mut s=s.try_borrow_mut().map_err(|_|UNKNOWN)?;let h=s.get_mut(&sdk.startup).ok_or(UNKNOWN)?;if !h.sdk_held||SELECTED_STARTUP.with(|s|s.get())!=Some(sdk.startup){return Err(UNKNOWN)}selected_current(h)?;
   h.source.match_r5_original_credentials(inputs.originals.get("issuerCredential").ok_or(BOUND)?,inputs.originals.get("anchorCredential").ok_or(BOUND)?,inputs.bootstrap.as_deref()).map_err(evidence_status)?;
   let matched=crate::message_evidence::r5_device_originals::match_originals(&h.source,inputs.kind,&inputs.body,&inputs.originals,&inputs.predecessors).map_err(evidence_status)?;
   selected_current(h)?;prepare(sdk,h,inputs,matched)
  })
 })?;
 source_current(holder,id)?;
 let existing=row(holder,id,|p|{if p.operation.busy{return Err(6)}if p.operation.unknown{return Err(UNKNOWN)}Ok(p.operation.guard)})?;
 if existing!=0{return guard_current(holder,id,existing)}
 let mut guard=std::ptr::null_mut();let code=unsafe{ynx_native_core_resource_driver_r5_open(id as*mut c_void,holder,inputs.kind,&mut guard)};
 // Adopt a real partial before inspecting code. Never replace it by reacquiring.
 row(holder,id,|p|{if p.operation.guard!=0{return Err(UNKNOWN)}if !guard.is_null(){p.operation.guard=guard as usize;p.foreign_guard=guard as usize}Ok(())})?;
 if code!=OK{return Err(if guard.is_null(){code}else{guard_failure(holder,id,guard as usize,code)})}
 if guard.is_null(){return Err(unknown(holder,id,UNKNOWN))}
 source_current(holder,id).map_err(|e|unknown(holder,id,e))
}
struct RecoveryAttempt{holder:*mut c_void,id:usize,complete:bool}
impl Drop for RecoveryAttempt{fn drop(&mut self){if !self.complete{unknown(self.holder,self.id,UNKNOWN);}}}
#[repr(C)]struct NativeRecoveryRaw{version:u32,size:u32,kind:u32,reserved:u32,once_id:[u8;32],parts:NativeOriginalSpan,receipt:NativeOriginalSpan}
#[repr(C)]pub(crate)struct NativeRecoveryOutput{version:u32,size:u32,kind:u32,reserved:u32,once_id:[u8;32],classic:NativeOriginalSpan,pq:NativeOriginalSpan,receipt:NativeOriginalSpan}
const _:[();80]=[();std::mem::size_of::<NativeRecoveryRaw>()];
const _:[();96]=[();std::mem::size_of::<NativeRecoveryOutput>()];
/* This private same-holder read uses a policy already checked by check_inputs.
 * Every span is DATA, borrowed until holder close, not permission or finality.
 * The original owner retains bytes before any late status is inspected. */
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_native_r5_recover_completed_v1(holder:*mut c_void,once:*const u8,kind:u32,out:*mut NativeRecoveryOutput)->i32{
 let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||->Result<i32,i32>{
  if holder.is_null()||once.is_null()||!(1..=4).contains(&kind){return Err(BOUND)}
  let output=output(out)?;let original=region(once,32).ok_or(BOUND)?;if !disjoint(output,original){return Err(BOUND)}
  let mut selected=[0u8;32];unsafe{std::ptr::copy_nonoverlapping(once,selected.as_mut_ptr(),32)};
  let id=locate(holder,&selected,Some(kind))?;
  SDK_CUSTODY.with(|rows|{let rows=rows.try_borrow().map_err(|_|UNKNOWN)?;let sdk=rows.get(&(holder as usize)).ok_or(1)?;
   if !disjoint(region((sdk.as_ref()as*const NativeCustodyOwner).cast(),std::mem::size_of::<NativeCustodyOwner>()).ok_or(BOUND)?,output){return Err(BOUND)}
   let p=sdk.r5_source_policies.get(&id).ok_or(1)?;separate_policy(p,output)?;
   for raw in [&p.operation.classic,&p.operation.pq,&p.operation.application,&p.operation.completion]{if !raw.is_empty()&&!disjoint(region(raw.as_ptr(),raw.len()).ok_or(BOUND)?,output){return Err(BOUND)}}Ok(())})?;
  source_current(holder,id)?;
  let guard=row(holder,id,|p|{if p.unknown||p.operation.unknown{return Err(UNKNOWN)}if p.operation.busy{return Err(6)}
   if p.operation.recovery_selected||p.operation.phase!=1{return Err(DUPLICATE)}if p.operation.guard==0{return Err(1)}
   p.operation.recovery_selected=true;p.operation.busy=true;Ok(p.operation.guard)})?;
  let mut attempt=RecoveryAttempt{holder,id,complete:false};
  let empty=NativeOriginalSpan{data:std::ptr::null(),size:0};
  let mut raw=NativeRecoveryRaw{version:0,size:0,kind:0,reserved:0,once_id:[0;32],parts:empty,receipt:NativeOriginalSpan{data:std::ptr::null(),size:0}};
  let code=unsafe{ynx_native_core_resource_driver_r5_recover_completed(guard as*mut c_void,&mut raw)};
  let present=raw.version!=0;
  if present{
   if raw.version!=1||raw.size as usize!=std::mem::size_of::<NativeRecoveryRaw>()||raw.kind!=kind||raw.reserved!=0||raw.once_id!=selected||raw.parts.size!=4691||raw.receipt.size==0||raw.receipt.size>65536||region(raw.parts.data,raw.parts.size).is_none()||region(raw.receipt.data,raw.receipt.size).is_none(){return Err(guard_failure(holder,id,guard,UNKNOWN))}
   let parts=unsafe{std::slice::from_raw_parts(raw.parts.data,raw.parts.size)}.to_vec();let receipt=unsafe{std::slice::from_raw_parts(raw.receipt.data,raw.receipt.size)}.to_vec();
   row(holder,id,|p|{p.operation.classic=parts[..64].to_vec();p.operation.pq=parts[64..].to_vec();p.operation.application=receipt.clone();p.operation.completion=receipt;Ok(())})?;
   /* Publish only owned actual bytes; output is DATA even if a late check fails. */
   row(holder,id,|p|{let span=|v:&Vec<u8>|NativeOriginalSpan{data:v.as_ptr(),size:v.len()};let value=NativeRecoveryOutput{version:1,size:std::mem::size_of::<NativeRecoveryOutput>()as u32,kind,reserved:0,once_id:selected,classic:span(&p.operation.classic),pq:span(&p.operation.pq),receipt:span(&p.operation.application)};unsafe{std::ptr::write(out,value)};Ok(())})?;
  }
  if code!=OK{return Err(guard_failure(holder,id,guard,code))}
  if !present{return Err(guard_failure(holder,id,guard,UNKNOWN))}
  let verified=row(holder,id,|p|super::application_receipt::verify(&p.inputs,&p.matched,&p.operation.classic,&p.operation.pq,&p.operation.application));
  if let Err(e)=verified{return Err(guard_failure(holder,id,guard,e))}
  row(holder,id,|p|{p.operation.busy=false;p.operation.recovery_complete=true;Ok(())})?;
  source_current(holder,id).map_err(|e|unknown(holder,id,e))?;guard_current(holder,id,guard)?;attempt.complete=true;Ok(OK)
 }));match result{Ok(Ok(code))=>code,Ok(Err(code))=>code,Err(_)=>UNKNOWN}
}
fn entered(holder:*mut c_void,id:usize,expected:u32)->Result<usize,i32>{
 row(holder,id,|p|{if p.unknown||p.operation.unknown{return Err(UNKNOWN)}if p.operation.busy{return Err(6)}if p.operation.recovery_selected{return Err(DUPLICATE)}if p.operation.phase!=expected{return Err(DUPLICATE)}if p.operation.guard==0{return Err(1)}Ok(p.operation.guard)})
}
fn enter(holder:*mut c_void,id:usize,body:&[u8])->Result<(),i32>{
 let guard=entered(holder,id,1)?;
 row(holder,id,|p|{if p.inputs.body!=body{return Err(MISMATCH)}Ok(())})?;
 source_current(holder,id)?;guard_current(holder,id,guard)?;
 row(holder,id,|p|{p.operation.busy=true;Ok(())})?;
 let code=unsafe{ynx_native_core_resource_driver_r5_enter(guard as*mut c_void)};
 if code!=OK{return Err(guard_failure(holder,id,guard,code))}
 row(holder,id,|p|{p.operation.phase=2;p.operation.busy=false;Ok(())})?;
 source_current(holder,id).map_err(|e|unknown(holder,id,e))
}
pub(crate)struct KeyGuard{holder:*mut c_void,id:usize,guard:usize,kind:u32,frame:Vec<u8>,pq:bool,claimed:bool,finished:bool}
impl KeyGuard{
 pub(crate)fn claim(&mut self,role:SourceRole)->Result<(&[u8],bool),SourceError>{
  if self.claimed||self.finished||!matches!((self.kind,role),(1|3,SourceRole::Issuer)|(2|4,SourceRole::Anchor)){return Err(SourceError::Pair)}
  self.claimed=true;Ok((&self.frame,self.pq))
 }
 fn finish(mut self,bytes:Vec<u8>,actual:i32)->Result<Vec<u8>,i32>{
  let expected=if self.pq{4627}else{64};let actual=if actual==OK&&(!self.claimed||bytes.len()!=expected){MISMATCH}else{actual};
  let returned=bytes.clone();
  row(self.holder,self.id,|p|{if self.pq{p.operation.pq=bytes}else{p.operation.classic=bytes}if actual!=OK{p.operation.unknown=true;p.operation.phase=8}else{p.operation.phase=if self.pq{4}else{3}}Ok(())})?;
  let leave=unsafe{ynx_native_core_resource_driver_r5_key_leave(self.guard as*mut c_void,actual)};self.finished=true;
  row(self.holder,self.id,|p|{p.operation.busy=false;Ok(())})?;
  if actual!=OK{return Err(guard_failure(self.holder,self.id,self.guard,actual))}if leave!=OK{return Err(guard_failure(self.holder,self.id,self.guard,leave))}
  source_current(self.holder,self.id).map_err(|e|unknown(self.holder,self.id,e))?;
  guard_current(self.holder,self.id,self.guard)?;
  Ok(returned)
 }
}
impl Drop for KeyGuard{fn drop(&mut self){if !self.finished{
 let _=row(self.holder,self.id,|p|{p.operation.unknown=true;p.operation.phase=8;Ok(())});
 let code=unsafe{ynx_native_core_resource_driver_r5_key_leave(self.guard as*mut c_void,UNKNOWN)};self.finished=true;
 guard_failure(self.holder,self.id,self.guard,if code==OK{UNKNOWN}else{code});
}}}
fn sign(holder:*mut c_void,id:usize,kind:u32,frame:Vec<u8>,pq:bool)->Result<Vec<u8>,i32>{
 let guard=entered(holder,id,if pq{3}else{2})?;
 let startup=row(holder,id,|p|{if p.kind!=kind||p.matched.frame!=frame{return Err(MISMATCH)}Ok(p.startup)})?;
 source_current(holder,id)?;guard_current(holder,id,guard)?;
 row(holder,id,|p|{p.operation.busy=true;Ok(())})?;
 let key=unsafe{ynx_native_core_resource_driver_r5_key_enter(guard as*mut c_void,u32::from(pq))};
 if key!=OK{let _=row(holder,id,|p|{p.operation.unknown=true;p.operation.phase=8;Ok(())});unsafe{ynx_native_core_resource_driver_r5_key_leave(guard as*mut c_void,key);}return Err(guard_failure(holder,id,guard,key))}
 let mut keyguard=KeyGuard{holder,id,guard,kind,frame,pq,claimed:false,finished:false};
 let signed=STARTUP_EVIDENCE.with(|v|{let mut v=v.try_borrow_mut().map_err(|_|UNKNOWN)?;let h=v.get_mut(&startup).ok_or(UNKNOWN)?;
  let role=if matches!(kind,1|3){0}else{1};let pair=h.pairs[role].as_mut().ok_or(1)?;Ok::<_,i32>(pair.sign_r5_guard(&mut keyguard))
 });
 let(bytes,code)=match signed{Ok((bytes,result))=>(bytes,result.err().map(custody_status).unwrap_or(OK)),Err(code)=>(Vec::new(),code)};
 keyguard.finish(bytes,code)
}
fn retire(holder:*mut c_void,id:usize,receipt:Vec<u8>)->Result<(),i32>{
 let guard=entered(holder,id,4)?;
 row(holder,id,|p|{super::application_receipt::verify(&p.inputs,&p.matched,&p.operation.classic,&p.operation.pq,&receipt)?;Ok(())})?;
 source_current(holder,id)?;guard_current(holder,id,guard)?;
 row(holder,id,|p|{p.operation.application=receipt.clone();p.operation.busy=true;Ok(())})?;
 let mut readback=vec![0u8;65536];let mut written=0;let code=unsafe{ynx_native_core_resource_driver_r5_retire(guard as*mut c_void,readback.as_mut_ptr(),readback.len(),&mut written)};
 let bounded=written<=readback.len();if bounded{readback.truncate(written)}
 // Actual partial readback belongs to the original guard even on a late refusal.
 row(holder,id,|p|{p.operation.completion=readback;p.operation.busy=false;Ok(())})?;
 if !bounded{return Err(guard_failure(holder,id,guard,UNKNOWN))}if code!=OK{return Err(guard_failure(holder,id,guard,code))}
 row(holder,id,|p|{if p.operation.completion!=receipt{return Err(MISMATCH)}p.operation.phase=5;Ok(())}).map_err(|e|unknown(holder,id,e))?;
 source_current(holder,id).map_err(|e|unknown(holder,id,e))?;
 guard_current(holder,id,guard)
}
pub(crate)fn dispatch(holder:*mut c_void,action:Action)->Result<Option<Vec<u8>>,i32>{
 match action{
  Action::Enter{id,kind,body}=>{let policy=locate(holder,&id,Some(kind))?;enter(holder,policy,&body)?;Ok(None)},
  Action::Sign{id,kind,frame,pq}=>{let policy=locate(holder,&id,Some(kind))?;Ok(Some(sign(holder,policy,kind,frame,pq)?))},
  Action::Retire{id,receipt}=>{let policy=locate(holder,&id,None)?;retire(holder,policy,receipt)?;Ok(None)},
 }
}
pub(crate)fn drain(holder:*mut c_void)->Result<(),i32>{
 let ids=SDK_CUSTODY.with(|v|{let v=v.try_borrow().map_err(|_|UNKNOWN)?;let sdk=v.get(&(holder as usize)).ok_or(1)?;Ok::<_,i32>(sdk.r5_source_policies.keys().copied().collect::<Vec<_>>())})?;
 let mut first_status=OK;
 for id in ids{
  // One busy/uncertain child must not leak other independent children.
  // Do not touch or retry the busy guard; preserve the first close result.
  let original=match row(holder,id,|p|{if p.operation.busy{return Err(6)}Ok(p.operation.guard)}){Ok(v)=>v,Err(code)=>{if first_status==OK{first_status=code}continue}};if original==0{continue}
  // Capture before possible disposal. A still-live original may expose a
  // later close failure; a cleared/replaced pointer is never dereferenced.
  let before=unsafe{ynx_native_core_resource_driver_r5_first_cause(original as*mut c_void)};
  let mut same=original as*mut c_void;let code=unsafe{ynx_native_core_resource_driver_r5_close(&mut same)};
  let after=if same as usize==original{unsafe{ynx_native_core_resource_driver_r5_first_cause(original as*mut c_void)}}else{OK};
  let first=if before!=OK{before}else{after};
  let adopted=row(holder,id,|p|{if p.operation.guard!=original{return Err(UNKNOWN)}if same.is_null(){p.operation.guard=0;p.foreign_guard=0}if p.operation.first==OK&&first!=OK{p.operation.first=first}if code!=OK||!same.is_null(){p.operation.unknown=true;p.operation.phase=8;p.operation.busy=false;if p.operation.first==OK{p.operation.first=if code==OK{UNKNOWN}else{code}}}Ok(())});
  if let Err(cause)=adopted{if first_status==OK{first_status=cause}continue}
  let result=if code!=OK{code}else if !same.is_null(){UNKNOWN}else{OK};
  if first_status==OK&&result!=OK{first_status=result}
 }status(first_status)
}

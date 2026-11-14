//! SAME selected Source metadata and parent lifetime, not client CORE_LOANS.
//! This inventory does NOT qualify an operation. C must retain real R129 role
//! children and independently enforce Root delegation/dual-domain once/floor.
use super::*;
use std::sync::atomic::{AtomicUsize,Ordering};
use crate::source_infrastructure::{MessageOriginalSpan,MessageSealedRawInput};
use super::r5_custody_inputs::CopiedR5Inputs;
use crate::message_evidence::r5_device_originals::R5DeviceBodyMatch;
static NEXT:AtomicUsize=AtomicUsize::new(1);
const MAX_POLICIES:usize=64;
#[path="r5_source_policy/role_view.rs"]mod role_view;
pub(super)use role_view::RoleView;
struct Operation{guard:usize,phase:u32,classic:Vec<u8>,pq:Vec<u8>,application:Vec<u8>,completion:Vec<u8>,first:i32,unknown:bool,busy:bool,recovery_selected:bool,recovery_complete:bool,
 #[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",all(unix,not(target_os="android"))))]original_envelope:Vec<u8>}
impl Operation{fn new()->Self{Self{guard:0,phase:1,classic:Vec::new(),pq:Vec::new(),application:Vec::new(),completion:Vec::new(),first:OK,unknown:false,busy:false,recovery_selected:false,recovery_complete:false,
 #[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",all(unix,not(target_os="android"))))]original_envelope:Vec::new()}}}
#[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",all(unix,not(target_os="android"))))]
struct ServerDeviceOriginals{final_raw:Vec<u8>,current:Vec<u8>,terminal:Vec<u8>,checkpoint:Vec<u8>,predecessors:Vec<Vec<u8>>,prefix_spans:Vec<NativeOriginalSpan>}
pub(super)struct SourcePolicy{startup:usize,kind:u32,inputs:CopiedR5Inputs,pub(super)matched:R5DeviceBodyMatch,roles:[Option<RoleView>;2],children:usize,foreign_guard:usize,first:i32,unknown:bool,operation:Operation,prefix_spans:Vec<NativeOriginalSpan>,
 #[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",all(unix,not(target_os="android"))))]server_device:Option<Box<ServerDeviceOriginals>>}
fn copied(v:&CopiedR5Inputs)->CopiedR5Inputs{CopiedR5Inputs{kind:v.kind,body:v.body.clone(),originals:v.originals.clone(),predecessors:v.predecessors.clone(),bootstrap:v.bootstrap.clone()}}
fn same(a:&CopiedR5Inputs,b:&CopiedR5Inputs)->bool{a.kind==b.kind&&a.body==b.body&&a.originals==b.originals&&a.predecessors==b.predecessors&&a.bootstrap==b.bootstrap}
fn fail(policy:&mut SourcePolicy,cause:i32)->i32{if policy.first==OK{policy.first=cause}policy.unknown=true;UNKNOWN}
pub(super)fn prepare(original:&mut NativeCustodyOwner,held:&mut StartupEvidenceOwner,inputs:&CopiedR5Inputs,matched:R5DeviceBodyMatch)->Result<usize,i32>{
 if inputs.kind!=matched.kind||held.unknown||original.unknown{return Err(UNKNOWN)}
 if let Some((&id,prior))=original.r5_source_policies.iter().find(|(_,p)|p.kind==matched.kind&&p.matched.once_id==matched.once_id){
  // Repeated exact checks never replace the first window, roles or successful
  // state. A different body/context for the same id is only rejected.
  if prior.unknown{return Err(UNKNOWN)}if !same(&prior.inputs,inputs){return Err(MISMATCH)}return Ok(id)
 }
 if original.r5_source_policies.len()>=MAX_POLICIES{return Err(BOUND)}
 let id=NEXT.fetch_update(Ordering::Relaxed,Ordering::Relaxed,|id|id.checked_add(1)).map_err(|_|BOUND)?;
 let mut policy=SourcePolicy{startup:original.startup,kind:inputs.kind,inputs:copied(inputs),matched,roles:[None,None],children:0,foreign_guard:0,first:OK,unknown:false,operation:Operation::new(),prefix_spans:Vec::new(),
  #[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",all(unix,not(target_os="android"))))]server_device:None};
 policy.prefix_spans=policy.inputs.predecessors.iter().map(|p|NativeOriginalSpan{data:p.as_ptr(),size:p.len()}).collect();
 // Presence in the SDK holder is the SDK/startup/key lifetime pin. Install it
 // BEFORE any physical current callback. C separately pins its actual TPM owner.
 original.r5_source_policies.insert(id,policy);
 let result=(||{
  let records=held.enrollment.as_ref().ok_or(1)?;
  for role in 0..2{
   let(raw,history)=if role==0{(&records.issuer_current,&records.issuer_predecessors)}else{(&records.anchor_current,&records.anchor_predecessors)};
   use sha2::{Digest,Sha256};let digest:String=Sha256::digest(raw.as_slice()).iter().map(|b|format!("{b:02x}")).collect();let history:Vec<&[u8]>=history.iter().map(|r|r.as_slice()).collect();
   let enrolled=crate::message_enrollment::verify_startup(&held.source,raw,&history,(role+1)as u8,&digest).map_err(evidence_status)?;
   let pair=held.pairs[role].as_mut().ok_or(1)?;let owner=pair.r5_source_role_owner(&enrolled).map_err(custody_status)?;
   let view=enrolled.with_sealed_custody_input(|input|RoleView::copy(owner,input,raw)).map_err(evidence_status)??;
   original.r5_source_policies.get_mut(&id).ok_or(UNKNOWN)?.roles[role]=Some(view);
  }
  selected_current(held)?;
  let policy=original.r5_source_policies.get(&id).ok_or(UNKNOWN)?;
  if policy.roles[0].as_ref().ok_or(UNKNOWN)?.owner==policy.roles[1].as_ref().ok_or(UNKNOWN)?.owner{return Err(MISMATCH)}
  Ok(())
 })();
 if let Err(cause)=result{let cause=if held.first==OK{cause}else{held.first};let policy=original.r5_source_policies.get_mut(&id).ok_or(UNKNOWN)?;return Err(fail(policy,cause))}
 Ok(id)
}
#[repr(C)]pub(super)struct NativeSourceRolesV1{version:u32,size:u32,kind:u32,count:u32,owners:[*mut c_void;2],expected:[MessageSealedRawInput;2],credentials:[NativeOriginalSpan;2],enrollments:[NativeOriginalSpan;2]}
const _:[();624]=[();std::mem::size_of::<NativeSourceRolesV1>()];
fn output<T>(out:*mut T)->Result<(usize,usize),i32>{if(out as usize)%std::mem::align_of::<T>()!=0{return Err(BOUND)}region(out.cast(),std::mem::size_of::<T>()).ok_or(BOUND)}
fn separate_policy(policy:&SourcePolicy,out:(usize,usize))->Result<(),i32>{
 if !disjoint(region((policy as *const SourcePolicy).cast(),std::mem::size_of::<SourcePolicy>()).ok_or(BOUND)?,out){return Err(BOUND)}
 let mut check=|raw:&[u8]|->Result<(),i32>{if !raw.is_empty()&&!disjoint(region(raw.as_ptr(),raw.len()).ok_or(BOUND)?,out){return Err(BOUND)}Ok(())};
 check(&policy.inputs.body)?;check(&policy.matched.frame)?;for(k,v)in &policy.inputs.originals{check(k.as_bytes())?;check(v)?;}for raw in &policy.inputs.predecessors{check(raw)?;}if let Some(value)=&policy.inputs.bootstrap{check(value.as_bytes())?;}
 for role in policy.roles.iter().flatten(){check(&role.enrollment)?;for raw in &role.fields{check(raw)?;}}
 Ok(())
}
fn boundary(run:impl FnOnce()->Result<(),i32>)->i32{match catch_unwind(AssertUnwindSafe(run)){Ok(Ok(()))=>OK,Ok(Err(s))=>s,Err(_)=>UNKNOWN}}
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_native_r5_retain_v1(holder:*mut c_void,policy:*mut c_void,kind:u32)->i32{
 boundary(||SDK_CUSTODY.with(|rows|{let mut rows=rows.try_borrow_mut().map_err(|_|UNKNOWN)?;let sdk=rows.get_mut(&(holder as usize)).ok_or(1)?;let loan=sdk.r5_source_policies.get_mut(&(policy as usize)).ok_or(1)?;
  if loan.kind!=kind||loan.startup!=sdk.startup{return Err(MISMATCH)}if loan.children>=32{return Err(BOUND)}loan.children+=1;Ok(())}))
}
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_native_r5_release_v1(holder:*mut c_void,policy:*mut c_void,kind:u32)->i32{
 boundary(||SDK_CUSTODY.with(|rows|{let mut rows=rows.try_borrow_mut().map_err(|_|UNKNOWN)?;let sdk=rows.get_mut(&(holder as usize)).ok_or(1)?;let loan=sdk.r5_source_policies.get_mut(&(policy as usize)).ok_or(1)?;
  if loan.kind!=kind||loan.startup!=sdk.startup{return Err(MISMATCH)}if loan.children==0{return Err(BOUND)}loan.children-=1;Ok(())}))
}
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_native_r5_source_roles_v1(holder:*mut c_void,policy:*mut c_void,kind:u32,out:*mut NativeSourceRolesV1)->i32{
 let out_region=match output(out){Ok(v)=>v,Err(s)=>return s};
 boundary(||SDK_CUSTODY.with(|rows|{let mut rows=rows.try_borrow_mut().map_err(|_|UNKNOWN)?;let sdk=rows.get_mut(&(holder as usize)).ok_or(1)?;
  if !disjoint(region((sdk.as_ref()as *const NativeCustodyOwner).cast(),std::mem::size_of::<NativeCustodyOwner>()).ok_or(BOUND)?,out_region){return Err(BOUND)}
  let loan=sdk.r5_source_policies.get_mut(&(policy as usize)).ok_or(1)?;if loan.kind!=kind||loan.startup!=sdk.startup{return Err(MISMATCH)}separate_policy(loan,out_region)?;
  if sdk.unknown||loan.unknown{return Err(UNKNOWN)}if loan.children==0{return Err(6)}
  STARTUP_EVIDENCE.with(|starts|{let mut starts=starts.try_borrow_mut().map_err(|_|UNKNOWN)?;let held=starts.get_mut(&loan.startup).ok_or(UNKNOWN)?;
   if !disjoint(region((held.as_ref()as *const StartupEvidenceOwner).cast(),std::mem::size_of::<StartupEvidenceOwner>()).ok_or(BOUND)?,out_region){return Err(BOUND)}
   if !held.sdk_held||SELECTED_STARTUP.with(|s|s.get())!=Some(loan.startup){return Err(fail(loan,UNKNOWN))}
   if let Err(cause)=selected_current(held){let cause=if held.first==OK{cause}else{held.first};return Err(fail(loan,cause))}
   let issuer=loan.roles[0].as_ref().ok_or(1)?;let anchor=loan.roles[1].as_ref().ok_or(1)?;
   let span=|raw:&[u8]|NativeOriginalSpan{data:raw.as_ptr(),size:raw.len()};
   let value=NativeSourceRolesV1{version:1,size:624,kind:loan.kind,count:2,owners:[issuer.owner as *mut c_void,anchor.owner as *mut c_void],expected:[issuer.raw(),anchor.raw()],credentials:[span(loan.inputs.originals.get("issuerCredential").ok_or(BOUND)?),span(loan.inputs.originals.get("anchorCredential").ok_or(BOUND)?)],enrollments:[span(&issuer.enrollment),span(&anchor.enrollment)]};
   if let Err(cause)=selected_current(held){let cause=if held.first==OK{cause}else{held.first};return Err(fail(loan,cause))}
   unsafe{std::ptr::write(out,value)};Ok(())
  })
 }))
}
pub(super)fn check_unborrowed(holder:usize)->Result<(),i32>{SDK_CUSTODY.with(|rows|{let rows=rows.try_borrow().map_err(|_|UNKNOWN)?;let sdk=rows.get(&holder).ok_or(1)?;
 // Read-only preflight. A later Message3/core/transport/key close can still
 // refuse. Keep ALL exact Source originals until the whole parent closes and
 // SDK_CUSTODY removes that actual holder. Never discard data on a refused or
 // partial close, even when this policy has no remaining C child.
 if sdk.r5_source_policies.values().any(|p|p.children!=0||p.foreign_guard!=0){return Err(6)}Ok(())})}


#[repr(C)]pub(super)struct NativeSourceSnapshotV2{
 version:u32,size:u32,kind:u32,phase:u32,once_id:[u8;32],
 body:NativeOriginalSpan,frame:NativeOriginalSpan,root:NativeOriginalSpan,registration:NativeOriginalSpan,operation:NativeOriginalSpan,terminal:NativeOriginalSpan,checkpoint:NativeOriginalSpan,
 completed_final:NativeOriginalSpan,issuer_credential:NativeOriginalSpan,anchor_credential:NativeOriginalSpan,protected_floor:NativeOriginalSpan,current_observation:NativeOriginalSpan,final_original:NativeOriginalSpan,revocation_checkpoint:NativeOriginalSpan,
 classic:NativeOriginalSpan,pq:NativeOriginalSpan,application_receipt:NativeOriginalSpan,durable_completion:NativeOriginalSpan,
 predecessors:*const NativeOriginalSpan,predecessor_count:usize,
}
const _:[();352]=[();std::mem::size_of::<NativeSourceSnapshotV2>()];
fn pure_snapshot(policy:&SourcePolicy)->NativeSourceSnapshotV2{
 let span=|raw:&[u8]|NativeOriginalSpan{data:if raw.is_empty(){std::ptr::null()}else{raw.as_ptr()},size:raw.len()};
 let input=|name:&str|policy.inputs.originals.get(name).map(|p|span(p)).unwrap_or_else(||span(&[]));
 NativeSourceSnapshotV2{version:2,size:352,kind:policy.kind,phase:if policy.unknown||policy.operation.unknown{8}else if policy.operation.recovery_complete{5}else{policy.operation.phase},once_id:policy.matched.once_id,
 body:span(&policy.inputs.body),frame:span(&policy.matched.frame),root:input("root"),registration:input("registration"),operation:input("firstDeviceOperation"),terminal:input("independentTerminal"),checkpoint:input("checkpoint"),
 completed_final:input("nativeCompletedFinal"),issuer_credential:input("issuerCredential"),anchor_credential:input("anchorCredential"),protected_floor:input("protectedFloor"),current_observation:input("currentObservation"),final_original:input("finalOriginal"),revocation_checkpoint:input("revocationCheckpoint"),
 classic:span(&policy.operation.classic),pq:span(&policy.operation.pq),application_receipt:span(&policy.operation.application),durable_completion:span(&policy.operation.completion),
 predecessors:if policy.prefix_spans.is_empty(){std::ptr::null()}else{policy.prefix_spans.as_ptr()},predecessor_count:policy.prefix_spans.len()}
}
#[unsafe(no_mangle)]pub(crate)unsafe extern "C" fn ynx_sdk_native_r5_source_snapshot_v2(holder:*mut c_void,policy:*mut c_void,kind:u32,out:*mut NativeSourceSnapshotV2)->i32{
 let out_region=match output(out){Ok(v)=>v,Err(s)=>return s};
 // PURE LOCAL DATA. No selected_current, Source/RPC acquisition, clock renewal,
 // signing, network, or mutation. Even UNKNOWN retains real captured parts.
 boundary(||SDK_CUSTODY.with(|rows|{
  let rows=rows.try_borrow().map_err(|_|UNKNOWN)?;let sdk=rows.get(&(holder as usize)).ok_or(1)?;
  if !disjoint(region((sdk.as_ref()as*const NativeCustodyOwner).cast(),std::mem::size_of::<NativeCustodyOwner>()).ok_or(BOUND)?,out_region){return Err(BOUND)}
  let loan=sdk.r5_source_policies.get(&(policy as usize)).ok_or(1)?;
  if loan.kind!=kind||loan.startup!=sdk.startup{return Err(MISMATCH)}
  if loan.children==0{return Err(6)}
  separate_policy(loan,out_region)?;
  let check=|raw:&[u8]|->Result<(),i32>{if !raw.is_empty()&&!disjoint(out_region,region(raw.as_ptr(),raw.len()).ok_or(BOUND)?){return Err(BOUND)}Ok(())};
  for raw in [&loan.operation.classic,&loan.operation.pq,&loan.operation.application,&loan.operation.completion]{check(raw)?;}
  if !loan.prefix_spans.is_empty(){let r=region(loan.prefix_spans.as_ptr().cast(),loan.prefix_spans.len().checked_mul(std::mem::size_of::<NativeOriginalSpan>()).ok_or(BOUND)?).ok_or(BOUND)?;if !disjoint(out_region,r){return Err(BOUND)}}
  let mut value=pure_snapshot(loan);if sdk.unknown{value.phase=8}unsafe{std::ptr::write(out,value)};Ok(())
 }))
}

#[path="r5_application_receipt.rs"]mod application_receipt;
#[cfg(all(feature="abi5-final-native-link",feature="source-server-collector"))]#[path="r5_source_operations.rs"]pub(crate)mod operations;

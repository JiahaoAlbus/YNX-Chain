//! Private execution framing and retained original exchange custody.
//! Neither a transport response nor its opaque reference is an admitted owner.
//! Effect execution continues to require the selected protection driver and the
//! same independently held current/revocation/transaction fence.
use std::{marker::PhantomData,rc::Rc,thread::{self,ThreadId},time::{Duration,Instant}};
use sha2::{Digest,Sha256};
use zeroize::Zeroizing;
use crate::message_enrollment::StartupEnrollment;

#[cfg(test)]
mod core_attachment_tests {
 use super::*;
 // Lifecycle-only fixtures: no keys, registered resource, policy or grant.
 fn empty() -> Execution {
  let domain=||Domain{
   endpoint:String::new(),spki:String::new(),registration:String::new(),floor:0,
   client:None,stage:ExchangeStage::New,completed:Vec::new(),ambiguous:None,
   recovery_started:false,remote:None,raw_response:None,observation:None,pending:None,
  };
  Execution{domains:[domain(),domain()],source_credentials:[[0;32];2],
   source_enrollments:[[0;32];2],thread:thread::current().id(),first:0,
   unknown:false,closed:false,local:PhantomData}
 }
 #[test] fn drained_unknown_custody_cannot_become_new_core_parent(){
  let mut e=empty();assert_eq!(e.fail(BOUND,true),UNKNOWN);
  assert_eq!(e.first_failure(),BOUND);assert_eq!(e.close_local(),Ok(()));
  assert!(e.closed&&e.unknown);assert_eq!(e.first_failure(),BOUND);
  assert!(!e.can_attach_core());assert_eq!(e.close_local(),Ok(()));
  assert!(e.unknown);assert_eq!(e.first_failure(),BOUND);
 }
 #[test] fn unused_lifetime_is_not_signing_admission(){
  let mut e=empty();
  assert!(e.can_attach_core());
  assert_eq!(e.admission_status(),REQUIRED);
  assert_eq!(e.action_status(5),REQUIRED);
 }
 #[test] fn uncertain_failed_closed_or_foreign_custody_cannot_attach(){
  let mut e=empty();e.unknown=true;assert!(!e.can_attach_core());assert!(e.unknown);
  let mut e=empty();e.first=BOUND;assert!(!e.can_attach_core());assert_eq!(e.first,BOUND);
  let mut e=empty();e.closed=true;assert!(!e.can_attach_core());
  let mut e=empty();e.thread=std::thread::spawn(||thread::current().id()).join().unwrap();
  assert!(!e.can_attach_core());
 }
 #[test] fn either_domain_after_acquisition_cannot_attach(){
  for role in 0..2 {
   for stage in [ExchangeStage::Acquired,ExchangeStage::Current,ExchangeStage::Reserved,
    ExchangeStage::Bound,ExchangeStage::Preflight,ExchangeStage::Readback,ExchangeStage::Retired] {
    let mut e=empty();e.domains[role].stage=stage;
    assert!(!e.can_attach_core());assert!(e.domains[role].stage==stage);
   }
  }
 }
 #[test] fn partial_response_and_recovery_are_preserved_on_refusal(){
  for role in 0..2 {
   let mut e=empty();e.domains[role].raw_response=Some(Zeroizing::new(vec![1,2,3]));
   assert!(!e.can_attach_core());
   assert_eq!(e.domains[role].raw_response.as_ref().unwrap().as_slice(),&[1,2,3]);
   let mut e=empty();e.domains[role].recovery_started=true;
   assert!(!e.can_attach_core());assert!(e.domains[role].recovery_started);
  }
 }
 #[test] fn remote_reference_is_not_discarded_to_attach_core(){
  for role in 0..2 {
   let mut e=empty();e.domains[role].remote=Some(RemoteOriginal{
    reference:[7;32],request:Zeroizing::new(vec![8]),response:Zeroizing::new(vec![9]),
    start:Instant::now(),budget:Duration::from_secs(1),
   });
   assert!(!e.can_attach_core());
   assert_eq!(e.domains[role].remote.as_ref().unwrap().reference,[7;32]);
   assert_eq!(e.close_local(),Err(UNKNOWN));
   assert!(e.domains[role].remote.is_some());
  }
 }
 // New PUBLIC clock/grammar controls in the existing normal unit-test entry.
 // No selected Root, registered resource or physical caller is supplied.
 fn retired_fixture()->(Execution,Constraints){
  let at=u64::try_from(crate::source_evidence::now_ms().unwrap()).unwrap();
  let original=Constraints{digests:[[1;32];10],nonce:[2;32],logical:[3;16],direction:1,
   issued:at.saturating_sub(1),expires:at+29999,base_head:[4;32],floor:1,generation:1};
  let request=Request::build([1;32],[7;32],&original,Payload::Current).unwrap();
  let mut e=empty();e.domains[0].stage=ExchangeStage::Retired;
  e.domains[0].remote=Some(RemoteOriginal{reference:[7;32],request:Zeroizing::new(request.bytes().to_vec()),
   response:Zeroizing::new(b"PUBLIC-UNADMITTED-RESPONSE".to_vec()),start:Instant::now(),budget:Duration::ZERO});
  (e,original)
 }
 #[test]fn retired_current_refuses_expired_original_remote_window_before_dispatch(){
  let(mut e,original)=retired_fixture();
  let request=Request::build([2;32],[7;32],&original,Payload::Current).unwrap();
  assert!(matches!(e.begin(0,request,Duration::from_secs(20)),Err(UNKNOWN)));
  assert!(e.unknown&&e.first==UNKNOWN);assert!(e.domains[0].pending.is_none());
  assert!(e.domains[0].client.is_none());
 }
 #[test]fn retired_current_budget_never_outlives_first_remote_owner(){
  let(mut e,original)=retired_fixture();
  let owner=e.domains[0].remote.as_mut().unwrap();owner.budget=Duration::from_secs(10);
  let limit=owner.start+owner.budget;
  let request=Request::build([2;32],[7;32],&original,Payload::Current).unwrap();
  assert!(e.begin(0,request,Duration::from_secs(20)).is_ok());
  let pending=e.domains[0].pending.as_ref().unwrap();
  assert!(pending.start+pending.budget<=limit);
 }
 #[test]fn retired_cleanup_query_keeps_original_unknown_and_same_reference(){
  let(mut e,original)=retired_fixture();e.unknown=true;e.first=BOUND;
  let request=Request::build([2;32],[7;32],&original,Payload::QueryClose{subaction:QuerySubaction::Query}).unwrap();
  assert!(e.begin(0,request,Duration::from_secs(1)).is_ok());
  assert!(e.unknown&&e.first==BOUND&&e.domains[0].recovery_started);
  assert_eq!(e.domains[0].remote.as_ref().unwrap().reference,[7;32]);
  assert_eq!(e.admission_status(),UNKNOWN);
 }

 // Deny-only retained-floor controls. All replies below are PUBLIC grammar
 // fixtures: no enrolled attestation, keys, client or qualified owner exists.
 fn floor_payload(original:&Constraints,role:usize,floor:u64)->Vec<u8>{
  let mut p=Vec::new();original.write(&mut p).unwrap();
  p.extend(((role+1)as u32).to_be_bytes());p.extend([7;32]);p.extend([8;32]);
  p.extend(floor.to_be_bytes());p.extend(original.generation.to_be_bytes());
  put_blob(&mut p,b"PUBLIC-UNADMITTED-CURRENT",65536).unwrap();p.extend(0u16.to_be_bytes());
  p.extend(1000000000u64.to_be_bytes());
  put_blob(&mut p,b"PUBLIC-UNVERIFIED-QUOTE",65536).unwrap();
  put_blob(&mut p,b"PUBLIC-UNVERIFIED-CERTIFY",65536).unwrap();p
 }
 fn floor_reply(request:&Request,original:&Constraints,role:usize,floor:u64)->Vec<u8>{
  let p=floor_payload(original,role,floor);let mut raw=Vec::new();
  raw.extend(MAGIC);raw.extend(1u16.to_be_bytes());raw.extend((Action::Current as u16).to_be_bytes());
  raw.extend(request.id);raw.extend([7;32]);raw.extend(0u32.to_be_bytes());raw.extend((p.len()as u32).to_be_bytes());raw.extend(p);raw
 }
 fn held_floor(original:&Constraints,role:usize,floor:u64)->Completed{
  let request=Request::build([1;32],[7;32],original,Payload::Current).unwrap();
  let raw=Zeroizing::new(floor_reply(&request,original,role,floor));
  let observation=Observation::parse(&floor_payload(original,role,floor),Action::Current,original,(role+1)as u32).unwrap();
  Completed{request,raw,observation}
 }
 fn floor_fixture(prior:&[u64],role:usize,next:u64)->(Execution,Constraints,Vec<u8>){
  let(mut e,original)=retired_fixture();e.domains[1-role].remote=None;
  let request=Request::build([2;32],[7;32],&original,Payload::Current).unwrap();
  let raw=floor_reply(&request,&original,role,next);
  let d=&mut e.domains[role];d.stage=ExchangeStage::Retired;
  d.remote=Some(RemoteOriginal{reference:[7;32],request:Zeroizing::new(request.bytes().to_vec()),
   response:Zeroizing::new(b"PUBLIC-UNADMITTED-RESPONSE".to_vec()),start:Instant::now(),budget:Duration::from_secs(10)});
  d.completed=prior.iter().map(|n|held_floor(&original,role,*n)).collect();
  assert!(e.begin(role,request,Duration::from_secs(5)).is_ok());(e,original,raw)
 }
 #[test]fn retired_current_response_cannot_regress_below_retained_observation(){
  let(mut e,original,raw)=floor_fixture(&[5],0,3);
  assert_eq!(e.receive(0,&raw,&original),Err(UNKNOWN));
  assert!(e.unknown&&e.first==UNKNOWN&&e.domains[0].pending.is_some());
  assert_eq!(e.domains[0].raw_response.as_ref().unwrap().as_slice(),raw.as_slice());
  assert_eq!(e.domains[0].observation.as_ref().unwrap().floor,3);
  assert_eq!(e.domains[0].completed.len(),1);
 }
 #[test]fn retired_current_floor_bound_keeps_full_original_history(){
  let(mut e,original,raw)=floor_fixture(&[9,4],0,8);
  assert_eq!(e.receive(0,&raw,&original),Err(UNKNOWN));
  assert_eq!(e.domains[0].observation.as_ref().unwrap().floor,8);
  assert!(e.unknown&&e.domains[0].completed.len()==2);
 }
 #[test]fn retired_current_floor_is_per_domain_and_never_admission(){
  let(mut e,original,raw)=floor_fixture(&[2],1,3);
  e.domains[0].completed.push(held_floor(&original,0,99));
  assert_eq!(e.receive(1,&raw,&original),Ok(()));assert!(!e.unknown);
  assert_eq!(e.domains[1].observation.as_ref().unwrap().floor,3);
  assert_eq!(e.admission_status(),REQUIRED); // Still no protected client/fence.
 }

}

pub(crate) const REQUIRED:i32=1;
pub(crate) const UNKNOWN:i32=8;
pub(crate) const BOUND:i32=2;
const MAGIC:&[u8;8]=b"YNXEXE1\0";
const MAX:usize=4194304;
const REQUEST_HEADER:usize=80;
const RESPONSE_HEADER:usize=84;
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
#[repr(u16)]
pub(crate) enum Action{Acquire=1,Current=2,Reserve=3,Bind=4,Adjudicate=5,Retire=6,QueryClose=7}
impl Action{fn parse(n:u16)->Result<Self,i32>{match n{1=>Ok(Self::Acquire),2=>Ok(Self::Current),3=>Ok(Self::Reserve),4=>Ok(Self::Bind),5=>Ok(Self::Adjudicate),6=>Ok(Self::Retire),7=>Ok(Self::QueryClose),_=>Err(BOUND)}}}
struct Reader<'a>{raw:&'a[u8],at:usize}
impl<'a> Reader<'a>{
 fn take(&mut self,n:usize)->Result<&'a[u8],i32>{let end=self.at.checked_add(n).ok_or(BOUND)?;let v=self.raw.get(self.at..end).ok_or(BOUND)?;self.at=end;Ok(v)}
 fn array<const N:usize>(&mut self)->Result<[u8;N],i32>{self.take(N)?.try_into().map_err(|_|BOUND)}
 fn u16(&mut self)->Result<u16,i32>{Ok(u16::from_be_bytes(self.array()?))}
 fn u32(&mut self)->Result<u32,i32>{Ok(u32::from_be_bytes(self.array()?))}
 fn u64(&mut self)->Result<u64,i32>{Ok(u64::from_be_bytes(self.array()?))}
 fn blob(&mut self,max:usize)->Result<Zeroizing<Vec<u8>>,i32>{let n=usize::try_from(self.u32()?).map_err(|_|BOUND)?;if n==0||n>max{return Err(BOUND)}Ok(Zeroizing::new(self.take(n)?.to_vec()))}
 fn done(&self)->Result<(),i32>{if self.at==self.raw.len(){Ok(())}else{Err(BOUND)}}
}
/// Ordered common request fields. Exact bytes come from the original operation,
/// never from the N-API fact tree or a transport response's Expected fields.
#[derive(Debug,PartialEq,Eq)]
pub(crate) struct Constraints{
 pub(crate) digests:[[u8;32];10],pub(crate) nonce:[u8;32],pub(crate) logical:[u8;16],pub(crate) direction:u32,
 pub(crate) issued:u64,pub(crate) expires:u64,pub(crate) base_head:[u8;32],pub(crate) floor:u64,pub(crate) generation:u64,
}
impl Constraints{
 fn read(r:&mut Reader<'_>)->Result<Self,i32>{
  let mut digests=[[0;32];10];for v in &mut digests{*v=r.array()?;}
  let c=Self{digests,nonce:r.array()?,logical:r.array()?,direction:r.u32()?,issued:r.u64()?,expires:r.u64()?,base_head:r.array()?,floor:r.u64()?,generation:r.u64()?};
  c.validate()?;Ok(c)
 }
 fn validate(&self)->Result<(),i32>{if !matches!(self.direction,1|2)||self.issued>=self.expires||self.expires>9007199254740991||self.expires-self.issued>30000||self.generation==0{return Err(BOUND)}Ok(())}
 fn write(&self,out:&mut Vec<u8>)->Result<(),i32>{self.validate()?;for d in &self.digests{out.extend(d)}out.extend(self.nonce);out.extend(self.logical);out.extend(self.direction.to_be_bytes());out.extend(self.issued.to_be_bytes());out.extend(self.expires.to_be_bytes());out.extend(self.base_head);out.extend(self.floor.to_be_bytes());out.extend(self.generation.to_be_bytes());Ok(())}
}
/// No plaintext secret, SessionRecord or arbitrary byte payload variant.
/// Original evidence spans are Native-selected public originals; encrypted rows
/// retain the existing record/queue grammar and original ciphertext bytes.
pub(crate) enum Payload<'a>{
 Acquire{originals:FixedOriginals<'a>,prefixes:[&'a[&'a[u8]];3]},
 Current,
 Reserve{ciphertext_digest:[u8;32],nonce_allocation_original:&'a[u8]},
 Bind{reservation_original:&'a[u8],rows:&'a[&'a[u8]]},
 Adjudicate{phase:AdjudicationPhase,reservation_original:&'a[u8],readback_original:&'a[u8]},
 Retire{engine_issuer:&'a[u8],engine_anchor:&'a[u8],checkpoint_original:&'a[u8],terminal_issuer:&'a[u8],terminal_anchor:&'a[u8],prefixes:[&'a[&'a[u8]];3]},
 QueryClose{subaction:QuerySubaction},
}
pub(crate) struct FixedOriginals<'a>{
 pub(crate) account_root:&'a[u8],pub(crate) account_registration:&'a[u8],pub(crate) account_current:&'a[u8],
 pub(crate) source_admission:&'a[u8],pub(crate) issuer_credential:&'a[u8],pub(crate) anchor_credential:&'a[u8],
 pub(crate) issuer_enrollment:&'a[u8],pub(crate) anchor_enrollment:&'a[u8],
 pub(crate) resource_association:&'a[u8],pub(crate) transport_client_registration:&'a[u8],
}
#[derive(Clone,Copy)]pub(crate) enum AdjudicationPhase{Preflight,Readback}
#[derive(Clone,Copy)]pub(crate) enum QuerySubaction{Query,Close}
fn put_blob(out:&mut Vec<u8>,raw:&[u8],max:usize)->Result<(),i32>{
 if raw.is_empty()||raw.len()>max||out.len().checked_add(4+raw.len()).filter(|n|*n<=MAX).is_none(){return Err(BOUND)}
 out.extend((raw.len()as u32).to_be_bytes());out.extend(raw);Ok(())
}
fn put_prefix(out:&mut Vec<u8>,raw:&[&[u8]])->Result<(),i32>{
 if raw.len()>255{return Err(BOUND)}let mut total=0usize;out.extend((raw.len()as u16).to_be_bytes());
 for p in raw{total=total.checked_add(p.len()).ok_or(BOUND)?;if total>393216{return Err(BOUND)}put_blob(out,p,65536)?;}Ok(())
}
impl Payload<'_>{
 fn write(&self,original:&Constraints,out:&mut Vec<u8>)->Result<Action,i32>{match self{
 Self::Acquire{originals,prefixes}=>{
  // Ten ordered raw spans and three original prefixes. This private container
  // does not change any signed body. None is a private key or SessionRecord.
  for raw in [originals.account_root,originals.account_registration,originals.account_current,originals.source_admission,originals.issuer_credential,originals.anchor_credential,originals.issuer_enrollment,originals.anchor_enrollment,originals.resource_association,originals.transport_client_registration]{put_blob(out,raw,65536)?;}
  for p in prefixes{put_prefix(out,p)?;}Ok(Action::Acquire)
 },
 Self::Current=>Ok(Action::Current),
 Self::Reserve{ciphertext_digest,nonce_allocation_original}=>{out.extend(ciphertext_digest);put_blob(out,nonce_allocation_original,65536)?;Ok(Action::Reserve)},
 Self::Bind{reservation_original,rows}=>{
  if rows.is_empty()||rows.len()>33{return Err(BOUND)}put_blob(out,reservation_original,65536)?;out.extend((rows.len()as u16).to_be_bytes());
  for (n,row) in rows.iter().enumerate(){
   // The queue is exactly the last row; never reinterpret a record as a queue
   // or silently chunk/reseal ciphertext to fit this transport.
   let (magic,limit)=if n+1==rows.len(){(b"YNXQUE1\0",1049132usize)}else{(b"YNXREC1\0",66092usize)};
   if row.len()<428||row.len()>limit||row.get(..8)!=Some(magic.as_slice())||row[8..12]!=[0,1,0,1]{return Err(BOUND)}
   let u32at=|at:usize|->Result<u32,i32>{Ok(u32::from_be_bytes(row.get(at..at+4).ok_or(BOUND)?.try_into().map_err(|_|BOUND)?))};
   let u64at=|at:usize|->Result<u64,i32>{Ok(u64::from_be_bytes(row.get(at..at+8).ok_or(BOUND)?.try_into().map_err(|_|BOUND)?))};
   let name=usize::try_from(u32at(64)?).map_err(|_|BOUND)?;let header=usize::try_from(u32at(12)?).map_err(|_|BOUND)?;let plain=usize::try_from(u32at(16)?).map_err(|_|BOUND)?;
   if name>128||header!=412+name||plain>if n+1==rows.len(){1048576}else{65536}||usize::try_from(u32at(20)?).map_err(|_|BOUND)?!=plain+16||row.len()!=header+plain+16||u64at(24)?!=original.generation||u64at(40)?<=u64at(32)?||u32at(68)?!=original.direction{return Err(BOUND)}
   for (at,expected) in [(192,&original.digests[0]),(224,&original.digests[6]),(256,&original.digests[7]),(288,&original.digests[8]),(320,&original.digests[9]),(352,&original.nonce)]{if row.get(at..at+32)!=Some(expected.as_slice()){return Err(BOUND)}}
   if row.get(384..400)!=Some(original.logical.as_slice())||u64at(24)?>u64::from(u32::MAX)||u32at(400)?!=original.generation as u32{return Err(BOUND)}
   put_blob(out,row,limit)?;
  }Ok(Action::Bind)
 },
 Self::Adjudicate{phase,reservation_original,readback_original}=>{
  // Readback classifies this SAME local SQL effect. Neither phase executes a
  // second remote CAS; no network exchange may run under the effect borrow.
  out.push(match phase{AdjudicationPhase::Preflight=>0,AdjudicationPhase::Readback=>1});put_blob(out,reservation_original,65536)?;put_blob(out,readback_original,65536)?;Ok(Action::Adjudicate)
 },
 Self::Retire{engine_issuer,engine_anchor,checkpoint_original,terminal_issuer,terminal_anchor,prefixes}=>{
  if prefixes[1].len()!=prefixes[2].len(){return Err(BOUND)}
  let mut total=0usize;for raw in [*engine_issuer,*engine_anchor,*checkpoint_original,*terminal_issuer,*terminal_anchor].into_iter().chain(prefixes.into_iter().flat_map(|p|p.iter().copied())){total=total.checked_add(raw.len()).ok_or(BOUND)?;if total>393216{return Err(BOUND)}}
  let engine=crate::message_evidence::EngineCommitCompanions::encode(engine_issuer,engine_anchor).map_err(|_|BOUND)?;
  for raw in [engine.as_slice(),checkpoint_original,terminal_issuer,terminal_anchor]{put_blob(out,raw,65536)?;}for p in prefixes{put_prefix(out,p)?;}Ok(Action::Retire)
 },
 Self::QueryClose{subaction}=>{out.push(match subaction{QuerySubaction::Query=>0,QuerySubaction::Close=>1});Ok(Action::QueryClose)},
 }}
}
pub(crate) struct Request{pub(crate) action:Action,pub(crate) id:[u8;32],pub(crate) owner:[u8;32],raw:Zeroizing<Vec<u8>>,digest:[u8;32]}
impl Request{
 pub(crate) fn build(id:[u8;32],owner:[u8;32],original:&Constraints,body:Payload<'_>)->Result<Self,i32>{
  let mut encoded=Zeroizing::new(Vec::new());let action=body.write(original,&mut encoded)?;
  if id==[0;32]||(action!=Action::Acquire&&owner==[0;32])||(action==Action::Acquire&&owner!=[0;32]){return Err(BOUND)}
  let mut payload=Zeroizing::new(Vec::new());original.write(&mut payload)?;
  if encoded.len()>MAX-payload.len(){return Err(BOUND)}payload.extend(encoded.as_slice());
  let mut raw=Zeroizing::new(Vec::new());raw.try_reserve_exact(REQUEST_HEADER+payload.len()).map_err(|_|BOUND)?;
  raw.extend(MAGIC);raw.extend(1u16.to_be_bytes());raw.extend((action as u16).to_be_bytes());raw.extend((payload.len()as u32).to_be_bytes());raw.extend(id);raw.extend(owner);raw.extend(payload.as_slice());
  let digest=Sha256::digest(raw.as_slice()).into();Ok(Self{action,id,owner,raw,digest})
 }
 /// Normal static driver intake: strict reconstruction of the already held
 /// original request; this parser never creates an admitted resource owner.
 pub(crate) fn original(raw:&[u8])->Result<(Self,Constraints),i32>{
  if raw.len()<REQUEST_HEADER||raw.len()>MAX+REQUEST_HEADER{return Err(BOUND)}
  let mut r=Reader{raw,at:0};if r.take(8)?!=MAGIC||r.u16()?!=1{return Err(BOUND)}
  let action=Action::parse(r.u16()?)?;let size=usize::try_from(r.u32()?).map_err(|_|BOUND)?;
  let id=r.array()?;let owner=r.array()?;if size!=raw.len()-REQUEST_HEADER{return Err(BOUND)}
  let original=Constraints::read(&mut r)?;
  let prefix=|r:&mut Reader<'_>|->Result<Vec<Zeroizing<Vec<u8>>>,i32>{let count=usize::from(r.u16()?);if count>255{return Err(BOUND)}let mut out=Vec::new();let mut total=0usize;for _ in 0..count{let b=r.blob(65536)?;total=total.checked_add(b.len()).filter(|n|*n<=393216).ok_or(BOUND)?;out.push(b);}Ok(out)};
  let body=match action{
   Action::Acquire=>{let mut spans=Vec::new();for _ in 0..10{spans.push(r.blob(65536)?)}let histories=[prefix(&mut r)?,prefix(&mut r)?,prefix(&mut r)?];
    let refs:[Vec<&[u8]>;3]=histories.each_ref().map(|h|h.iter().map(|b|b.as_slice()).collect());
    let originals=FixedOriginals{account_root:&spans[0],account_registration:&spans[1],account_current:&spans[2],source_admission:&spans[3],issuer_credential:&spans[4],anchor_credential:&spans[5],issuer_enrollment:&spans[6],anchor_enrollment:&spans[7],resource_association:&spans[8],transport_client_registration:&spans[9]};
    Self::build(id,owner,&original,Payload::Acquire{originals,prefixes:[&refs[0],&refs[1],&refs[2]]})?
   },
   Action::Current=>Self::build(id,owner,&original,Payload::Current)?,
   Action::Reserve=>{let ciphertext_digest=r.array()?;let allocation=r.blob(65536)?;Self::build(id,owner,&original,Payload::Reserve{ciphertext_digest,nonce_allocation_original:&allocation})?},
   Action::Bind=>{let reservation=r.blob(65536)?;let count=usize::from(r.u16()?);if count==0||count>33{return Err(BOUND)}let mut rows=Vec::new();for n in 0..count{rows.push(r.blob(if n+1==count{1049132}else{66092})?)}let refs:Vec<&[u8]>=rows.iter().map(|b|b.as_slice()).collect();Self::build(id,owner,&original,Payload::Bind{reservation_original:&reservation,rows:&refs})?},
   Action::Adjudicate=>{let phase=match r.take(1)?[0]{0=>AdjudicationPhase::Preflight,1=>AdjudicationPhase::Readback,_=>return Err(BOUND)};let reservation=r.blob(65536)?;let readback=r.blob(65536)?;Self::build(id,owner,&original,Payload::Adjudicate{phase,reservation_original:&reservation,readback_original:&readback})?},
   Action::Retire=>{let engine_slot=r.blob(65536)?;let engine=crate::message_evidence::EngineCommitCompanions::parse(&engine_slot).map_err(|_|BOUND)?;let checkpoint=r.blob(65536)?;let issuer=r.blob(65536)?;let anchor=r.blob(65536)?;let histories=[prefix(&mut r)?,prefix(&mut r)?,prefix(&mut r)?];let refs:[Vec<&[u8]>;3]=histories.each_ref().map(|h|h.iter().map(|b|b.as_slice()).collect());Self::build(id,owner,&original,Payload::Retire{engine_issuer:engine.issuer_original(),engine_anchor:engine.anchor_original(),checkpoint_original:&checkpoint,terminal_issuer:&issuer,terminal_anchor:&anchor,prefixes:[&refs[0],&refs[1],&refs[2]]})?},
   Action::QueryClose=>{let subaction=match r.take(1)?[0]{0=>QuerySubaction::Query,1=>QuerySubaction::Close,_=>return Err(BOUND)};Self::build(id,owner,&original,Payload::QueryClose{subaction})?},
  };r.done()?;if body.raw.as_slice()!=raw{return Err(BOUND)}Ok((body,original))
 }
 /// Existing private phase6 intake borrows all nine originals from this
 /// immutable request, never a separate caller tuple or response observation.
 pub(crate)fn verify_retirement_originals(&self,source:&crate::source_evidence::FixedStartupSourceEvidence)->Result<(),i32>{
  if self.action!=Action::Retire{return Err(BOUND)}
  let mut r=Reader{raw:&self.raw[REQUEST_HEADER..],at:0};let expected=Constraints::read(&mut r)?;
  let engine=crate::message_evidence::EngineCommitCompanions::parse(&r.blob(65536)?).map_err(|_|BOUND)?;
  let checkpoint=r.blob(65536)?;let issuer=r.blob(65536)?;let anchor=r.blob(65536)?;
  let mut histories:[Vec<Zeroizing<Vec<u8>>>;3]=std::array::from_fn(|_|Vec::new());
  for history in &mut histories{let count=usize::from(r.u16()?);if count>255{return Err(BOUND)}for _ in 0..count{history.push(r.blob(65536)?);}}r.done()?;
  let refs:[Vec<&[u8]>;3]=histories.each_ref().map(|h|h.iter().map(|v|v.as_slice()).collect());
  let originals=crate::message_evidence::IndependentCommitOriginals{engine_issuer:engine.issuer_original(),engine_anchor:engine.anchor_original(),checkpoint_anchor:&checkpoint,terminal_issuer:&issuer,terminal_anchor:&anchor,checkpoint_predecessors:&refs[0],terminal_issuer_predecessors:&refs[1],terminal_anchor_predecessors:&refs[2]};
  crate::message_evidence::verify_fixed_commit_originals(source,&originals,&expected.nonce).map_err(|e|match e{crate::source_evidence::Error::ProfileRequired=>REQUIRED,crate::source_evidence::Error::Bounds=>BOUND,_=>7})
 }
 /// Phase6 response can only acknowledge the exact originals already held
 /// by this Retire request. Their mathematical/owning validation is separate;
 /// no response may replace a checkpoint or terminal selected by that owner.
 fn match_retirement_response(&self,observation:&Observation)->Result<(),i32>{
  if self.action!=Action::Retire{return Ok(())}
  let mut r=Reader{raw:&self.raw[REQUEST_HEADER..],at:0};Constraints::read(&mut r)?;
  let _engine=r.blob(65536)?;let checkpoint=r.blob(65536)?;let terminal=r.blob(65536)?;
  if observation.checkpoint.as_ref().map(|v|v.as_slice())!=Some(checkpoint.as_slice())||observation.terminal.as_ref().map(|v|v.as_slice())!=Some(terminal.as_slice()){return Err(UNKNOWN)}
  Ok(())
 }
 pub(crate) fn bytes(&self)->&[u8]{&self.raw}
}
/// Public, unadmitted original observations only. No key plaintext field exists.
pub(crate) struct Observation{
 pub(crate) original:Constraints,pub(crate) role:u32,pub(crate) association:[u8;32],pub(crate) head:[u8;32],pub(crate) floor:u64,pub(crate) generation:u64,
 pub(crate) current:Zeroizing<Vec<u8>>,pub(crate) predecessors:Vec<Zeroizing<Vec<u8>>>,pub(crate) remaining_ns:u64,
 pub(crate) quote:Zeroizing<Vec<u8>>,pub(crate) certify:Zeroizing<Vec<u8>>,pub(crate) checkpoint:Option<Zeroizing<Vec<u8>>>,pub(crate) terminal:Option<Zeroizing<Vec<u8>>>,
}
impl Observation{
 fn parse(raw:&[u8],action:Action,expected:&Constraints,role:u32)->Result<Self,i32>{
  let mut r=Reader{raw,at:0};let original=Constraints::read(&mut r)?;
  let returned_role=r.u32()?;let association=r.array()?;let head=r.array()?;let floor=r.u64()?;let generation=r.u64()?;
  let current=r.blob(65536)?;let count=usize::from(r.u16()?);if count>255{return Err(BOUND)}
  let mut predecessors=Vec::new();let mut total=current.len();
  for _ in 0..count{let p=r.blob(65536)?;total=total.checked_add(p.len()).ok_or(BOUND)?;if total>393216{return Err(BOUND)}predecessors.push(p);}
  let remaining_ns=r.u64()?;let quote=r.blob(65536)?;let certify=r.blob(65536)?;
  let (checkpoint,terminal)=if matches!(action,Action::Adjudicate|Action::Retire|Action::QueryClose){(Some(r.blob(65536)?),Some(r.blob(65536)?))}else{(None,None)};r.done()?;
  if original!=*expected||returned_role!=role||association==[0;32]||floor<expected.floor||generation!=expected.generation||remaining_ns==0{return Err(UNKNOWN)}
  Ok(Self{original,role:returned_role,association,head,floor,generation,current,predecessors,remaining_ns,quote,certify,checkpoint,terminal})
 }
}
struct Pending{request:Request,start:Instant,budget:Duration}
struct Completed{request:Request,raw:Zeroizing<Vec<u8>>,observation:Observation}
struct Ambiguous{pending:Pending,raw:Option<Zeroizing<Vec<u8>>>,observation:Option<Observation>}
/// Wire ordering only. No stage supplies a joint effect fence or permission.
#[derive(Clone,Copy,PartialEq,Eq)]
enum ExchangeStage{New,Acquired,Current,Reserved,Bound,Preflight,Readback,Retired}
fn next_exchange(stage:ExchangeStage,request:&Request)->Result<ExchangeStage,i32>{
 use ExchangeStage::*;
 match request.action{
  Action::Acquire if stage==New=>Ok(Acquired),
  Action::Current if stage!=New=>Ok(if stage==Acquired{Current}else{stage}),
  Action::Reserve if stage==Current=>Ok(Reserved),
  Action::Bind if stage==Reserved=>Ok(Bound),
  Action::Adjudicate=>{
   let mut r=Reader{raw:&request.raw[REQUEST_HEADER..],at:0};Constraints::read(&mut r)?;
   match r.take(1)?[0]{0 if stage==Bound=>Ok(Preflight),1 if stage==Preflight=>Ok(Readback),_=>Err(BOUND)}
  },
  Action::Retire if stage==Readback=>Ok(Retired),
  Action::QueryClose if stage!=New=>Ok(stage),
  _=>Err(BOUND),
 }
}
/// Same registered transport's original remote cleanup custody. This type is
/// private and cannot inhabit a storage key, joint fence or message permission.
/// The server reference remains an identifier; authentication is supplied by
/// the held Native transport and exact captured request, never a raw pointer.
struct RemoteOriginal{
 reference:[u8;32],request:Zeroizing<Vec<u8>>,response:Zeroizing<Vec<u8>>,
 start:Instant,budget:Duration,
}
impl RemoteOriginal{
 fn adopt(reference:[u8;32],pending:&Pending,response:&[u8])->Result<Self,i32>{
  if reference==[0;32]||pending.request.raw.len()<516{return Err(BOUND)}
  Ok(Self{reference,request:Zeroizing::new(pending.request.raw.to_vec()),response:Zeroizing::new(response.to_vec()),start:pending.start,budget:pending.budget})
 }
 fn matches(&self,request:&Request)->bool{
  request.owner==self.reference&&request.raw.get(80..516)==self.request.get(80..516)
 }
}
struct Domain{
 endpoint:String,spki:String,registration:String,floor:u64,
 /// Retain a bounded non-null partial reference before parsing status/payload.
 client:Option<crate::source_infrastructure::MessageTransportClient>,stage:ExchangeStage,completed:Vec<Completed>,ambiguous:Option<Ambiguous>,recovery_started:bool,remote:Option<RemoteOriginal>,raw_response:Option<Zeroizing<Vec<u8>>>,observation:Option<Observation>,pending:Option<Pending>,
}
/// Same-thread retained failed-acquisition state. This is NOT the qualified
/// resource type, and cannot construct a storage/signing/session permission.
pub(crate) struct Execution{
 domains:[Domain;2],source_credentials:[[u8;32];2],source_enrollments:[[u8;32];2],thread:ThreadId,first:i32,unknown:bool,closed:bool,local:PhantomData<Rc<()>>,
}
impl Execution{
 pub(crate) fn selected(issuer:&StartupEnrollment<'_>,anchor:&StartupEnrollment<'_>)->Result<Self,i32>{
  issuer.recheck().map_err(|_|UNKNOWN)?;anchor.recheck().map_err(|_|UNKNOWN)?;
  if issuer.registration.administration_domain==anchor.registration.administration_domain{return Err(BOUND)}
  let domain=|e:&StartupEnrollment<'_>|->Result<Domain,i32>{Ok(Domain{endpoint:e.registration.protected_service_endpoint.clone(),spki:e.registration.protected_service_spki_digest.clone(),registration:e.raw_digest(),floor:e.floor().map_err(|_|BOUND)?,client:None,stage:ExchangeStage::New,completed:Vec::new(),ambiguous:None,recovery_started:false,remote:None,raw_response:None,observation:None,pending:None})};
  let hex=|value:&str|->Result<[u8;32],i32>{let raw=value.as_bytes();if raw.len()!=64{return Err(BOUND)}let mut out=[0;32];for(n,b)in out.iter_mut().enumerate(){let nibble=|c:u8|match c{b'0'..=b'9'=>Ok(c-b'0'),b'a'..=b'f'=>Ok(c-b'a'+10),_=>Err(BOUND)};*b=nibble(raw[2*n])?*16+nibble(raw[2*n+1])?;}Ok(out)};
  Ok(Self{domains:[domain(issuer)?,domain(anchor)?],source_credentials:[hex(&issuer.registration.credential_digest)?,hex(&anchor.registration.credential_digest)?],source_enrollments:[hex(&issuer.raw_digest())?,hex(&anchor.raw_digest())?],thread:thread::current().id(),first:0,unknown:false,closed:false,local:PhantomData})
 }
 fn local(&self)->Result<(),i32>{if self.thread!=thread::current().id()||self.closed{Err(UNKNOWN)}else{Ok(())}}
 fn fail(&mut self,s:i32,uncertain:bool)->i32{if self.first==0{self.first=s}self.unknown|=uncertain;if self.unknown{UNKNOWN}else{s}}
 /// Local custody readiness is not permission to enter, sign or retire.
 /// Recheck both actual transport owners without replacing a captured window
 /// or consuming an operation's independently held once/floor authority.
 pub(crate) fn custody_current(&mut self)->i32{
  if self.local().is_err()||self.unknown{return UNKNOWN}
  for role in 0..2{
   let domain=&mut self.domains[role];
   if domain.ambiguous.is_some()||
    domain.remote.as_ref().is_some_and(|original|original.response.is_empty()||original.start.elapsed()>=original.budget)||
    domain.pending.as_ref().is_some_and(|pending|pending.start.elapsed()>=pending.budget){return self.fail(UNKNOWN,true)}
   let Some(client)=domain.client.as_mut()else{return REQUIRED};
   if let Err(cause)=client.current(){return self.fail(cause,true)}
  }
  0
 }
 pub(crate) fn admission_status(&mut self)->i32{
  if self.local().is_err()||self.unknown{return UNKNOWN}
  for d in &mut self.domains{
   if let Some(original)=d.remote.as_ref(){
    // Current checks the genuine local transport owner, exact held originals
    // and captured operation budget. These checks still do not adjudicate an
    // independent remote floor or publish local effect permission.
    if original.response.is_empty()||original.start.elapsed()>=original.budget{return self.fail(UNKNOWN,true)}
    let Some(client)=d.client.as_mut()else{return REQUIRED};
    if let Err(status)=client.current(){return self.fail(status,true)}
   }
  }
  // Even complete public observations do not supply the registered protected
  // transport-client owner, locked storage-key borrow or joint effect fence.
  REQUIRED
 }
 /// Called before dispatch, never after effect. The same exact request is held
 /// on ambiguity; callers cannot renew the window or issue a second request.
 pub(crate) fn begin(&mut self,role:usize,request:Request,budget:Duration)->Result<&[u8],i32>{
  self.local()?;if role>=2||budget.is_zero()||budget>Duration::from_secs(30){return Err(BOUND)}
  // Capture monotonic time before signed remaining-time calculation; response
  // remaining is only an observation and never renews this captured window.
  let start=Instant::now();let mut fields=Reader{raw:&request.raw[REQUEST_HEADER..],at:0};let original=Constraints::read(&mut fields)?;
  let at=u64::try_from(crate::source_evidence::now_ms().map_err(|_|UNKNOWN)?).map_err(|_|UNKNOWN)?;
  if at<original.issued||at>=original.expires{return Err(UNKNOWN)}
  let mut fixed_budget=budget.min(Duration::from_millis(original.expires-at));
  if self.unknown&&request.action!=Action::QueryClose{return Err(UNKNOWN)}
  let d=&mut self.domains[role];
  if d.completed.len()>=16||d.completed.iter().any(|c|c.request.id==request.id)||d.completed.first().is_some_and(|c|c.observation.original!=original){return Err(BOUND)}
  if request.owner!=d.remote.as_ref().map(|p|p.reference).unwrap_or([0;32]){return Err(BOUND)}
  if let Some(owner)=d.remote.as_ref(){
   if !owner.matches(&request){return Err(BOUND)}
   // A completed/current exchange stays inside the SAME first acquisition
   // window. Signed wall time and a fresh HTTP timeout cannot renew it.
   // QueryClose is cleanup-only; preserve its existing bounded recovery path
   // without clearing UNKNOWN or turning that observation into permission.
   if request.action!=Action::QueryClose{
    let Some(remaining)=owner.budget.checked_sub(owner.start.elapsed()).filter(|n|!n.is_zero())
     else{
      if self.first==0{self.first=UNKNOWN}self.unknown=true;
      return Err(UNKNOWN)
     };
    fixed_budget=fixed_budget.min(remaining);
   }
  }
  // An ambiguous Acquire may already have returned a cleanup reference. Query
  // may observe that original; it still cannot advance or create admission.
  if !(self.unknown&&request.action==Action::QueryClose&&d.remote.as_ref().map(|p|p.reference).unwrap_or([0;32])!=[0;32]){next_exchange(d.stage,&request)?;}
  // Query the retained intent once; never replay the ambiguous action. Keep
  // its exact request and partial response before installing recovery work.
  if let Some(prior)=d.pending.as_ref(){
   if !self.unknown||request.action!=Action::QueryClose||d.recovery_started||d.ambiguous.is_some()||d.remote.as_ref().map(|p|p.reference).unwrap_or([0;32])==[0;32]{return Err(UNKNOWN)}
   let mut fields=Reader{raw:&prior.request.raw[REQUEST_HEADER..],at:0};
   if Constraints::read(&mut fields)?!=original||prior.request.id==request.id{return Err(BOUND)}
   d.ambiguous=Some(Ambiguous{pending:d.pending.take().ok_or(UNKNOWN)?,raw:d.raw_response.take(),observation:d.observation.take()});
   d.recovery_started=true;
  }else if self.unknown{
   if request.action!=Action::QueryClose||d.recovery_started||d.remote.as_ref().map(|p|p.reference).unwrap_or([0;32])==[0;32]{return Err(UNKNOWN)}
   d.recovery_started=true;
  }
  d.pending=Some(Pending{request,start,budget:fixed_budget});Ok(d.pending.as_ref().ok_or(UNKNOWN)?.request.bytes())
 }
 /// Adopt response custody on BOTH successful and refused exchanges. A full
 /// header must match the captured request before a non-null cleanup reference
 /// is recognized. This never parses an OK observation or grants admission.
 fn hold_response(&mut self,role:usize,raw:&[u8])->Result<(Action,u32,usize),i32>{
  self.local()?;if role>=2||raw.len()>MAX+RESPONSE_HEADER{return Err(BOUND)}
  let d=&mut self.domains[role];if d.raw_response.is_some(){return Err(UNKNOWN)}
  let pending=d.pending.as_ref().ok_or(UNKNOWN)?;
  // Preserve even short/malformed partial bytes before classifying refusal.
  d.raw_response=Some(Zeroizing::new(raw.to_vec()));
  if raw.len()<RESPONSE_HEADER{return Err(BOUND)}
  let mut r=Reader{raw,at:0};if r.take(8)?!=MAGIC||r.u16()?!=1{return Err(BOUND)}
  let action=Action::parse(r.u16()?)?;let id=r.array::<32>()?;let reference=r.array::<32>()?;
  let status=r.u32()?;let size=usize::try_from(r.u32()?).map_err(|_|BOUND)?;
  if size>MAX||size!=raw.len()-RESPONSE_HEADER||action!=pending.request.action||id!=pending.request.id{return Err(BOUND)}
  if !matches!(status,0..=9){return Err(UNKNOWN)}
  // Never replace an exact retained original with an unrelated remote owner.
  if reference!=[0;32]{
   if let Some(owner)=d.remote.as_ref(){if owner.reference!=reference||!owner.matches(&pending.request){return Err(UNKNOWN)}}
   else{d.remote=Some(RemoteOriginal::adopt(reference,pending,raw)?);}
  }
  Ok((action,status,size))
 }
 /// All raw output is retained before late checks. No observed OK can clear
 /// uncertainty, return a new capability, or reclassify an entered operation.
 pub(crate) fn receive(&mut self,role:usize,raw:&[u8],expected:&Constraints)->Result<(),i32>{
  let result=(||{
   let(action,status,size)=self.hold_response(role,raw)?;
   let d=&mut self.domains[role];let pending=d.pending.as_ref().ok_or(UNKNOWN)?;
   if pending.start.elapsed()>=pending.budget{return Err(UNKNOWN)}
   if status!=0{return Err(status as i32)}
   if d.remote.as_ref().map(|p|p.reference).unwrap_or([0;32])==[0;32]{return Err(UNKNOWN)}
   let mut original_fields=Reader{raw:&pending.request.raw[REQUEST_HEADER..],at:0};
   if Constraints::read(&mut original_fields)?!=*expected{return Err(BOUND)}
   let mut r=Reader{raw:&raw[RESPONSE_HEADER..],at:0};
   let observation=Observation::parse(r.take(size)?,action,expected,(role+1)as u32)?;r.done()?;
   // Store the parsed original before any late refusal. It remains DATA;
   // neither this bound nor a response floor becomes an enforcing owner.
   d.observation=Some(observation);
   // Completion/current may advance the observed floor beyond enrollment.
   // Never accept a later replay merely because it exceeds the old base.
   // This per-domain high-water bound is deny-only, not floor qualification.
   let retained_floor=d.completed.iter().map(|c|c.observation.floor).fold(d.floor,u64::max);
   if d.observation.as_ref().ok_or(UNKNOWN)?.floor<retained_floor{return Err(UNKNOWN)}
   pending.request.match_retirement_response(d.observation.as_ref().ok_or(UNKNOWN)?)?;
   // Retained evidence still needs original verifier + actual named protection
   // and shared current/revoke fence. Do not publish admission here.
   Ok(())
  })();
  match result{Ok(())=>Ok(()),Err(s)=>{
   // Required is not an unentered retry when an exact remote partial owner
   // exists. Keep its first cause, but expose UNKNOWN and allow QueryClose.
   let partial=self.domains.get(role).is_some_and(|d|d.remote.is_some());
   Err(self.fail(s,s!=REQUIRED||partial))
  }}
 }
 /// Called only by the fixed Native startup loader, never the public fact tree.
 /// Primitive custody is retained even if acquisition fails. It does not set
 /// admission_status or bypass actual registered association/joint fence.
 pub(crate) fn retain_client(&mut self,role:usize,client:crate::source_infrastructure::MessageTransportClient)->Result<(),i32>{
  self.retain_client_preserving(role,client).map_err(|(status,_)|status)
 }
 /// A failed transfer must return the very same physical client to its caller.
 pub(crate) fn retain_client_preserving(&mut self,role:usize,client:crate::source_infrastructure::MessageTransportClient)->Result<(),(i32,crate::source_infrastructure::MessageTransportClient)>{
  if let Err(status)=self.local(){return Err((status,client))}if role>=2{return Err((BOUND,client))}
  let d=&mut self.domains[role];if d.client.is_some()||d.pending.is_some(){return Err((UNKNOWN,client))}
  d.client=Some(client);Ok(())
 }
 /// Normal fixed-domain dispatcher. DNS/connect uses only the authenticated
 /// original endpoint. This runs OUTSIDE the synchronous local SQL effect.
 pub(crate) fn dispatch(&mut self,role:usize,request:Request,expected:&Constraints,budget:Duration)->Result<(),i32>{
  self.local()?;if role>=2{return Err(BOUND)}
  if self.domains[role].client.is_none(){return Err(REQUIRED)}
  // Original authenticated Source selection, not wire-provided Expected:
  // both credential + enrollment originals must match the held startup.
  if expected.digests[1]!=self.source_credentials[0]||expected.digests[2]!=self.source_credentials[1]||expected.digests[3]!=self.source_enrollments[0]||expected.digests[4]!=self.source_enrollments[1]{return Err(BOUND)}
  // No owner/effect is transferred to the DNS worker: hostname is PUBLIC.
  let endpoint=self.domains[role].endpoint.strip_prefix("https://").ok_or(BOUND)?;
  let(authority,path)=endpoint.split_once('/').map(|(a,p)|(a,format!("/{p}"))).unwrap_or((endpoint,"/".into()));
  let(host,port)=if let Some((h,p))=authority.split_once(':'){let port=p.parse::<u16>().map_err(|_|BOUND)?;if port==0||port.to_string()!=p{return Err(BOUND)}(h,port)}else{(authority,443)};
  if host.is_empty()||host.len()>253||!host.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||matches!(b,b'.'|b'-'))||path.len()>2048||path.bytes().any(|b|b<=32||b>=127||matches!(b,b'#'|b'\\')){return Err(BOUND)}
  let host=host.to_owned();let host_c=std::ffi::CString::new(host.as_bytes()).map_err(|_|BOUND)?;
  let path=std::ffi::CString::new(path).map_err(|_|BOUND)?;
  let mut spki=[0;32];let encoded=self.domains[role].spki.as_bytes();
  if encoded.len()!=64{return Err(BOUND)}
  for(n,out)in spki.iter_mut().enumerate(){let hex=|c:u8|->Result<u8,i32>{match c{b'0'..=b'9'=>Ok(c-b'0'),b'a'..=b'f'=>Ok(c-b'a'+10),_=>Err(BOUND)}};*out=hex(encoded[2*n])?*16+hex(encoded[2*n+1])?;}
  self.begin(role,request,budget)?;
  let work=(||{
   let pending=self.domains[role].pending.as_ref().ok_or(UNKNOWN)?;
   let remaining=||pending.budget.checked_sub(pending.start.elapsed()).filter(|d|!d.is_zero()).ok_or(UNKNOWN);
   let captured=crate::source_infrastructure::message_monotonic_ns().map_err(|_|UNKNOWN)?;
   let fixed=remaining()?;let deadline=captured.checked_add(u64::try_from(fixed.as_nanos()).map_err(|_|BOUND)?).ok_or(BOUND)?;
   let(tx,rx)=std::sync::mpsc::sync_channel(1);
   std::thread::spawn(move||{use std::net::ToSocketAddrs;let peer=(host.as_str(),port).to_socket_addrs().map_err(|_|UNKNOWN).and_then(|mut v|v.next().ok_or(UNKNOWN));let _=tx.send(peer);});
   let peer=rx.recv_timeout(remaining()?).map_err(|_|UNKNOWN)??;
   // Exactly one selected peer, no redirect/fallback/replay or renewed timeout.
   let stream=std::net::TcpStream::connect_timeout(&peer,remaining()?).map_err(|_|UNKNOWN)?;
   let request=Zeroizing::new(pending.request.bytes().to_vec());
   let mut response=Zeroizing::new(vec![0;MAX+RESPONSE_HEADER]);
   let client=self.domains[role].client.as_mut().ok_or(REQUIRED)?;
   let(result,written)=client.exchange(stream,&host_c,&path,&spki,deadline,&request,&mut response);
   response.truncate(written);
   // Partial body is held BEFORE error/current/format classification. It must
   // never be replaced by another request or recomputed after ambiguity.
   if let Err(status)=result{
    // The transport refusal is the FIRST cause even if its retained partial
    // frame is malformed. Exchange may have entered remotely: never replay.
    let failure=self.fail(status,true);
    if !response.is_empty(){let _=self.hold_response(role,&response);}
    return Err(failure)
   }
   self.receive(role,&response,expected)?;
   // Keep request/response/observation before releasing TLS exchange buffers.
   self.finish_received(role)
  })();
  match work{Ok(())=>Ok(()),Err(st)=>Err(self.fail(st,st!=REQUIRED))}
 }
 /// Release transport buffers only AFTER complete original response adoption.
 /// Remote reference/terminal uncertainty is retained, never implicitly retired.
 fn finish_received(&mut self,role:usize)->Result<(),i32>{
  self.local()?;let d=self.domains.get_mut(role).ok_or(BOUND)?;
  let pending=d.pending.as_ref().ok_or(UNKNOWN)?;
  if pending.start.elapsed()>=pending.budget||d.raw_response.is_none()||d.observation.is_none(){return Err(UNKNOWN)}
  let next=if self.unknown&&pending.request.action==Action::QueryClose{d.stage}else{next_exchange(d.stage,&pending.request)?};
  d.completed.try_reserve_exact(1).map_err(|_|BOUND)?;
  d.client.as_mut().ok_or(REQUIRED)?.complete_response()?;
  // Buffer release may cross the original deadline. Keep this exact pending
  // request/raw response/observation on a late failure; never advance Retired
  // or manufacture a fresh request to recover it. The dispatcher latches it.
  if pending.start.elapsed()>=pending.budget{return Err(UNKNOWN)}
  let completed=Completed{request:d.pending.take().ok_or(UNKNOWN)?.request,raw:d.raw_response.take().ok_or(UNKNOWN)?,observation:d.observation.take().ok_or(UNKNOWN)?};
  d.completed.push(completed);d.stage=next;Ok(())
 }
 /// Only an unused, same-thread transport custodian can parent a normal core
 /// initialization. This predicate grants no role, signing or device rights.
 pub(crate) fn can_attach_core(&self)->bool{
  self.local().is_ok()&&!self.unknown&&self.first==0&&self.domains.iter().all(|d|
   d.stage==ExchangeStage::New&&d.completed.is_empty()&&d.pending.is_none()&&
   d.remote.is_none()&&d.ambiguous.is_none()&&d.raw_response.is_none()&&
   d.observation.is_none()&&!d.recovery_started)
 }
 pub(crate) fn action_status(&mut self,action:i32)->i32{if !(0..=9).contains(&action){return BOUND}self.admission_status()}
 /// After true resource cleanup, local no-dispatch custody may be released.
 /// A retained remote owner or ambiguous dispatch requires actual close/query;
 /// merely dropping a buffer or receiving status0 cannot dispose that owner.
 pub(crate) fn first_failure(&self)->i32{self.first}
 pub(crate) fn close_local(&mut self)->Result<(),i32>{
  if self.thread!=thread::current().id(){return Err(UNKNOWN)}if self.closed{return Ok(())}
  if self.domains.iter().any(|d|d.remote.as_ref().map(|p|p.reference).unwrap_or([0;32])!=[0;32]||d.pending.is_some()){return Err(self.fail(UNKNOWN,true))}
  for role in 0..2{
   let result=match self.domains[role].client.as_mut(){Some(client)=>client.close(),None=>Ok(())};
   if let Err(cause)=result{return Err(self.fail(cause,true))}
   self.domains[role].client=None;
  }
  self.closed=true;Ok(())
 }
}




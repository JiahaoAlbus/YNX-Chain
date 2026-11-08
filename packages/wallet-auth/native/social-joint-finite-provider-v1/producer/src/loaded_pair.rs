//! Mechanically inherited original unseal/Signal+MLDSA87 primitive. QA approval TYPE
//! and path removed: only recognized normal entered PlanHold may reach it.
//! Reload ORIGINAL same-UID sealed pair. No generation, private serialization
//! export, alternative primitive/TPM cast or generic caller key exists here.
use crate::plan::NormalQualifiedFrame;
use base64::{Engine as _,engine::general_purpose::URL_SAFE_NO_PAD as B64};
use sha2::{Digest,Sha256};use serde::{Deserialize,Serialize};use libsignal_protocol::IdentityKeyPair;
use rand::TryRngCore as _;use zeroize::Zeroizing;
use std::{fs::File,io::Read,os::{fd::{AsRawFd,FromRawFd},unix::fs::MetadataExt},ffi::CString,marker::PhantomData,rc::Rc,mem::ManuallyDrop};
#[repr(C)]pub(crate)struct PqRecord{version:u32,aad_size:u32,aad:[u8;7168],nonce:[u8;12],cipher:[u8;4912]}
#[repr(C)]pub(crate)struct ClassicRecord{version:u32,aad_size:u32,cipher_size:u32,aad:[u8;7168],nonce:[u8;12],cipher:[u8;272]}
#[repr(C)]struct Binding{alias:*const libc::c_char,generation:u64,classic:*const u8,association:*const u8,association_size:usize}
#[repr(C)]struct Wrapping{_private:[u8;0]}
#[repr(C)]struct Pq{_private:[u8;0]}
unsafe extern "C"{
 fn ynx_source_qa_dedicated_protection_enter_v1()->i32;
 fn ynx_source_qa_dedicated_protection_current_v1()->i32;
 fn ynx_source_wrapping_open(fd:i32,out:*mut *mut Wrapping)->i32;
 fn ynx_source_wrapping_current(p:*mut Wrapping)->i32;
 fn ynx_source_wrapping_close(p:*mut *mut Wrapping)->i32;
 fn ynx_source_reload_records(p:*mut Wrapping,b:*const Binding,pk:*const u8,q:*const PqRecord,c:*const ClassicRecord,clear:*mut u8,n:*mut usize,out:*mut *mut Pq)->i32;
 fn veil_own_public(p:*const Pq,out:*mut u8)->i32;
 fn veil_own_close(p:*mut *mut Pq)->i32;
 fn veil_own_sign_public_proof(p:*const Pq,message:*const u8,n:usize,out:*mut u8,written:*mut usize)->i32;
 fn own_selected_verify(pk:*const u8,pn:usize,message:*const u8,n:usize,sig:*const u8,sn:usize)->i32;
 fn veil_own_aad(b:*const Binding,pk:*const u8,out:*mut u8,n:*mut usize)->i32;
 fn veil_classic_aad(b:*const Binding,pk:*const u8,clear:usize,out:*mut u8,n:*mut usize)->i32;
}
#[derive(Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct CipherRecord{version:u32,aad:String,nonce:String,ciphertext:String}
#[derive(Deserialize,Serialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct CipherBundle{version:u32,role:String,alias:String,storage_generation:u64,custodian:String,classic_public:String,pq_public:String,pq:CipherRecord,classic:CipherRecord}
fn decoded(s:&str,min:usize,max:usize)->Result<Vec<u8>,i32>{if s.len()>((max+2)/3)*4{return Err(2)}let b=B64.decode(s).map_err(|_|2)?;if b.len()<min||b.len()>max||B64.encode(&b)!=s{return Err(2)}Ok(b)}
fn same(a:&std::fs::Metadata,b:&std::fs::Metadata)->bool{a.dev()==b.dev()&&a.ino()==b.ino()&&a.uid()==b.uid()&&a.gid()==b.gid()&&a.mode()==b.mode()&&a.nlink()==b.nlink()&&a.len()==b.len()&&a.mtime()==b.mtime()&&a.mtime_nsec()==b.mtime_nsec()&&a.ctime()==b.ctime()&&a.ctime_nsec()==b.ctime_nsec()}
pub(crate)struct NormalLoadedPair{
 classic_public:[u8;33],pq_public:[u8;2592],classic:Option<IdentityKeyPair>,
 wrap:*mut Wrapping,pq:*mut Pq,wrapping:Option<ManuallyDrop<File>>,wrapping_before:Option<std::fs::Metadata>,
 sealed:Option<ManuallyDrop<File>>,sealed_before:Option<std::fs::Metadata>,
 entered:bool,retired:bool,close_unknown:bool,first:i32,local:PhantomData<Rc<()>>,
 original_plan:*const NormalQualifiedFrame,
 pub(crate)classic_signature:Vec<u8>,pub(crate)pq_signature:Vec<u8>,
}
impl NormalLoadedPair{
 pub(crate)fn load(plan:&NormalQualifiedFrame)->Result<Self,(i32,Self)>{
  let mut out=Self{classic_public:[0;33],pq_public:[0;2592],classic:None,wrap:std::ptr::null_mut(),pq:std::ptr::null_mut(),wrapping:None,wrapping_before:None,sealed:None,sealed_before:None,entered:false,retired:false,close_unknown:false,first:0,local:PhantomData,original_plan:plan,classic_signature:Vec::new(),pq_signature:Vec::new()};
  let work=(||->Result<(),i32>{
   // Dedicated process protection BEFORE wrapping/key open/private unseal.
   let p=unsafe{ynx_source_qa_dedicated_protection_enter_v1()};if p!=0{return Err(p)}plan.current().map_err(|_|7)?;
   let(r,uid,gid,storage_role)=plan.role_tuple();
   let fixed=|name:&std::ffi::CStr|->Result<File,i32>{let fd=unsafe{libc::openat(plan.directory.as_raw_fd(),name.as_ptr(),libc::O_RDONLY|libc::O_NOFOLLOW|libc::O_CLOEXEC)};if fd<0{return Err(4)}Ok(unsafe{File::from_raw_fd(fd)})};
   out.sealed=Some(ManuallyDrop::new(fixed(c"sealed-records.json")?));let sealed=out.sealed.as_mut().unwrap();let sm=sealed.metadata().map_err(|_|7)?;if !sm.is_file()||sm.uid()!=uid||sm.gid()!=gid||sm.nlink()!=1||sm.mode()&0o777!=0o600||sm.len()==0||sm.len()>65536{return Err(7)}let mut raw=Vec::new();Read::by_ref(&mut **sealed).take(65537).read_to_end(&mut raw).map_err(|_|7)?;if raw.len()>65536||<[u8;32]>::from(Sha256::digest(&raw))!=plan.bundle_sha256||!same(&sm,&sealed.metadata().map_err(|_|7)?){return Err(7)}
   let bundle:CipherBundle=serde_json::from_slice(&raw).map_err(|_|2)?;
   if serde_json::to_vec(&bundle).map_err(|_|2)?!=raw||bundle.version!=1||bundle.role!=r||bundle.alias!=plan.alias()||bundle.storage_generation!=plan.generation()||bundle.custodian!=plan.custodian()||bundle.pq.version!=1||bundle.classic.version!=1{return Err(7)}
   let(pk,qk)=plan.public().map_err(|_|7)?;if decoded(&bundle.classic_public,33,33)?.as_slice()!=pk||decoded(&bundle.pq_public,2592,2592)?.as_slice()!=qk{return Err(7)}out.classic_public=pk;out.pq_public=qk;
   let qa=decoded(&bundle.pq.aad,1,7168)?;let ca=decoded(&bundle.classic.aad,1,7168)?;let qn=decoded(&bundle.pq.nonce,12,12)?;let cn=decoded(&bundle.classic.nonce,12,12)?;let qc=decoded(&bundle.pq.ciphertext,4912,4912)?;let cc=decoded(&bundle.classic.ciphertext,17,272)?;
   let alias=CString::new(plan.alias()).map_err(|_|2)?;let mut association=b"YNX/SOCIAL/INFRASTRUCTURE/V1\0".to_vec();association.push(storage_role);association.extend((plan.custodian().len()as u32).to_be_bytes());association.extend(plan.custodian().as_bytes());
   let binding=Binding{alias:alias.as_ptr(),generation:plan.generation(),classic:pk.as_ptr(),association:association.as_ptr(),association_size:association.len()};
   let mut expected_q=[0u8;7168];let mut expected_c=[0u8;7168];let(mut qsize,mut csize)=(0,0);
   if unsafe{veil_own_aad(&binding,qk.as_ptr(),expected_q.as_mut_ptr(),&mut qsize)}!=0||unsafe{veil_classic_aad(&binding,qk.as_ptr(),cc.len()-16,expected_c.as_mut_ptr(),&mut csize)}!=0||qsize>7168||csize>7168||qa!=expected_q[..qsize]||ca!=expected_c[..csize]{return Err(7)}
   let mut q=Box::new(PqRecord{version:1,aad_size:qsize as u32,aad:[0;7168],nonce:[0;12],cipher:[0;4912]});let mut c=Box::new(ClassicRecord{version:1,aad_size:csize as u32,cipher_size:cc.len()as u32,aad:[0;7168],nonce:[0;12],cipher:[0;272]});q.aad[..qsize].copy_from_slice(&qa);q.nonce.copy_from_slice(&qn);q.cipher.copy_from_slice(&qc);c.aad[..csize].copy_from_slice(&ca);c.nonce.copy_from_slice(&cn);c.cipher[..cc.len()].copy_from_slice(&cc);
   out.sealed_before=Some(sm);
   out.wrapping=Some(ManuallyDrop::new(fixed(c"wrapping.key")?));let wm=out.wrapping.as_ref().unwrap().metadata().map_err(|_|7)?;if !wm.is_file()||wm.uid()!=uid||wm.gid()!=gid||wm.nlink()!=1||wm.mode()&0o777!=0o600||wm.len()!=32{return Err(7)}out.wrapping_before=Some(wm);
   plan.current().map_err(|_|7)?;
   let s=unsafe{ynx_source_wrapping_open(out.wrapping.as_ref().unwrap().as_raw_fd(),&mut out.wrap)};if s!=0{return Err(s)}
   let mut clear=Zeroizing::new([0u8;256]);let mut n=0;let s=unsafe{ynx_source_reload_records(out.wrap,&binding,qk.as_ptr(),&*q,&*c,clear.as_mut_ptr(),&mut n,&mut out.pq)};if s!=0{return Err(s)}if n==0||n>clear.len(){return Err(7)}
   let selected=IdentityKeyPair::try_from(&clear[..n]).map_err(|_|7)?;let canonical=Zeroizing::new(selected.serialize().into_vec());if canonical.as_slice()!=&clear[..n]||selected.public_key().serialize().as_ref()!=pk||selected.private_key().public_key().ok().as_ref()!=Some(selected.public_key()){return Err(7)}out.classic=Some(selected);let mut actual=[0u8;2592];if unsafe{veil_own_public(out.pq,actual.as_mut_ptr())}!=0||actual!=qk{return Err(7)}out.current(plan)
  })();match work{Ok(())=>Ok(out),Err(e)=>{out.first=e;out.retired=true;Err((e,out))}}
 }
 pub(crate)fn current(&self,plan:&NormalQualifiedFrame)->Result<(),i32>{
  if !std::ptr::eq(self.original_plan,plan)||self.retired||self.close_unknown||self.first!=0||self.wrap.is_null()||self.pq.is_null()||self.classic.is_none(){return Err(if self.first!=0{self.first}else{4})}plan.current().map_err(|_|7)?;if unsafe{ynx_source_qa_dedicated_protection_current_v1()}!=0{return Err(7)}
  for(name,held,before)in[("wrapping.key",self.wrapping.as_ref().map(|v|&**v),self.wrapping_before.as_ref()),("sealed-records.json",self.sealed.as_ref().map(|v|&**v),self.sealed_before.as_ref())]{let h=held.ok_or(4)?.metadata().map_err(|_|7)?;let b=before.ok_or(4)?;let named=plan.named_metadata(name)?;if named.file_type().is_symlink()||!same(b,&h)||!same(b,&named){return Err(7)}}let s=unsafe{ynx_source_wrapping_current(self.wrap)};if s!=0{return Err(s)}Ok(())
 }
 pub(crate)fn sign_once(&mut self,plan:&NormalQualifiedFrame,journal:&mut crate::journal::Journal)->Result<(),i32>{
  if self.entered{return Err(if self.first!=0{self.first}else{13})}self.current(plan)?;self.entered=true;
  let result=(||->Result<(),i32>{let message=plan.frame.frame();let key=self.classic.as_ref().ok_or(4)?;let signature=key.private_key().calculate_signature(message,&mut rand::rngs::OsRng.unwrap_err()).map_err(|_|16)?;self.classic_signature=signature.to_vec();let raw=plan.frame.envelope(&self.classic_signature,&[]).map_err(|_|2)?;journal.retain_classic(&raw).map_err(|_|16)?;if self.classic_signature.len()!=64||!key.public_key().verify_signature(message,&self.classic_signature){return Err(7)}self.current(plan)?;
   let mut signature=[0u8;4627];let mut n=0;let s=unsafe{veil_own_sign_public_proof(self.pq,message.as_ptr(),message.len(),signature.as_mut_ptr(),&mut n)};if n>signature.len(){return Err(2)}self.pq_signature=signature[..n].to_vec();let raw=plan.frame.envelope(&self.classic_signature,&self.pq_signature).map_err(|_|2)?;journal.retain_pair(&raw).map_err(|_|16)?;if s!=0{return Err(s)}if n!=4627||unsafe{own_selected_verify(self.pq_public.as_ptr(),2592,message.as_ptr(),message.len(),self.pq_signature.as_ptr(),self.pq_signature.len())}!=1{return Err(7)}self.current(plan)
  })();if let Err(e)=result{if self.first==0{self.first=e}self.retired=true;}result
 }
 pub(crate)fn close(&mut self)->Result<(),i32>{
  self.retired=true;self.classic=None;if self.close_unknown{return Err(if self.first!=0{self.first}else{16})}
  if !self.pq.is_null(){let s=unsafe{veil_own_close(&mut self.pq)};if !self.pq.is_null(){if self.first==0{self.first=if s!=0{s}else{16}}return Err(self.first)}if s!=0&&self.first==0{self.first=s}}
  if !self.wrap.is_null(){let s=unsafe{ynx_source_wrapping_close(&mut self.wrap)};if !self.wrap.is_null(){if self.first==0{self.first=if s!=0{s}else{16}}return Err(self.first)}if s!=0&&self.first==0{self.first=s}}
  for file in [&mut self.wrapping,&mut self.sealed]{if let Some(file)=file.take(){let fd=file.as_raw_fd();if unsafe{libc::close(fd)}!=0{self.close_unknown=true;if self.first==0{self.first=16}return Err(self.first)}}}if self.first==0{Ok(())}else{Err(self.first)}
 }
 pub(crate)fn has_debt(&self)->bool{!self.pq.is_null()||!self.wrap.is_null()||self.wrapping.is_some()||self.sealed.is_some()||self.close_unknown}
}
impl Drop for NormalLoadedPair{fn drop(&mut self){if self.has_debt(){std::process::abort()}}}
const _:()={assert!(std::mem::size_of::<PqRecord>()==12100);assert!(std::mem::size_of::<ClassicRecord>()==7464);assert!(std::mem::size_of::<Binding>()==40);};


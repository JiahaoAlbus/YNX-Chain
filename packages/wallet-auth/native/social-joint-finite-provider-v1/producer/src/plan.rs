//! Strong C++ inventory-backed NORMAL plan. No constructor from JSON/flags.
use std::{ffi::c_void,fs::File,os::{fd::{FromRawFd,AsRawFd},unix::fs::MetadataExt},marker::PhantomData,rc::Rc,mem::ManuallyDrop};
#[repr(C)]#[derive(Clone,Copy)]pub(crate)struct Status{pub version:u32,pub size:u32,pub error_present:u32,pub first:i32,pub done:u32,pub unknown:u32}
impl Default for Status{fn default()->Self{Self{version:0,size:0,error_present:0,first:0,done:0,unknown:0}}}
impl Status{pub(crate)fn result(&self)->Result<(),i32>{if self.version!=1||self.size!=24||self.error_present>1||self.done>1||self.unknown>1||self.error_present==0&&self.first!=0{return Err(8)}if self.error_present!=0||self.unknown!=0{return Err(self.first)}Ok(())}}
#[repr(C)]#[derive(Clone,Copy)]struct Span{data:*const u8,size:usize}
#[repr(C)]struct View{version:u32,size:u32,role:u32,uid:u32,gid:u32,reserved:u32,dir:i32,reserved_fd:i32,generation:u64,classic:[u8;33],pq:[u8;2592],bundle:[u8;32],alias:Span,custodian:Span,body:Span,frame:Span,journal:*mut c_void}
unsafe extern "C"{
 fn ynx_social_finite_joint_plan_hold_open_v1(p:*mut c_void,out:*mut *mut c_void,s:*mut Status);
 fn ynx_social_finite_joint_plan_current_v1(p:*mut c_void,s:*mut Status);
 fn ynx_social_finite_joint_plan_view_v1_copy(p:*mut c_void,v:*mut View,s:*mut Status);
 fn ynx_social_finite_joint_plan_hold_close_v1(p:*mut *mut c_void,s:*mut Status);
 fn ynx_auth_social_source_envelope_prepare_v1(role:*const u8,rn:usize,body:*const u8,bn:usize,classic:*const u8,cn:usize,pq:*const u8,pn:usize,out:*mut u8,cap:usize,n:*mut usize)->i32;
}
pub(crate)struct NormalFrame{role:&'static str,body:Vec<u8>,frame:Vec<u8>}
impl NormalFrame{pub(crate)fn frame(&self)->&[u8]{&self.frame}pub(crate)fn envelope(&self,c:&[u8],q:&[u8])->Result<Vec<u8>,()>{let mut out=vec![0;65536];let mut n=0;let status=unsafe{ynx_auth_social_source_envelope_prepare_v1(self.role.as_ptr(),self.role.len(),self.body.as_ptr(),self.body.len(),c.as_ptr(),c.len(),q.as_ptr(),q.len(),out.as_mut_ptr(),out.len(),&mut n)};if status!=0||n==0||n>out.len(){return Err(())}out.truncate(n);Ok(out)}}
pub(crate)struct NormalQualifiedFrame{hold:*mut c_void,pub(crate)directory:ManuallyDrop<File>,directory_closed:bool,uid:u32,gid:u32,role:u32,alias:String,custodian:String,generation:u64,classic:[u8;33],pq:[u8;2592],pub(crate)bundle_sha256:[u8;32],pub(crate)frame:NormalFrame,pub(crate)journal:*mut c_void,close_unknown:bool,local:PhantomData<Rc<()>>}
unsafe fn raw(s:Span,max:usize)->Result<Vec<u8>,i32>{if s.data.is_null()||s.size==0||s.size>max{return Err(2)}Ok(unsafe{std::slice::from_raw_parts(s.data,s.size)}.to_vec())}
impl NormalQualifiedFrame{
 pub(crate)unsafe fn from_existing_hold(hold:*mut c_void)->Result<Box<Self>,(i32,*mut c_void)>{if hold.is_null(){return Err((8,hold))}
  let result=(||{let mut v=std::mem::MaybeUninit::<View>::zeroed();let mut s=Status::default();unsafe{ynx_social_finite_joint_plan_view_v1_copy(hold,v.as_mut_ptr(),&mut s)};s.result()?;let v=unsafe{v.assume_init()};if v.version!=1||v.size as usize!=std::mem::size_of::<View>()||!matches!(v.role,1|2)||v.uid!=unsafe{libc::geteuid()}||v.gid!=unsafe{libc::getegid()}||v.reserved!=0||v.reserved_fd!=0||v.dir<0||v.generation==0||v.classic[0]!=5||v.journal.is_null(){return Err(7)}
   let alias=String::from_utf8(unsafe{raw(v.alias,128)}?).map_err(|_|2)?;let custodian=String::from_utf8(unsafe{raw(v.custodian,512)}?).map_err(|_|2)?;let body=unsafe{raw(v.body,32768)}?;let frame=unsafe{raw(v.frame,49152)}?;
   let fd=unsafe{libc::fcntl(v.dir,libc::F_DUPFD_CLOEXEC,3)};if fd<0{return Err(3)}let directory=ManuallyDrop::new(unsafe{File::from_raw_fd(fd)});let valid=directory.metadata().map(|m|m.is_dir()&&m.uid()==v.uid&&m.gid()==v.gid&&m.mode()&0o7777==0o700).unwrap_or(false);if !valid{if unsafe{libc::close(fd)}!=0{std::process::abort()}return Err(7)}
   Ok(Box::new(Self{hold,directory,directory_closed:false,uid:v.uid,gid:v.gid,role:v.role,alias,custodian,generation:v.generation,classic:v.classic,pq:v.pq,bundle_sha256:v.bundle,frame:NormalFrame{role:if v.role==1{"record-issuer"}else{"record-anchor"},body,frame},journal:v.journal,close_unknown:false,local:PhantomData}))})();result.map_err(|e|(e,hold))
 }
 pub(crate)fn current(&self)->Result<(),i32>{if self.close_unknown||self.hold.is_null(){return Err(8)}let mut s=Status::default();unsafe{ynx_social_finite_joint_plan_current_v1(self.hold,&mut s)};s.result()}
 pub(crate)fn role_tuple(&self)->(&'static str,u32,u32,u8){(self.role(),self.uid,self.gid,self.role as u8)}
 pub(crate)fn role(&self)->&'static str{if self.role==1{"issuer"}else{"anchor"}}
 pub(crate)fn alias(&self)->&str{&self.alias}pub(crate)fn generation(&self)->u64{self.generation}pub(crate)fn custodian(&self)->&str{&self.custodian}
 pub(crate)fn public(&self)->std::io::Result<([u8;33],[u8;2592])>{self.current().map_err(|_|std::io::Error::other("NORMAL_PLAN_CURRENT"))?;Ok((self.classic,self.pq))}
 pub(crate)fn named_metadata(&self,name:&str)->Result<std::fs::Metadata,i32>{let n=std::ffi::CString::new(name).map_err(|_|2)?;let fd=unsafe{libc::openat(self.directory.as_raw_fd(),n.as_ptr(),libc::O_RDONLY|libc::O_NOFOLLOW|libc::O_CLOEXEC|libc::O_NONBLOCK)};if fd<0{return Err(3)}let file=ManuallyDrop::new(unsafe{File::from_raw_fd(fd)});let result=file.metadata().map_err(|_|3);if unsafe{libc::close(fd)}!=0{std::process::abort()}result}
 pub(crate)fn close(&mut self)->(bool,i32){if self.close_unknown{return(false,8)}if !self.directory_closed{self.directory_closed=true;if unsafe{libc::close(self.directory.as_raw_fd())}!=0{self.close_unknown=true;return(false,8)}}if self.hold.is_null(){return(true,0)}let mut s=Status::default();unsafe{ynx_social_finite_joint_plan_hold_close_v1(&mut self.hold,&mut s)};let code=s.result().err().unwrap_or(0);if self.hold.is_null()&&s.done==1{(true,code)}else{self.close_unknown=true;(false,if code==0{8}else{code})}}
}
impl Drop for NormalQualifiedFrame{fn drop(&mut self){if !self.hold.is_null()||self.close_unknown{std::process::abort()}}}

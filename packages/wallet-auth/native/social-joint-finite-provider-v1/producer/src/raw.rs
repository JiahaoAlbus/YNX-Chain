use std::ffi::c_void;
#[repr(C)]#[derive(Clone,Copy)]pub(crate)struct Span{pub data:*const u8,pub size:usize}
impl Span{pub(crate)fn of(b:&[u8])->Self{Self{data:b.as_ptr(),size:b.len()}}}
#[repr(C)]#[derive(Clone,Copy,Debug,PartialEq,Eq,serde::Serialize,serde::Deserialize)]#[serde(deny_unknown_fields)]pub(crate)struct Status{pub version:u32,pub size:u32,pub present:u32,pub first:i32,pub done:u32,pub unknown:u32}
impl Default for Status{fn default()->Self{Self{version:0,size:0,present:0,first:0,done:0,unknown:0}}}
impl Status{pub(crate)fn ok()->Self{Self{version:1,size:24,present:0,first:0,done:0,unknown:0}}pub(crate)fn first_cause(mut self)->Self{self.done=0;self}pub(crate)fn error(c:i32)->Self{Self{present:1,first:c,..Self::ok()}}pub(crate)fn valid(&self)->bool{self.version==1&&self.size==24&&self.present<=1&&self.done<=1&&self.unknown<=1&&(self.present==1||self.first==0)}pub(crate)fn result(self)->Result<(),Self>{if !self.valid(){return Err(Self::error(8))}if self.present!=0||self.unknown!=0{Err(self)}else{Ok(())}}}
#[repr(C)]pub(crate)struct Request{pub version:u32,pub size:u32,pub source:[u8;32],pub binding:[u8;32],pub resource:[u8;32],pub role:u32,pub reserved:u32,pub originals:[Span;4],pub body:Span,pub frame:Span}
#[repr(C)]pub(crate)struct SourceInput{pub version:u32,pub size:u32,pub resource:[u8;32],pub originals:[Span;4],pub reference:u64}
#[repr(C)]pub(crate)struct Facts{pub version:u32,pub size:u32,pub role:u32,pub reserved:u32,pub epoch:u64,pub classic:[u8;33],pub pq:[u8;2592],pub scope:[u8;32],pub history:[u8;32],pub nonce:[u8;32],pub custodian:[u8;513],pub realm:[u8;129],pub client:[u8;129],pub network:[u8;129],pub header:[u8;65],pub not_before:i64,pub expires:i64}
unsafe extern "C"{
 pub(crate)fn finite_joint_composition_open(owner:u64,input:*mut SourceInput,id:*const u8,n:usize,out:*mut *mut c_void,s:*mut Status);
 pub(crate)fn finite_joint_composition_current(p:*mut c_void,s:*mut Status);
 pub(crate)fn finite_joint_composition_seal(p:*mut c_void,role:u32,body:Span,frame:Span,s:*mut Status);
 pub(crate)fn finite_joint_composition_join(p:*mut c_void,s:*mut Status);
 pub(crate)fn finite_joint_composition_close(p:*mut *mut c_void,s:*mut Status);
 pub(crate)fn ynx_auth_social_joint_provider_source_open_v1(input:*mut SourceInput,out:*mut u64,s:*mut Status);
 pub(crate)fn ynx_auth_social_joint_provider_source_reference_v1(owner:u64,out:*mut u64,s:*mut Status);
 pub(crate)fn ynx_auth_social_joint_provider_source_current_v1(owner:u64,s:*mut Status);
 pub(crate)fn ynx_auth_social_joint_provider_source_facts_v1(owner:u64,role:u32,out:*mut Facts,s:*mut Status);
 pub(crate)fn ynx_auth_social_joint_provider_source_seal_original_v1(owner:u64,source:*mut c_void,binding:*mut c_void,role:u32,body:Span,frame:Span,s:*mut Status);
 pub(crate)fn ynx_auth_social_joint_provider_source_close_v1(owner:*mut u64,s:*mut Status);
 pub(crate)fn ynx_social_joint_source_open_v1(input:*const SourceInput,out:*mut *mut c_void,s:*mut Status);
 pub(crate)fn ynx_social_joint_source_current_v1(source:*mut c_void,s:*mut Status);
 pub(crate)fn ynx_social_joint_source_close_v1(source:*mut *mut c_void,s:*mut Status);
 pub(crate)fn ynx_social_joint_binding_open_v1(source:*mut c_void,id:*const u8,n:usize,out:*mut *mut c_void,s:*mut Status);
 pub(crate)fn ynx_social_joint_binding_current_v1(binding:*mut c_void,s:*mut Status);
 pub(crate)fn ynx_social_joint_binding_close_v1(binding:*mut *mut c_void,s:*mut Status);
}
const _:()={assert!(std::mem::size_of::<Request>()==208);assert!(std::mem::size_of::<SourceInput>()==112);assert!(std::mem::size_of::<Status>()==24);};

use std::ffi::c_void;
unsafe extern "C"{fn finite_joint_journal_retain(p:*mut c_void,stage:u32,raw:*const u8,n:usize)->i32;}
pub(crate)struct Journal{pub(crate)original:*mut c_void}
impl Journal{pub(crate)fn retain_classic(&mut self,b:&[u8])->Result<(),std::io::Error>{self.stage(1,b)}pub(crate)fn retain_pair(&mut self,b:&[u8])->Result<(),std::io::Error>{self.stage(2,b)}fn stage(&mut self,s:u32,b:&[u8])->Result<(),std::io::Error>{if self.original.is_null()||b.is_empty()||b.len()>65536{return Err(std::io::Error::other("NORMAL_ORIGINAL_JOURNAL"))}let c=unsafe{finite_joint_journal_retain(self.original,s,b.as_ptr(),b.len())};if c==0{Ok(())}else{Err(std::io::Error::other("NORMAL_PARTIAL_RETAIN_UNKNOWN"))}}}

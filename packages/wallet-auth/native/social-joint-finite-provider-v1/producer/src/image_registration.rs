//! Held postbuild image registration, PUBLIC physical DATA only. This borrows
//! the sole qualifier's exact Root-record reader; no second approval codec.
//! Original Source/credential mathematical qualification is still mandatory.
use crate::{postbuild_qualification as q, registry::Resource};
use sha2::{Digest,Sha256};
use std::{fs::{self,File,Metadata,OpenOptions},os::{fd::AsRawFd,unix::fs::{MetadataExt,OpenOptionsExt,FileExt}},mem::ManuallyDrop,path::Path};

pub(crate) struct RegistrationLocator {
    pub parent:&'static str,pub device:u64,pub inode:u64,pub gid:u32,pub mode:u32,
    pub source_resource_id:&'static str,pub bootstrap:&'static str,pub scope_sha256:[u8;32],
}
impl RegistrationLocator{pub(crate)const UNSUPPLIED:Self=Self{parent:"",device:0,inode:0,gid:0,mode:0,source_resource_id:"",bootstrap:"",scope_sha256:[0;32]};}
struct Image {
    file:ManuallyDrop<File>,identity:Option<Metadata>,path:&'static str,digest:[u8;32],
    qualification:Option<q::HeldQualification>,close_selected:bool,closed:bool,
}
pub(crate) struct RegisteredImages {images:Vec<Image>,first:Option<i32>,first_close:Option<i32>}
pub(crate) struct Opened {pub owner:RegisteredImages,pub error:Option<i32>}
fn code(e:q::Error)->i32{match e{q::Error::Required=>1,q::Error::Shape=>2,q::Error::Changed=>7,q::Error::Thread=>4,q::Error::Unknown=>8}}
fn same(a:&Metadata,b:&Metadata)->bool{a.is_file()&&b.is_file()&&!b.file_type().is_symlink()&&a.dev()==b.dev()&&a.ino()==b.ino()&&a.uid()==b.uid()&&a.gid()==b.gid()&&a.mode()==b.mode()&&a.nlink()==b.nlink()&&a.len()==b.len()&&a.mtime()==b.mtime()&&a.mtime_nsec()==b.mtime_nsec()&&a.ctime()==b.ctime()&&a.ctime_nsec()==b.ctime_nsec()}
fn digest(file:&File,n:u64)->Result<[u8;32],i32>{
    if n==0||n>256*1024*1024{return Err(2)}let mut h=Sha256::new();let mut b=[0u8;65536];let mut at=0u64;
    while at<n{let expected=b.len().min((n-at) as usize);let got=file.read_at(&mut b[..expected],at).map_err(|_|3)?;if got==0{return Err(7)}h.update(&b[..got]);at+=got as u64;}
    let mut extra=[0u8;1];if file.read_at(&mut extra,n).map_err(|_|3)?!=0{return Err(7)}Ok(h.finalize().into())
}
impl RegisteredImages {
    #[cfg(test)]pub(crate)fn public_empty()->Self{Self{images:vec![],first:None,first_close:None}}
    pub(crate)fn open(r:&Resource)->Opened{
        let mut owner=Self{images:Vec::new(),first:None,first_close:None};
        let checked=(||{owner.open_one(r,r.provider_image,&r.provider_registration,r.provider_uid,r.provider_gid)?;owner.open_one(r,r.main_image,&r.main_registration,r.main_uid,r.main_gid)?;owner.current()})();
        let error=checked.err();if let Some(e)=error{owner.first=Some(e)}Opened{owner,error}
    }
    fn open_one(&mut self,r:&Resource,path:&'static str,l:&RegistrationLocator,uid:u32,gid:u32)->Result<(),i32>{
        if !Path::new(path).is_absolute()||fs::canonicalize(path).map_err(|_|3)?!=Path::new(path){return Err(7)}
        for parent in Path::new(path).ancestors().skip(1){let s=fs::symlink_metadata(parent).map_err(|_|3)?;if !s.is_dir()||s.file_type().is_symlink()||s.uid()!=0||s.mode()&0o022!=0{return Err(7)}}
        let file=OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC|libc::O_NONBLOCK).open(path).map_err(|_|3)?;
        // The FD is adopted before interpreting stat/hash/Root-record results.
        self.images.push(Image{file:ManuallyDrop::new(file),identity:None,path,digest:[0;32],qualification:None,close_selected:false,closed:false});
        let image=self.images.last_mut().unwrap();image.identity=Some(image.file.metadata().map_err(|_|3)?);let s=image.identity.as_ref().unwrap();
        if !s.is_file()||s.uid()!=0||s.nlink()!=1||s.mode()&0o222!=0||s.mode()&0o111==0{return Err(7)}
        image.digest=digest(&image.file,s.len())?;
        if !same(s,&image.file.metadata().map_err(|_|3)?)||!same(s,&fs::symlink_metadata(path).map_err(|_|3)?){return Err(7)}
        let acquired=q::HeldQualification::open(&q::QualificationExpected{parent:Path::new(l.parent),identity:q::Identity{device:l.device,inode:l.inode,uid:0,gid:l.gid,mode:l.mode},resource_id:l.source_resource_id,bootstrap:l.bootstrap,statement_family:r.family,role:r.role,process_uid:uid,process_gid:gid,scope_sha256:l.scope_sha256,credential_sha256:r.credential_sha256,actual_image:Path::new(path),actual_image_sha256:image.digest});
        image.qualification=acquired.owner; // nonnull partial before error
        if let Some(e)=acquired.error{return Err(code(e))}if image.qualification.is_none(){return Err(8)}Ok(())
    }
    pub(crate)fn current(&mut self)->Result<(),i32>{
        if let Some(e)=self.first{return Err(e)}
        let checked=(||{if self.images.len()!=2{return Err(8)}let mut epochs=Vec::new();for image in &mut self.images{
            if image.closed||image.close_selected{return Err(8)}let before=image.file.metadata().map_err(|_|3)?;
            if !same(image.identity.as_ref().ok_or(3)?,&before)||!same(&before,&fs::symlink_metadata(image.path).map_err(|_|3)?)||digest(&image.file,before.len())?!=image.digest{return Err(7)}
            for parent in Path::new(image.path).ancestors().skip(1){let s=fs::symlink_metadata(parent).map_err(|_|3)?;if !s.is_dir()||s.file_type().is_symlink()||s.uid()!=0||s.mode()&0o022!=0{return Err(7)}}
            let q=image.qualification.as_mut().ok_or(1)?;q.current().map_err(code)?;epochs.push(q.source_epoch_data().map_err(code)?);
            if !same(&before,&image.file.metadata().map_err(|_|3)?)||!same(&before,&fs::symlink_metadata(image.path).map_err(|_|3)?){return Err(7)}
        }if epochs[0]!=epochs[1]{return Err(7)}Ok(())})();
        if let Err(e)=checked{self.first=Some(e)}checked
    }
    pub(crate)fn provider_digest(&self)->Result<[u8;32],i32>{self.images.first().map(|v|v.digest).filter(|d|*d!=[0;32]).ok_or(1)}
    pub(crate)fn source_epoch_data(&mut self)->Result<u64,i32>{
        self.current()?;let mut value=None;
        for image in &mut self.images{let n=image.qualification.as_mut().ok_or(1)?.source_epoch_data().map_err(code)?;if value.is_some_and(|v|v!=n){return Err(7)}value=Some(n)}
        self.current()?;value.filter(|v|*v>0).ok_or(1)
    }
    pub(crate)fn main_digest(&self)->Result<[u8;32],i32>{self.images.get(1).map(|v|v.digest).filter(|d|*d!=[0;32]).ok_or(1)}
    pub(crate)fn close(&mut self)->Result<(),i32>{
        for image in self.images.iter_mut().rev(){
            if let Some(q)=image.qualification.as_mut(){if let Err(e)=q.close(){let c=code(e);if self.first_close.is_none(){self.first_close=Some(c)}return Err(self.first_close.unwrap())}image.qualification=None;}
            if image.closed{continue}if image.close_selected{return Err(self.first_close.unwrap_or(8))}image.close_selected=true;
            if unsafe{libc::close(image.file.as_raw_fd())}!=0{if self.first_close.is_none(){self.first_close=Some(8)}return Err(self.first_close.unwrap())}image.closed=true;
        }self.first_close.map_or(Ok(()),Err)
    }
    pub(crate)fn debt(&self)->bool{self.images.iter().any(|v|!v.closed||v.qualification.is_some())}
}
impl Drop for RegisteredImages{fn drop(&mut self){if self.debt(){std::process::abort()}}}

#[cfg(test)]mod public_controls{
    use super::*;
    fn public_image(label:&str)->Image{
        let path=std::env::temp_dir().join(format!("PUBLIC-image-not-Root-{}-{}-{:?}",std::process::id(),label,std::time::Instant::now()));
        fs::write(&path,b"PUBLIC-not-executable-not-Source").unwrap();
        let file=File::open(&path).unwrap();let identity=file.metadata().unwrap();
        Image{file:ManuallyDrop::new(file),identity:Some(identity),path:Box::leak(path.to_str().unwrap().to_owned().into_boxed_str()),digest:[0;32],qualification:None,close_selected:false,closed:false}
    }
    #[test]fn actual_public_partial_fd_requires_explicit_same_owner_close(){
        let image=public_image("partial");let fd=image.file.as_raw_fd();
        let mut owner=RegisteredImages{images:vec![image],first:Some(7),first_close:None};
        assert!(owner.debt());assert!(unsafe{libc::fcntl(fd,libc::F_GETFD)}>=0);
        assert_eq!(owner.current(),Err(7));owner.close().unwrap();
        assert!(!owner.debt());assert_eq!(unsafe{libc::fcntl(fd,libc::F_GETFD)},-1);
        owner.close().unwrap();
    }
    #[test]fn ambiguous_child_close_stops_images_and_never_retries(){
        let mut owner=RegisteredImages{images:vec![public_image("parent"),public_image("child")],first:Some(7),first_close:None};
        let parent=owner.images[0].file.as_raw_fd();let child=owner.images[1].file.as_raw_fd();
        assert_eq!(unsafe{libc::close(child)},0);assert_eq!(owner.close(),Err(8));
        assert!(!owner.images[0].close_selected);assert!(!owner.images[0].closed);assert!(unsafe{libc::fcntl(parent,libc::F_GETFD)}>=0);
        assert_eq!(owner.close(),Err(8));assert!(!owner.images[0].close_selected);
        // Keep the exact unresolved PUBLIC debt; do not retry an ambiguous FD.
        std::mem::forget(owner);
    }
}


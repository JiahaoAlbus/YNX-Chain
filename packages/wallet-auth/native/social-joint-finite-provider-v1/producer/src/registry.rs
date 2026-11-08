//! A distinct finite purpose. Empty release rows, no ENV/config/setter.
use crate::image_registration::RegistrationLocator;use sha2::{Digest,Sha256};use std::{fs,path::Path,os::unix::fs::MetadataExt};
pub(crate)const PURPOSE:&str="YNX/SOCIAL/DEVICE-SESSION-PRINCIPAL/V1";
pub(crate)struct Resource{
 pub id:[u8;32],pub source:[u8;32],pub binding:[u8;32],pub family:u32,pub role:u32,pub purpose:&'static str,
 pub realm:&'static str,pub client:&'static str,pub network:&'static str,pub header:&'static str,
 pub provider_uid:u32,pub provider_gid:u32,pub main_uid:u32,pub main_gid:u32,
 pub socket:&'static str,pub socket_device:u64,pub socket_inode:u64,pub socket_directory:&'static str,pub socket_directory_device:u64,pub socket_directory_inode:u64,
 pub private_directory:&'static str,pub private_directory_device:u64,pub private_directory_inode:u64,
 pub journal_directory:&'static str,pub journal_directory_device:u64,pub journal_directory_inode:u64,
 pub provider_image:&'static str,pub main_image:&'static str,pub provider_registration:RegistrationLocator,pub main_registration:RegistrationLocator,
 pub credential_sha256:[u8;32],pub registration_sha256:[u8;32],pub bundle_sha256:[u8;32],
 pub alias:&'static str,pub custodian:&'static str,pub storage_generation:u64,pub credential_epoch:u64,
 pub key_classic:[u8;33],pub key_pq:[u8;2592],
}
static REGISTERED:&[Resource]=&[];
pub(crate)fn selected(id:&[u8;32])->Result<&'static Resource,i32>{let mut rows=REGISTERED.iter().filter(|r|r.id==*id);let r=rows.next().ok_or(1)?;if rows.next().is_some(){return Err(7)}r.validate()?;Ok(r)}
pub(crate)fn held_path(path:&str,uid:u32,dev:u64,ino:u64,mode:u32)->Result<(),i32>{let m=fs::symlink_metadata(path).map_err(|_|3)?;if !Path::new(path).is_absolute()||!m.is_dir()||m.file_type().is_symlink()||m.uid()!=uid||m.dev()!=dev||m.ino()!=ino||m.mode()&0o7777!=mode{return Err(7)}Ok(())}
pub(crate)fn pinned_image(path:&str,pin:&[u8;32])->Result<(),i32>{let p=Path::new(path);if !p.is_absolute()||*pin==[0;32]{return Err(1)}for v in p.ancestors().skip(1){let m=fs::symlink_metadata(v).map_err(|_|3)?;if !m.is_dir()||m.uid()!=0||m.file_type().is_symlink()||m.mode()&0o022!=0{return Err(7)}}let m=fs::symlink_metadata(p).map_err(|_|3)?;if !m.is_file()||m.uid()!=0||m.nlink()!=1||m.file_type().is_symlink()||m.mode()&0o222!=0||m.len()>256*1024*1024{return Err(7)}let raw=fs::read(p).map_err(|_|3)?;if <[u8;32]>::from(Sha256::digest(raw))!=*pin{return Err(7)}Ok(())}
impl Resource{pub(crate)fn validate(&self)->Result<(),i32>{if self.family!=5||self.purpose!=PURPOSE||!matches!(self.role,1|2)||self.id==[0;32]||self.source==[0;32]||self.binding==[0;32]||self.credential_sha256==[0;32]||self.registration_sha256==[0;32]||self.bundle_sha256==[0;32]||self.key_classic[0]!=5||self.key_classic[1..].iter().all(|v|*v==0)||self.key_pq.iter().all(|v|*v==0)||self.storage_generation==0||self.credential_epoch==0||self.alias.is_empty()||self.custodian.is_empty()||self.main_uid!=993||self.main_gid!=984||self.private_directory==self.journal_directory{return Err(7)}let expected=if self.role==1{(995,986)}else{(994,985)};if(self.provider_uid,self.provider_gid)!=expected{return Err(7)}
 for other in REGISTERED{if other.id!=self.id&&other.provider_uid==self.provider_uid&&other.credential_epoch==self.credential_epoch&&((other.key_classic==self.key_classic&&other.key_pq==self.key_pq)||(other.custodian==self.custodian&&other.alias==self.alias&&other.storage_generation==self.storage_generation)){return Err(7)}}
 held_path(self.socket_directory,0,self.socket_directory_device,self.socket_directory_inode,0o711)?;Ok(())}}

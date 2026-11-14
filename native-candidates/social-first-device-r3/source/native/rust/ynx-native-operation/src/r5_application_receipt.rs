//! Existing R5 JS application receipt DATA only. Physical C independently
//! writes/MACs/SELECTs completion; paths/inodes/hashes never become permission.
use super::*;
use base64::{Engine as _,engine::general_purpose::URL_SAFE_NO_PAD as B64};
use serde::{Serialize,Deserialize};use sha2::{Digest,Sha256};
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields)]struct EnvelopeFile{path:String,bytes:u64,sha256:String,device:u64,inode:u64}
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields,rename_all="camelCase")]struct Receipt{id:String,role:String,envelope:EnvelopeFile,input_sha256:String,current_predecessor_digests:Vec<String>,state:String,native_authority_granted:bool}
#[derive(Serialize)]struct Signature{classic:String,pq:String}
#[derive(Serialize)]struct Envelope<'a>{version:u32,role:&'a str,body:String,signature:Signature}
fn hash(raw:&[u8])->String{Sha256::digest(raw).iter().map(|b|format!("{b:02x}")).collect()}
fn id(raw:&[u8;32])->String{raw.iter().map(|b|format!("{b:02x}")).collect()}
pub(super)fn verify(inputs:&CopiedR5Inputs,matched:&R5DeviceBodyMatch,classic:&[u8],pq:&[u8],raw:&[u8])->Result<(),i32>{
 if raw.is_empty()||raw.len()>65536||classic.len()!=64||pq.len()!=4627{return Err(BOUND)}
 let r:Receipt=serde_json::from_slice(raw).map_err(|_|BOUND)?;
 // Existing emitter uses JSON.stringify, not Go HTML escaping. This is the
 // existing application receipt representation, not a new signature domain.
 if serde_json::to_vec(&r).map_err(|_|BOUND)?.as_slice()!=raw{return Err(BOUND)}
 if inputs.kind!=matched.kind||r.id!=id(&matched.once_id)||r.role!=matched.role||r.native_authority_granted{return Err(MISMATCH)}
 let expected_state=if matched.kind<=2{"final-public-proof"}else if matched.revoked{"revoked"}else{"active"};
 if r.state!=expected_state||r.envelope.path.len()>4096||!r.envelope.path.starts_with('/')||r.envelope.path.bytes().any(|b|matches!(b,0|10|13))||!r.envelope.path.ends_with(&format!("/{}.envelope.json",r.id))
  ||r.envelope.device>9007199254740991||r.envelope.inode>9007199254740991{return Err(BOUND)}
 let output=serde_json::to_vec(&Envelope{version:1,role:matched.role,body:B64.encode(&inputs.body),signature:Signature{classic:B64.encode(classic),pq:B64.encode(pq)}}).map_err(|_|BOUND)?;
 if r.envelope.bytes!=output.len()as u64||r.envelope.sha256!=hash(&output){return Err(MISMATCH)}
 let names:&[&str]=if inputs.kind<=2{&["root","registration","firstDeviceOperation","independentTerminal","checkpoint","nativeCompletedFinal","issuerCredential","anchorCredential","protectedFloor","currentObservation"]}else{&["finalOriginal","revocationCheckpoint","issuerCredential","anchorCredential","protectedFloor","currentObservation"]};
 let values=names.iter().map(|name|inputs.originals.get(*name).map(|raw|(*name,hash(raw))).ok_or(BOUND)).collect::<Result<Vec<_>,_>>()?;
 let context=serde_json::to_vec(&values).map_err(|_|BOUND)?;
 if r.input_sha256!=hash(&context)||r.current_predecessor_digests!=inputs.predecessors.iter().map(|p|hash(p)).collect::<Vec<_>>(){return Err(MISMATCH)}
 Ok(())
}

// Read the actual emitter's file, never regenerate a signature or envelope.
// The caller adopts every returned byte before inspecting the late status.
#[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",all(unix,not(target_os="android"))))]
pub(super)struct ActualReadPlan{file:EnvelopeFile}
#[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",all(unix,not(target_os="android"))))]
pub(super)fn actual_read_plan(inputs:&CopiedR5Inputs,matched:&R5DeviceBodyMatch,classic:&[u8],pq:&[u8],receipt:&[u8])->Result<ActualReadPlan,i32>{
 verify(inputs,matched,classic,pq,receipt)?;
 let r:Receipt=serde_json::from_slice(receipt).map_err(|_|BOUND)?;
 if r.envelope.bytes==0||r.envelope.bytes>65536{return Err(BOUND)}
 Ok(ActualReadPlan{file:r.envelope})
}
#[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",all(unix,not(target_os="android"))))]
pub(super)fn read_actual(plan:ActualReadPlan)->(Vec<u8>,Result<(),i32>){
 read_actual_with(plan,||{})
}
#[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",unix,not(target_os="android")))]
pub(super)fn read_selected(plan:ActualReadPlan,cached:&[u8])->(Vec<u8>,Result<(),i32>){
 if cached.is_empty(){read_actual(plan)}else{(cached.to_vec(),Ok(()))}
}
#[cfg(all(feature="abi5-final-native-link",feature="source-server-collector",unix,not(target_os="android")))]
fn read_actual_with(plan:ActualReadPlan,after_read:impl FnOnce())->(Vec<u8>,Result<(),i32>){
 use std::{io::Read,os::unix::fs::{MetadataExt,OpenOptionsExt}};
 let mut bytes=Vec::new();
 let result=(||{
  let r=plan.file;
  let mut file=std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC|libc::O_NONBLOCK)
   .open(&r.path).map_err(|e|if e.kind()==std::io::ErrorKind::NotFound{1}else{UNKNOWN})?;
  let before=file.metadata().map_err(|_|UNKNOWN)?;
  if !before.is_file()||before.dev()!=r.device||before.ino()!=r.inode||before.len()!=r.bytes{return Err(MISMATCH)}
  file.by_ref().take(r.bytes+1).read_to_end(&mut bytes).map_err(|_|UNKNOWN)?;
  after_read();
  let after=file.metadata().map_err(|_|UNKNOWN)?;
  let path=std::fs::symlink_metadata(&r.path).map_err(|_|UNKNOWN)?;
  let final_fd=file.metadata().map_err(|_|UNKNOWN)?;
  if !path.is_file()||path.dev()!=before.dev()||path.ino()!=before.ino()||
   path.len()!=before.len()||path.mtime()!=before.mtime()||path.mtime_nsec()!=before.mtime_nsec()||path.ctime()!=before.ctime()||path.ctime_nsec()!=before.ctime_nsec()||
   after.dev()!=before.dev()||after.ino()!=before.ino()||after.len()!=before.len()||
   after.mtime()!=before.mtime()||after.mtime_nsec()!=before.mtime_nsec()||
   after.ctime()!=before.ctime()||after.ctime_nsec()!=before.ctime_nsec()||
   final_fd.dev()!=before.dev()||final_fd.ino()!=before.ino()||final_fd.len()!=before.len()||
   final_fd.mtime()!=before.mtime()||final_fd.mtime_nsec()!=before.mtime_nsec()||final_fd.ctime()!=before.ctime()||final_fd.ctime_nsec()!=before.ctime_nsec()||
   bytes.len()as u64!=r.bytes||hash(&bytes)!=r.sha256{return Err(MISMATCH)}
  Ok(())
 })();(bytes,result)
}
#[cfg(all(test,feature="abi5-final-native-link",feature="source-server-collector",unix,not(target_os="android")))]
mod actual_file_controls{
 use super::*;use std::os::unix::fs::{MetadataExt,symlink};
 fn fixture()->(std::path::PathBuf,ActualReadPlan){
  use std::sync::atomic::{AtomicUsize,Ordering};static NEXT:AtomicUsize=AtomicUsize::new(0);
  let dir=std::env::temp_dir().join(format!("ynx-r5-original-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::SeqCst)));
  std::fs::create_dir_all(&dir).unwrap();let path=dir.join("actual.envelope.json");std::fs::write(&path,b"PUBLIC-ORIGINAL-FILE").unwrap();let m=std::fs::metadata(&path).unwrap();
  let plan=ActualReadPlan{file:EnvelopeFile{path:path.to_str().unwrap().into(),bytes:m.len(),sha256:hash(b"PUBLIC-ORIGINAL-FILE"),device:m.dev(),inode:m.ino()}};(path,plan)
 }
 #[test]fn reads_exact_original_and_never_regenerates_it(){let(_,plan)=fixture();let(bytes,status)=read_actual(plan);assert_eq!(status,Ok(()));assert_eq!(bytes,b"PUBLIC-ORIGINAL-FILE");}
 #[test]fn changed_actual_bytes_are_retained_on_mismatch(){let(path,plan)=fixture();std::fs::write(path,b"PUBLIC-CHANGED--FILE").unwrap();let(bytes,status)=read_actual(plan);assert_eq!(bytes,b"PUBLIC-CHANGED--FILE");assert_eq!(status,Err(MISMATCH));}
 #[test]fn missing_or_replaced_identity_is_not_an_original(){let(path,plan)=fixture();let replacement=path.with_extension("replacement");std::fs::write(&replacement,b"PUBLIC-ORIGINAL-FILE").unwrap();std::fs::rename(&replacement,&path).unwrap();let(bytes,status)=read_actual(plan);assert!(bytes.is_empty());assert_eq!(status,Err(MISMATCH));
  let(path,mut plan)=fixture();let alias=path.with_extension("alias");symlink(&path,&alias).unwrap();plan.file.path=alias.to_str().unwrap().into();let(bytes,status)=read_actual(plan);assert!(bytes.is_empty());assert_ne!(status,Ok(()));
  let(_,mut plan)=fixture();plan.file.path.push_str("-missing");let(bytes,status)=read_actual(plan);assert!(bytes.is_empty());assert_eq!(status,Err(1));
 }
 #[test]fn replacement_after_read_keeps_fd_bytes_and_refuses_path_change(){let(path,plan)=fixture();let swap=path.with_extension("swap");std::fs::write(&swap,b"PUBLIC-ORIGINAL-FILE").unwrap();let(bytes,status)=read_actual_with(plan,||std::fs::rename(&swap,&path).unwrap());assert_eq!(bytes,b"PUBLIC-ORIGINAL-FILE");assert_eq!(status,Err(MISMATCH));}
 #[test]fn truncation_after_read_keeps_partial_and_refuses_late_change(){let(path,plan)=fixture();let(bytes,status)=read_actual_with(plan,||std::fs::write(&path,b"CUT").unwrap());assert_eq!(bytes,b"PUBLIC-ORIGINAL-FILE");assert_eq!(status,Err(MISMATCH));}
 #[test]fn retained_selection_is_not_read_again_after_path_changes(){let(path,plan)=fixture();let(bytes,status)=read_actual(plan);assert_eq!(status,Ok(()));let metadata=std::fs::metadata(&path).unwrap();let next=ActualReadPlan{file:EnvelopeFile{path:path.to_str().unwrap().into(),bytes:metadata.len(),sha256:hash(&bytes),device:metadata.dev(),inode:metadata.ino()}};std::fs::write(path,b"CUT").unwrap();let(second,status)=read_selected(next,&bytes);assert_eq!(status,Ok(()));assert_eq!(second,bytes);}
}

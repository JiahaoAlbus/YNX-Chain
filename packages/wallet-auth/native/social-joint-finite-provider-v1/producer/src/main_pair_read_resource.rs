//! Independent read admission. Existing signing rows never select this table.
use super::{Fd, data};
use crate::{image_registration::RegisteredImages, peer, registry};
use std::{os::unix::fs::{FileTypeExt, MetadataExt},path::Path};
pub(super) struct ReadRow {
    pub id: [u8; 32],
    pub source: [u8; 32],
    pub role_resource: [u8;32],
    pub role: u32,
    pub family: u32,
    pub purpose: &'static str,
    pub socket: &'static str,
    pub device: u64,
    pub inode: u64,
    pub parent: &'static str,
    pub parent_device: u64,
    pub parent_inode: u64,
}
// A release owner must explicitly review this independent purpose, Source
// identity, images, peers and socket tuple. No public installer or ENV path.
static ROOT_READ_ROWS: &[ReadRow] = &[];
// Finite5 is the underlying role's registered OS/image/Source resource, not
// read permission. Only this independent purpose/table selects read access.
pub(super) fn selected(
    source: Option<[u8; 32]>,
    id: Option<[u8; 32]>,
) -> Result<&'static ReadRow, i32> {
    select(ROOT_READ_ROWS, source, id)
}
fn select<'a>(
    rows: &'a [ReadRow],
    source: Option<[u8; 32]>,
    id: Option<[u8; 32]>,
) -> Result<&'a ReadRow, i32> {
    let mut it = rows.iter().filter(|r| {
        r.purpose == data::PURPOSE
            && source.is_none_or(|v| r.source == v)
            && id.is_none_or(|v| r.id == v)
    });
    let r = it.next().ok_or(1)?;
    if it.next().is_some() {
        return Err(7);
    }
    if r.id == [0; 32]
        || r.source == [0; 32] || r.role_resource==[0;32]
        || !(1..=2).contains(&r.role)
        || r.family != 5
    {
        return Err(7);
    }
    Ok(r)
}
impl ReadRow {
    pub fn role_source(&self) -> Result<&'static registry::Resource, i32> {
        let r = registry::selected(&self.role_resource)?;
        if r.id != self.role_resource || r.source != self.source || r.role != self.role || r.family != self.family || r.family != 5 || r.main_uid == r.provider_uid {
            return Err(7);
        }
        Ok(r)
    }
    pub fn current(&self) -> Result<(), i32> {
        let r = self.role_source()?;
        registry::held_path(self.parent, 0, self.parent_device, self.parent_inode, 0o711)?;
        if !Path::new(self.socket).is_absolute()
            || Path::new(self.socket).parent() != Some(Path::new(self.parent))
            || std::fs::canonicalize(self.parent).map_err(|_| 3)? != Path::new(self.parent)
        {
            return Err(7);
        }
        for p in Path::new(self.parent).ancestors() {
            let s = std::fs::symlink_metadata(p).map_err(|_| 3)?;
            if !s.is_dir() || s.file_type().is_symlink() || s.uid() != 0 || s.mode() & 0o022 != 0 {
                return Err(7);
            }
        }
        let s = std::fs::symlink_metadata(self.socket).map_err(|_| 3)?;
        if !s.file_type().is_socket()
            || s.uid() != r.main_uid
            || s.gid() != r.provider_gid
            || s.mode() & 0o7777 != 0o660
            || s.nlink() != 1
            || s.dev() != self.device
            || s.ino() != self.inode
        {
            return Err(7);
        }
        Ok(())
    }
    pub fn local(&self, server: bool) -> Result<(), i32> {
        let r = self.role_source()?;
        let (u, g) = if server {
            (r.main_uid, r.main_gid)
        } else {
            (r.provider_uid, r.provider_gid)
        };
        if unsafe { libc::geteuid() } != u || unsafe { libc::getegid() } != g {
            return Err(7);
        }
        Ok(())
    }
    pub fn peer(&self, fd: &Fd, images: &RegisteredImages, server: bool) -> Result<i32, i32> {
        let r = self.role_source()?;
        let s = fd.stream();
        let p = if server {
            peer::assert_registered(
                &s,
                r.provider_uid,
                r.provider_gid,
                r.provider_image,
                &images.provider_digest()?,
            )
        } else {
            peer::assert_registered(
                &s,
                r.main_uid,
                r.main_gid,
                r.main_image,
                &images.main_digest()?,
            )
        }?;
        Ok(p.pid)
    }
}
pub(super) fn same_peer(fd: &Fd, expected: peer::Peer) -> Result<(), i32> {
    fd.current().map_err(|e| e.code)?;
    let now = peer::actual(&fd.stream())?;
    if now.uid != expected.uid || now.gid != expected.gid || now.pid != expected.pid {
        return Err(7);
    }
    Ok(())
}
pub(super) fn actual(fd: &Fd) -> Result<peer::Peer, i32> {
    peer::actual(&fd.stream())
}
pub(super) fn same_cleanup_peer(fd: &Fd, expected: peer::Peer) -> Result<(), i32> {
    fd.current().map_err(|e| e.code)?;
    let now = peer::actual(&fd.stream())?;
    if now.uid != expected.uid || now.gid != expected.gid {
        return Err(7);
    }
    if now.pid == expected.pid {
        return Ok(());
    }
    let mut b = 0u8;
    let terminal = unsafe {
        libc::recv(
            fd.raw,
            (&mut b as *mut u8).cast(),
            1,
            libc::MSG_PEEK | libc::MSG_DONTWAIT,
        )
    } == 0;
    // Darwin may clear LOCAL_PEERPID after the already authenticated peer exits.
    // This is cleanup-only on SAME pinned FD, never a Current/admission fallback.
    if now.pid == 0 && terminal {
        Ok(())
    } else {
        Err(7)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_and_wrong_purpose_never_inherit_signing_rows() {
        assert_eq!(selected(Some([1; 32]), None).err(), Some(1));
        let r = ReadRow {
            id: [1; 32],
            source: [2; 32],
            role_resource:[3;32],
            role: 1,
            family: 1,
            purpose: "SOURCE-PROOF",
            socket: "/not-opened",
            device: 1,
            inode: 1,
            parent: "/",
            parent_device: 1,
            parent_inode: 1,
        };
        assert_eq!(select(&[r], Some([2; 32]), None).err(), Some(1));
    }
    #[test]
    fn finite_matching_family5_reaches_actual_registry_but_read_rows_stay_empty() {
        fn row(family:u32,role:u32)->ReadRow{ReadRow{id:[1;32],source:[2;32],role_resource:[3;32],role,family,purpose:data::PURPOSE,socket:"/PUBLIC-not-opened",device:1,inode:2,parent:"/",parent_device:1,parent_inode:1}}
        for family in [0,1,2,3,4,6]{let rows=[row(family,1)];assert_eq!(select(&rows,Some([2;32]),None).err(),Some(7));}
        for role in [0,3]{let rows=[row(5,role)];assert_eq!(select(&rows,Some([2;32]),None).err(),Some(7));}
        for role in [1,2]{let rows=[row(5,role)];let r=select(&rows,Some([2;32]),Some([1;32])).unwrap();assert_eq!(r.family,5);assert_eq!(r.role_source().err(),Some(1));}
        assert_eq!(selected(Some([2;32]),None).err(),Some(1));
        assert_eq!(selected(None,Some([1;32])).err(),Some(1));
        let rows=[row(5,1),row(5,1)];assert_eq!(select(&rows,Some([2;32]),None).err(),Some(7));
    }
}

//! Actual OS peer identity. Linux production never uses caller-provided PID/UID.
use std::os::{fd::AsRawFd, unix::net::UnixStream};
#[derive(Clone, Copy, Debug)]
pub(crate) struct Peer {
    pub uid: u32,
    pub gid: u32,
    pub pid: i32,
}
#[cfg(target_os = "linux")]
pub(crate) fn actual(stream: &UnixStream) -> Result<Peer, i32> {
    let mut c = std::mem::MaybeUninit::<libc::ucred>::uninit();
    let mut n = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    if unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            c.as_mut_ptr().cast(),
            &mut n,
        )
    } != 0
        || n as usize != std::mem::size_of::<libc::ucred>()
    {
        return Err(3);
    }
    let c = unsafe { c.assume_init() };
    if c.pid <= 0 {
        return Err(7);
    }
    Ok(Peer {
        uid: c.uid,
        gid: c.gid,
        pid: c.pid,
    })
}
#[cfg(target_os = "macos")]
pub(crate) fn actual(stream: &UnixStream) -> Result<Peer, i32> {
    let (mut uid, mut gid) = (0, 0);
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0 {
        return Err(3);
    }
    let mut pid = 0i32;
    let mut n = std::mem::size_of::<i32>() as libc::socklen_t;
    if unsafe { libc::getsockopt(stream.as_raw_fd(), 0, 0x002, pid_as_void(&mut pid), &mut n) } != 0
    {
        // No synthetic self-PID fallback. Socketpair may provide UID/GID but
        // no PID on Darwin; production acquisition below remains Linux-only.
        pid = 0;
    }
    Ok(Peer { uid, gid, pid })
}
#[cfg(target_os = "macos")]
fn pid_as_void(p: &mut i32) -> *mut libc::c_void {
    (p as *mut i32).cast()
}
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(crate) fn actual(_stream: &UnixStream) -> Result<Peer, i32> {
    Err(1)
}
pub(crate) fn assert_registered(
    stream: &UnixStream,
    uid: u32,
    gid: u32,
    image: &str,
    digest: &[u8; 32],
) -> Result<Peer, i32> {
    let p = actual(stream)?;
    if p.uid != uid || p.gid != gid || p.pid <= 0 {
        return Err(7);
    }
    #[cfg(target_os = "linux")]
    {
        let actual = std::fs::read_link(format!("/proc/{}/exe", p.pid)).map_err(|_| 3)?;
        if actual != std::path::Path::new(image) {
            return Err(7);
        }
        crate::registry::pinned_image(image, digest)?;
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (image, digest);
        return Err(1);
    }
    #[allow(unreachable_code)]
    Ok(p)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_unix_peer_uid_not_payload() {
        let (a, _) = UnixStream::pair().unwrap();
        let p = actual(&a).unwrap();
        assert_eq!(p.uid, unsafe { libc::geteuid() });
        assert_eq!(p.gid, unsafe { libc::getegid() });
        assert!(assert_registered(&a, p.uid.wrapping_add(1), p.gid, "/none", &[0; 32]).is_err());
    }
}


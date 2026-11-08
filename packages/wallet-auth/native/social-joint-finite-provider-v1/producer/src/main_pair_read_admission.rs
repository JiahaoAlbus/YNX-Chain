//! Same inherited listener, same admitted peer. No bind/path creation.
use super::*;
use std::{collections::HashSet, os::unix::net::UnixListener};
pub(super) struct Server {
    row: &'static resource::ReadRow,
    images: RegisteredImages,
    fd: Option<Fd>,
    thread: ThreadId,
    children: HashSet<usize>,
    first: Option<Failure>,
    closed: bool,
}
pub(super) struct Peer {
    parent: usize,
    fd: Fd,
    identity: Option<peer::Peer>,
    thread: ThreadId,
    first: Option<Failure>,
    closed: bool,
}
thread_local! {pub(super)static SERVERS:RefCell<HashMap<usize,Box<Server>>>=RefCell::new(HashMap::new());pub(super)static PEERS:RefCell<HashMap<usize,Box<Peer>>>=RefCell::new(HashMap::new());}
pub(super) fn protects(start: usize, end: usize) -> bool {
    fn overlaps<T>(s: usize, e: usize, p: &T) -> bool {
        let b = p as *const T as usize;
        s < b + std::mem::size_of::<T>() && b < e
    }
    SERVERS.with(|m| {
        m.try_borrow()
            .map(|m| m.values().any(|v| overlaps(start, end, &**v)))
            .unwrap_or(true)
    }) || PEERS.with(|m| {
        m.try_borrow()
            .map(|m| m.values().any(|v| overlaps(start, end, &**v)))
            .unwrap_or(true)
    })
}
impl Server {
    fn current(&mut self) -> Result<()> {
        if self.thread != thread::current().id() {
            return Err(4.into());
        }
        if self.closed {
            return Err(8.into());
        }
        if let Some(e) = self.first {
            return Err(e);
        }
        let r = (|| {
            self.row.current()?;
            self.row.local(true)?;
            self.images.current()?;
            let fd = self.fd.as_ref().ok_or(8)?;
            fd.current()?;
            if fd.closed || fd.selected {
                return Err(8.into());
            }
            let l = ManuallyDrop::new(unsafe { UnixListener::from_raw_fd(fd.raw) });
            if l.local_addr().map_err(|_| 3)?.as_pathname()
                != Some(std::path::Path::new(self.row.socket))
            {
                return Err(7.into());
            }
            let mut accept = 0i32;
            let mut n = std::mem::size_of::<i32>() as libc::socklen_t;
            if unsafe {
                libc::getsockopt(
                    fd.raw,
                    libc::SOL_SOCKET,
                    libc::SO_ACCEPTCONN,
                    (&mut accept as *mut i32).cast(),
                    &mut n,
                )
            } != 0
                || accept != 1
            {
                return Err(7.into());
            }
            Ok(())
        })();
        if let Err(e) = r {
            self.first.get_or_insert(e);
        }
        r
    }
    fn open(row: &'static resource::ReadRow, raw: i32) -> (Option<Box<Self>>, Result<()>) {
        let pre = (|| {
            row.current()?;
            row.local(true)?;
            Ok(())
        })();
        if let Err(e) = pre {
            return (None, Err(e));
        }
        let images = RegisteredImages::open(match row.role_source() {
            Ok(r) => r,
            Err(e) => return (None, Err(e.into())),
        });
        let mut s = Box::new(Self {
            row,
            images: images.owner,
            fd: None,
            thread: thread::current().id(),
            children: HashSet::new(),
            first: None,
            closed: false,
        });
        let result = (|| {
            if let Some(e) = images.error {
                return Err(e.into());
            }
            s.fd = Some(Fd::duplicate(raw)?);
            let fd = s.fd.as_ref().unwrap();
            let listener = ManuallyDrop::new(unsafe { UnixListener::from_raw_fd(fd.raw) });
            if listener.local_addr().map_err(|_| 3)?.as_pathname()
                != Some(std::path::Path::new(row.socket))
            {
                return Err(7.into());
            }
            row.current()?;
            // Existing substrate: Main's actual process listens once on Root's
            // preBOUND FD so Linux SO_PEERCRED identifies Main, not Root's binder.
            if unsafe { libc::listen(fd.raw, 16) } != 0 {
                return Err(3.into());
            }
            s.current()
        })();
        if let Err(e) = result {
            s.first = Some(e)
        }
        (Some(s), result)
    }
    fn open_peer(&mut self, parent: usize, fd: i32) -> (Option<Box<Peer>>, Result<()>) {
        if let Err(e) = self.current() {
            return (None, Err(e));
        }
        let fd = match Fd::duplicate(fd) {
            Ok(v) => v,
            Err(e) => return (None, Err(e)),
        };
        let mut p = Box::new(Peer {
            parent,
            fd,
            identity: None,
            thread: thread::current().id(),
            first: None,
            closed: false,
        });
        let key = (&mut *p as *mut Peer) as usize;
        self.children.insert(key);
        let result = (|| {
            p.identity = Some(resource::actual(&p.fd)?);
            self.row.peer(&p.fd, &self.images, true)?;
            p.current(self)
        })();
        if let Err(e) = result {
            p.first = Some(e)
        }
        (Some(p), result)
    }
    fn close(&mut self) -> Result<()> {
        if self.thread != thread::current().id() {
            return Err(4.into());
        }
        if self.closed {
            return self.first.map_or(Ok(()), Err);
        }
        if !self.children.is_empty() {
            return Err(8.into());
        }
        if let Some(fd) = self.fd.as_mut() {
            fd.close()?
        }
        self.images.close()?;
        self.closed = true;
        self.first.map_or(Ok(()), Err)
    }
}
impl Peer {
    fn current(&mut self, s: &mut Server) -> Result<()> {
        if self.thread != thread::current().id() {
            return Err(4.into());
        }
        if self.closed {
            return Err(8.into());
        }
        if let Some(e) = self.first {
            return Err(e);
        }
        let r = (|| {
            s.current()?;
            resource::same_peer(&self.fd, self.identity.ok_or(8)?)?;
            s.row.peer(&self.fd, &s.images, true)?;
            s.current()
        })();
        if let Err(e) = r {
            self.first.get_or_insert(e);
        }
        r
    }
    fn close(&mut self, s: &mut Server, key: usize) -> Result<()> {
        if self.thread != thread::current().id() {
            return Err(4.into());
        }
        if self.closed {
            return self.first.map_or(Ok(()), Err);
        }
        // Cleanup-only: identity is the SAME admitted original socket/peer. Source
        // freshness/Root expiry does not prevent returning already owned debt.
        if let Some(p) = self.identity {
            resource::same_cleanup_peer(&self.fd, p)?;
        }
        self.fd.close()?;
        self.closed = true;
        s.children.remove(&key);
        self.first.map_or(Ok(()), Err)
    }
}
struct ServerGuard {
    key: usize,
    value: Option<Box<Server>>,
}
impl ServerGuard {
    fn take(key: usize) -> Result<Self> {
        let v = SERVERS.with(|m| {
            m.try_borrow_mut()
                .map_err(|_| Failure::from(8))?
                .remove(&key)
                .ok_or(Failure::from(2))
        })?;
        Ok(Self {
            key,
            value: Some(v),
        })
    }
    fn get(&mut self) -> &mut Server {
        self.value.as_mut().unwrap()
    }
}
impl Drop for ServerGuard {
    fn drop(&mut self) {
        if let Some(v) = self.value.take() {
            SERVERS.with(|m| {
                m.borrow_mut().insert(self.key, v);
            })
        }
    }
}
struct PeerGuard {
    key: usize,
    value: Option<Box<Peer>>,
}
impl PeerGuard {
    fn take(key: usize) -> Result<Self> {
        let v = PEERS.with(|m| {
            m.try_borrow_mut()
                .map_err(|_| Failure::from(8))?
                .remove(&key)
                .ok_or(Failure::from(2))
        })?;
        Ok(Self {
            key,
            value: Some(v),
        })
    }
    fn get(&mut self) -> &mut Peer {
        self.value.as_mut().unwrap()
    }
}
impl Drop for PeerGuard {
    fn drop(&mut self) {
        if let Some(v) = self.value.take() {
            PEERS.with(|m| {
                m.borrow_mut().insert(self.key, v);
            })
        }
    }
}
pub(super) fn open(id: [u8; 32], fd: i32) -> (Option<usize>, Result<()>) {
    let row = match resource::selected(None, Some(id)) {
        Ok(v) => v,
        Err(e) => return (None, Err(e.into())),
    };
    let (s, r) = Server::open(row, fd);
    let key = s.map(|mut s| {
        let k = (&mut *s as *mut Server) as usize;
        SERVERS.with(|m| m.borrow_mut().insert(k, s));
        k
    });
    (key, r)
}
pub(super) fn current(key: usize) -> Result<()> {
    ServerGuard::take(key)?.get().current()
}
pub(super) fn peer_open(key: usize, fd: i32) -> (Option<usize>, Result<()>) {
    let mut g = match ServerGuard::take(key) {
        Ok(g) => g,
        Err(e) => return (None, Err(e)),
    };
    let (p, r) = g.get().open_peer(key, fd);
    let key = p.map(|mut p| {
        let k = (&mut *p as *mut Peer) as usize;
        PEERS.with(|m| m.borrow_mut().insert(k, p));
        k
    });
    (key, r)
}
pub(super) fn peer_current(key: usize) -> Result<()> {
    let mut p = PeerGuard::take(key)?;
    let parent = p.get().parent;
    let mut s = ServerGuard::take(parent)?;
    p.get().current(s.get())
}
pub(super) fn peer_close(key: usize) -> (bool, Result<()>) {
    let mut p = match PeerGuard::take(key) {
        Ok(v) => v,
        Err(e) => return (false, Err(e)),
    };
    let mut s = match ServerGuard::take(p.get().parent) {
        Ok(v) => v,
        Err(e) => return (false, Err(e)),
    };
    let r = p.get().close(s.get(), key);
    (p.get().closed, r)
}
pub(super) fn close(key: usize) -> (bool, Result<()>) {
    let mut s = match ServerGuard::take(key) {
        Ok(v) => v,
        Err(e) => return (false, Err(e)),
    };
    let r = s.get().close();
    (s.get().closed, r)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn row() -> &'static resource::ReadRow {
        Box::leak(Box::new(resource::ReadRow {
            id: [1; 32],
            source: [2; 32],
            role_resource:[3;32],
            role: 1,
            family: 5,
            purpose: data::PURPOSE,
            socket: "/PUBLIC-not-a-release",
            device: 1,
            inode: 2,
            parent: "/",
            parent_device: 1,
            parent_inode: 1,
        }))
    }
    fn server(fd: Fd) -> Server {
        Server {
            row: row(),
            images: RegisteredImages::public_empty(),
            fd: Some(fd),
            thread: thread::current().id(),
            children: HashSet::new(),
            first: None,
            closed: false,
        }
    }
    #[test]
    fn actual_dup_parent_fd_child_debt_and_first_zero_cleanup() {
        let (a, b) = UnixStream::pair().unwrap();
        let original = a.as_raw_fd();
        let mut s = server(Fd::duplicate(original).unwrap());
        let (x, y) = UnixStream::pair().unwrap();
        let child = Fd::own(x.into_raw_fd());
        let identity = resource::actual(&child).unwrap();
        let raw = child.raw;
        let mut p = Peer {
            parent: 1,
            fd: child,
            identity: Some(identity),
            thread: thread::current().id(),
            first: Some(Failure {
                code: 0,
                unknown: false,
            }),
            closed: false,
        };
        s.children.insert(9);
        assert_eq!(s.close(), Err(8.into()));
        assert!(!s.fd.as_ref().unwrap().selected);
        assert_eq!(
            p.close(&mut s, 9),
            Err(Failure {
                code: 0,
                unknown: false
            })
        );
        assert!(p.closed);
        assert_eq!(unsafe { libc::fcntl(raw, libc::F_GETFD) }, -1);
        s.close().unwrap();
        assert!(s.closed);
        assert!(unsafe { libc::fcntl(original, libc::F_GETFD) } >= 0);
        drop((a, b, y));
    }
    #[test]
    fn actual_ambiguous_peer_close_stops_parent_and_does_not_retry() {
        let (a, b) = UnixStream::pair().unwrap();
        let mut s = server(Fd::own(a.into_raw_fd()));
        let (x, y) = UnixStream::pair().unwrap();
        let fd = Fd::own(x.into_raw_fd());
        let identity = resource::actual(&fd).unwrap();
        let mut p = Peer {
            parent: 1,
            fd,
            identity: Some(identity),
            thread: thread::current().id(),
            first: None,
            closed: false,
        };
        s.children.insert(9);
        assert_eq!(unsafe { libc::close(p.fd.raw) }, 0);
        assert!(p.close(&mut s, 9).is_err());
        assert!(!p.closed);
        assert_eq!(s.close(), Err(8.into()));
        assert!(!s.fd.as_ref().unwrap().selected);
        assert!(p.close(&mut s, 9).is_err());
        std::mem::forget(p);
        std::mem::forget(s);
        drop((b, y));
    }
    #[test]
    fn original_peer_identity_not_source_freshness_controls_cleanup() {
        let (a, b) = UnixStream::pair().unwrap();
        let mut s = server(Fd::own(a.into_raw_fd()));
        s.first = Some(5.into());
        let (x, y) = UnixStream::pair().unwrap();
        let fd = Fd::own(x.into_raw_fd());
        let identity = resource::actual(&fd).unwrap();
        let mut p = Peer {
            parent: 1,
            fd,
            identity: Some(identity),
            thread: thread::current().id(),
            first: None,
            closed: false,
        };
        s.children.insert(9);
        p.close(&mut s, 9).unwrap();
        assert!(p.closed);
        assert_eq!(s.close(), Err(5.into()));
        assert!(s.closed);
        drop((b, y));
    }
    #[test]
    fn foreign_peer_refuses_cleanup_and_empty_root_does_not_duplicate() {
        let (a, b) = UnixStream::pair().unwrap();
        let raw = a.as_raw_fd();
        let (k, r) = open([1; 32], raw);
        assert!(k.is_none());
        assert_eq!(r, Err(1.into()));
        assert!(unsafe { libc::fcntl(raw, libc::F_GETFD) } >= 0);
        let mut fd = Fd::duplicate(raw).unwrap();
        let mut p = resource::actual(&fd).unwrap();
        p.uid = p.uid.wrapping_add(1);
        assert_eq!(resource::same_peer(&fd, p), Err(7));
        assert!(!fd.selected);
        fd.close().unwrap();
        drop((a, b));
    }
}

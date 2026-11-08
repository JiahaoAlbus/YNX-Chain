//! Registered Main original holder read: transport/physical admission only.
//! Actual Source/Root math stays with the independently held role and Main.
use crate::{image_registration::RegisteredImages, peer, wire};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use std::{
    cell::RefCell,
    collections::HashMap,
    mem::ManuallyDrop,
    os::{
        fd::{AsRawFd, FromRawFd, IntoRawFd, RawFd},
        unix::net::UnixStream,
    },
    thread::{self, ThreadId},
    time::{Duration, Instant},
};
#[path = "main_pair_read_admission.rs"]
mod admission;
#[path = "main_pair_read_data.rs"]
mod data;
#[path = "main_pair_read_ffi.rs"]
mod ffi;
#[path = "main_pair_read_resource.rs"]
mod resource;
#[cfg(test)]
#[path = "main_pair_read_tests.rs"]
mod tests;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Failure {
    pub code: i32,
    pub unknown: bool,
}
impl From<i32> for Failure {
    fn from(code: i32) -> Self {
        Self {
            code,
            unknown: code == 8,
        }
    }
}
type Result<T> = std::result::Result<T, Failure>;
pub(super) struct Fd {
    raw: RawFd,
    selected: bool,
    closed: bool,
    identity: Option<(u64, u64, u32)>,
}
impl Fd {
    fn own(raw: RawFd) -> Self {
        let mut s = std::mem::MaybeUninit::<libc::stat>::uninit();
        let identity = if unsafe { libc::fstat(raw, s.as_mut_ptr()) } == 0 {
            let s = unsafe { s.assume_init() };
            Some((s.st_dev as u64, s.st_ino as u64, s.st_mode as u32 & libc::S_IFMT as u32))
        } else {
            None
        };
        Self {
            raw,
            selected: false,
            closed: false,
            identity,
        }
    }
    fn duplicate(raw: RawFd) -> Result<Self> {
        let n = unsafe { libc::fcntl(raw, libc::F_DUPFD_CLOEXEC, 3) };
        if n < 0 {
            return Err(3.into());
        }
        Ok(Self::own(n))
    }
    fn stream(&self) -> ManuallyDrop<UnixStream> {
        ManuallyDrop::new(unsafe { UnixStream::from_raw_fd(self.raw) })
    }
    fn current(&self) -> Result<()> {
        if self.closed || self.selected {
            return Err(8.into());
        }
        let mut s = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe { libc::fstat(self.raw, s.as_mut_ptr()) } != 0 {
            return Err(7.into());
        }
        let s = unsafe { s.assume_init() };
        // Socket FD permission bits may become zero after a known peer close
        // on Darwin; vnode/type identity remains stable. Root named socket
        // permissions are checked separately by ReadRow.current, not here.
        if self.identity != Some((s.st_dev as u64, s.st_ino as u64, s.st_mode as u32 & libc::S_IFMT as u32)) {
            return Err(7.into());
        }
        Ok(())
    }
    fn close(&mut self) -> Result<()> {
        if self.closed {
            return Ok(());
        }
        if self.selected {
            return Err(8.into());
        }
        self.selected = true;
        if unsafe { libc::close(self.raw) } != 0 {
            return Err(8.into());
        }
        self.closed = true;
        Ok(())
    }
}
// No implicit close/retry after EINTR/EBADF/unknown. The actual owner remains
// in the private inventory until explicit physical drain; Drop never guesses.
impl Drop for Fd {
    fn drop(&mut self) {
        if !self.closed {
            std::process::abort()
        }
    }
}
pub(super) struct Client {
    row: Option<&'static resource::ReadRow>,
    images: RegisteredImages,
    fd: Option<Fd>,
    peer: Option<peer::Peer>,
    thread: ThreadId,
    sequence: u64,
    owner: [u8; 16],
    started: Instant,
    first: Option<Failure>,
    open_selected: bool,
    close_selected: bool,
    remote_closed: bool,
    closed: bool,
    views: HashMap<usize, Box<View>>,
    pending_view: bool,
}
pub(super) struct View {
    parent: usize,
    token: [u8; 16],
    projection: Option<data::Projection>,
    release_selected: bool,
    released: bool,
    first: Option<Failure>,
    wall_floor: i64,
    deadline: Instant,
}
fn wall_ms() -> Result<i64> {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| Failure::from(5))?
        .as_millis();
    i64::try_from(t).map_err(|_| 5.into())
}
impl View {
    fn window(&mut self) -> Result<()> {
        let now = wall_ms()?;
        let p = self.projection.as_ref().ok_or(8)?;
        if now < self.wall_floor
            || now < p.not_before_ms
            || now >= p.expires_ms
            || Instant::now() >= self.deadline
        {
            return Err(5.into());
        }
        self.wall_floor = now;
        Ok(())
    }
}
impl Client {
    fn first(&mut self, e: Failure) -> Failure {
        *self.first.get_or_insert(e)
    }
    fn local(&mut self, cleanup: bool) -> Result<()> {
        if self.thread != thread::current().id() {
            return Err(4.into());
        }
        if self.closed {
            return Err(8.into());
        }
        if !cleanup {
            if let Some(e) = self.first {
                return Err(e);
            }
            if self.started.elapsed() >= Duration::from_secs(30) {
                return Err(5.into());
            }
            if let Some(r) = self.row {
                r.current()?;
                r.local(false)?;
                self.images.current()?;
                let fd = self.fd.as_ref().ok_or(8)?;
                if r.peer(fd, &self.images, false)? != self.peer.ok_or(8)?.pid {
                    return Err(7.into());
                }
            }
        }
        if let Some(fd) = self.fd.as_ref() {
            if cleanup {
                resource::same_cleanup_peer(fd, self.peer.ok_or(8)?)?
            } else {
                resource::same_peer(fd, self.peer.ok_or(8)?)?
            }
        }
        Ok(())
    }
    fn call(&mut self, command: wire::Command, body: &[u8], cleanup: bool) -> Result<data::Reply> {
        if let Err(e) = self.local(cleanup) {
            return Err(self.first(e));
        }
        let n = self.sequence.checked_add(1).ok_or(8)?;
        self.sequence = n;
        let result = (|| {
            let fd = self.fd.as_ref().ok_or(8)?;
            let stream = fd.stream();
            let mut s = &*stream;
            wire::write_packet(
                &mut s,
                wire::Header {
                    command,
                    sequence: n,
                    owner: self.owner,
                    digest: wire::digest(body),
                },
                body,
            )?;
            let (h, b) = wire::read_packet(&mut s)?;
            if h.command != command || h.sequence != n {
                return Err(7.into());
            }
            let reply = data::reply(&b)?;
            let (o, _v) = reply.tokens()?;
            if h.owner != o || (self.owner != [0; 16] && o != self.owner) {
                return Err(7.into());
            }
            if command == wire::Command::MainPairReadOpen {
                if o != [0; 16] {
                    self.owner = o
                }
            } else if o != self.owner || o == [0; 16] {
                return Err(7.into());
            }
            // Return the valid packet BEFORE late code/current. Callers adopt view/
            // physicalDone and public projection first, then run checked_reply.
            Ok(reply)
        })();
        match result {
            Ok(r) => Ok(r),
            Err(e) => Err(self.first(e)),
        }
    }
    fn checked_reply(&mut self, r: &data::Reply, cleanup: bool) -> Result<()> {
        if r.error_present {
            return Err(self.first(Failure {
                code: r.original_first,
                unknown: r.unknown,
            }));
        }
        if r.unknown {
            return Err(self.first(8.into()));
        }
        if let Err(e) = self.local(cleanup) {
            return Err(self.first(e));
        }
        Ok(())
    }
    fn current(&mut self) -> Result<()> {
        let r = self.call(wire::Command::MainPairReadCurrent, b"", false)?;
        if r.view != B64.encode([0; 16]) || r.projection.is_some() || r.physical_done {
            return Err(self.first(7.into()));
        }
        self.checked_reply(&r, false)
    }
    fn open(input: data::Open, row: &'static resource::ReadRow) -> (Option<Box<Self>>, Result<()>) {
        let pre = (|| {
            input.checked()?;
            row.current()?;
            row.local(false)?;
            if data::bytes(&input.registered_read_resource, 32, 32)? != row.id
                || data::bytes(&input.registered_source_resource, 32, 32)? != row.source
            {
                return Err(7.into());
            }
            Ok(())
        })();
        if let Err(e) = pre {
            return (None, Err(e));
        }
        let images = RegisteredImages::open(match row.role_source() {
            Ok(r) => r,
            Err(e) => return (None, Err(e.into())),
        });
        let mut c = Box::new(Self {
            row: Some(row),
            images: images.owner,
            fd: None,
            peer: None,
            thread: thread::current().id(),
            sequence: 0,
            owner: [0; 16],
            started: Instant::now(),
            first: None,
            open_selected: false,
            close_selected: false,
            remote_closed: false,
            closed: false,
            views: HashMap::new(),
            pending_view: false,
        });
        let result = (|| {
            if let Some(e) = images.error {
                return Err(e.into());
            }
            let stream = UnixStream::connect(row.socket).map_err(|_| 3)?;
            c.fd = Some(Fd::own(stream.into_raw_fd()));
            let fd = c.fd.as_ref().unwrap();
            fd.stream()
                .set_read_timeout(Some(Duration::from_secs(3)))
                .map_err(|_| 3)?;
            fd.stream()
                .set_write_timeout(Some(Duration::from_secs(3)))
                .map_err(|_| 3)?;
            c.peer = Some(resource::actual(fd)?);
            row.peer(fd, &c.images, false)?;
            let raw = serde_json::to_vec(&input).map_err(|_| 2)?;
            c.open_selected = true;
            let r = c.call(wire::Command::MainPairReadOpen, &raw, false)?;
            if r.view != B64.encode([0; 16]) || r.projection.is_some() || r.physical_done {
                return Err(7.into());
            }
            c.checked_reply(&r, false)?;
            if c.owner == [0; 16] {
                return Err(8.into());
            }
            Ok(())
        })();
        if let Err(e) = result {
            c.first(e);
        }
        (Some(c), result)
    }
    fn open_view(&mut self, parent: usize) -> (Option<usize>, Result<()>) {
        // Do not acquire a speculative replacement while an original view is live.
        if self.pending_view || self.views.values().any(|v| !v.released) {
            return (None, Err(8.into()));
        }
        self.pending_view=true; // reserve debt BEFORE the selected remote read
        let r = match self.call(wire::Command::MainPairReadViewOpen, b"", false) {
            Ok(r) => r,
            Err(e) => return (None, Err(e)),
        };
        let token = match data::token(&r.view) {
            Ok(v) => v,
            Err(e) => return (None, Err(self.first(e.into()))),
        };
        let now = wall_ms().unwrap_or(i64::MAX);
        let remaining =
            r.projection
                .as_ref()
                .map_or(0, |p| p.expires_ms.saturating_sub(now).clamp(0, 30000)) as u64;
        let key = if token != [0; 16] {
            let mut v = Box::new(View {
                parent,
                token,
                projection: r.projection.clone(),
                release_selected: false,
                released: false,
                first: None,
                wall_floor: now,
                deadline: Instant::now() + Duration::from_millis(remaining),
            });
            let k = (&mut *v as *mut View) as usize;
            self.views.insert(k, v);
            self.pending_view=false; // actual retained view now owns the debt
            Some(k)
        } else {
            if !r.unknown { self.pending_view=false; }
            None
        };
        let result = (|| {
            self.checked_reply(&r, false)?;
            if key.is_none() || r.projection.is_none() || r.physical_done {
                return Err(7.into());
            }
            r.checked()?;
            self.views.get_mut(&key.unwrap()).unwrap().window()?;
            Ok(())
        })();
        if let Err(e) = result {
            self.first(e);
            if let Some(k) = key {
                self.views.get_mut(&k).unwrap().first = Some(e)
            }
        }
        (key, result)
    }
    fn release(&mut self, key: usize) -> Result<()> {
        let v = self.views.get(&key).ok_or(2)?;
        if v.released {
            return v.first.map_or(Ok(()), Err);
        }
        if v.release_selected {
            return Err(v.first.unwrap_or(8.into()));
        }
        let token = v.token;
        self.views.get_mut(&key).unwrap().release_selected = true;
        let result = (|| {
            let raw = serde_json::to_vec(&data::Release {
                version: 1,
                view: B64.encode(token),
            })
            .map_err(|_| 2)?;
            let r = self.call(wire::Command::MainPairReadViewRelease, &raw, true)?;
            // Canonical Main RELEASE returns no new view (zero16). The
            // original token was in this SAME sequence-bound request body.
            if data::token(&r.view)? != [0;16] || r.projection.is_some() {
                return Err(7.into());
            }
            if r.physical_done {
                self.views.get_mut(&key).unwrap().released = true;
            }
            self.checked_reply(&r, true)?;
            if !r.physical_done {
                return Err(8.into());
            }
            Ok(())
        })();
        if let Err(e) = result {
            self.views.get_mut(&key).unwrap().first.get_or_insert(e);
        }
        result
    }
    fn close(&mut self) -> Result<()> {
        if self.thread != thread::current().id() {
            return Err(4.into());
        }
        if self.closed {
            return self.first.map_or(Ok(()), Err);
        }
        if self.pending_view || self.views.values().any(|v| !v.released) {
            return Err(8.into());
        }
        // Failed open before packet selection has no remote owner/debt. A failed
        // selected OPEN with no ACK DOES: retain it UNKNOWN, never reconnect.
        if self.open_selected && !self.remote_closed {
            if self.close_selected || self.owner == [0; 16] {
                return Err(self.first.unwrap_or(8.into()));
            }
            self.close_selected = true;
            let r = self.call(wire::Command::MainPairReadClose, b"", true)?;
            if r.view != B64.encode([0; 16]) || r.projection.is_some() {
                return Err(self.first(7.into()));
            }
            if r.physical_done {
                self.remote_closed = true;
            }
            let checked = self.checked_reply(&r, true);
            if !self.remote_closed {
                return Err(checked.err().unwrap_or(8.into()));
            }
        }
        if let Some(fd) = self.fd.as_mut() {
            fd.close()?;
        } // child transport before images
        self.images.close()?;
        self.closed = true;
        self.first.map_or(Ok(()), Err)
    }
}
thread_local! {static CLIENTS:RefCell<HashMap<usize,Box<Client>>>=RefCell::new(HashMap::new());}
// Never hold an inventory RefCell/foreign global mutex across IO/current.
// Removed objects are still owned and restored on unwinding, not new handles.
struct ClientGuard {
    key: usize,
    value: Option<Box<Client>>,
}
impl ClientGuard {
    fn take(key: usize) -> Result<Self> {
        let v = CLIENTS.with(|m| {
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
    fn get(&mut self) -> &mut Client {
        self.value.as_mut().unwrap()
    }
}
impl Drop for ClientGuard {
    fn drop(&mut self) {
        if let Some(v) = self.value.take() {
            CLIENTS.with(|m| {
                m.borrow_mut().insert(self.key, v);
            })
        }
    }
}

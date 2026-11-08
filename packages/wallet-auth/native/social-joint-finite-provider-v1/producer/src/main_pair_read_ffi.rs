//! Exact private C ABI: opaque native owners, never serialized Go handles.
use super::*;
#[repr(C)]
#[derive(Clone, Copy)]
pub(super) struct Span {
    data: *const u8,
    size: usize,
}
#[repr(C)]
pub(super) struct Input {
    version: u32,
    size: u32,
    source: [u8; 32],
    registration: Span,
    issuer: Span,
    anchor: Span,
    history: Span,
    reference: u64,
}
#[repr(C)]
pub(super) struct Status {
    version: u32,
    size: u32,
    error_present: u32,
    original_first: i32,
    physical_done: u32,
    unknown: u32,
}
#[repr(C)]
pub(super) struct PairView {
    version: u32,
    size: u32,
    view: u64,
    application: [Span; 6],
    classic: Span,
    pq: Span,
    issuer: Span,
    subject: Span,
    not_before_ms: i64,
    expires_ms: i64,
}
const _: () = {
    assert!(std::mem::size_of::<Input>() == 112);
    assert!(std::mem::size_of::<Status>() == 24);
    assert!(std::mem::size_of::<PairView>() == 192);
};
fn range(p: usize, n: usize) -> std::result::Result<(usize, usize), i32> {
    if p == 0 || n == 0 {
        return Err(2);
    }
    Ok((p, p.checked_add(n).ok_or(2)?))
}
fn overlaps(a: (usize, usize), b: (usize, usize)) -> bool {
    a.0 < b.1 && b.0 < a.1
}
fn disjoint(spans: &[(usize, usize)]) -> Result<()> {
    for (i, a) in spans.iter().enumerate() {
        for b in &spans[i + 1..] {
            if overlaps(*a, *b) {
                return Err(2.into());
            }
        }
    }
    Ok(())
}
fn aligned<T>(p: *const T) -> Result<()> {
    if p.is_null() || (p as usize) % std::mem::align_of::<T>() != 0 || !owned_safe(object(p)?) {
        return Err(2.into());
    }
    Ok(())
}
fn object<T>(p: *const T) -> std::result::Result<(usize, usize), i32> {
    range(p as usize, std::mem::size_of::<T>())
}
fn owned_safe(r: (usize, usize)) -> bool {
    if admission::protects(r.0, r.1) {
        return false;
    }
    CLIENTS.with(|m| {
        m.try_borrow()
            .map(|m| {
                m.values().all(|c| {
                    if overlaps(r, object(&**c).unwrap()) {
                        return false;
                    }
                    c.views.values().all(|v| {
                        if overlaps(r, object(&**v).unwrap()) {
                            return false;
                        }
                        v.projection.as_ref().is_none_or(|p| {
                            p.application
                                .iter()
                                .chain([
                                    &p.classic_public,
                                    &p.pq_public,
                                    &p.account_issuer,
                                    &p.account_subject,
                                ])
                                .all(|s| {
                                    s.is_empty()
                                        || !overlaps(
                                            r,
                                            range(s.as_ptr() as usize, s.len()).unwrap(),
                                        )
                                })
                        })
                    })
                })
            })
            .unwrap_or(false)
    })
}
fn status_safe(p: *mut Status) -> bool {
    if aligned(p).is_err() {
        return false;
    }
    object(p).ok().is_some_and(owned_safe)
}
fn finish(p: *mut Status, done: bool, r: Result<()>) {
    if !status_safe(p) {
        return;
    }
    let e = r.err();
    unsafe {
        *p = Status {
            version: 1,
            size: 24,
            error_present: e.is_some() as u32,
            original_first: e.map_or(0, |e| e.code),
            physical_done: done as u32,
            unknown: e.is_some_and(|e| e.unknown) as u32,
        }
    }
}
fn boundary(p: *mut Status, f: impl FnOnce() -> (bool, Result<()>)) {
    if !status_safe(p) {
        return;
    }
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    match r {
        Ok((d, r)) => finish(p, d, r),
        Err(_) => finish(p, false, Err(8.into())),
    }
}
fn status_disjoint(s:*mut Status,p:usize,n:usize)->bool{match(object(s),range(p,n)){(Ok(a),Ok(b))=>!overlaps(a,b),(Ok(_),Err(_))=>true,_=>false}}
unsafe fn original(s: Span) -> Result<Vec<u8>> {
    if s.size == 0 || s.size > 65536 {
        return Err(2.into());
    }
    range(s.data as usize, s.size)?;
    Ok(unsafe { std::slice::from_raw_parts(s.data, s.size) }.to_vec())
}
unsafe fn input(
    raw: *const Input,
    f06: *const u8,
    n: usize,
) -> Result<(data::Open, Vec<(usize, usize)>)> {
    aligned(raw)?;
    if n != 32 {
        return Err(2.into());
    }
    let f = range(f06 as usize, n)?;
    let i = unsafe { &*raw };
    if i.version != 2 || i.size != 112 || i.reference != 0 || i.source == [0; 32] {
        return Err(2.into());
    }
    let spans = [i.registration, i.issuer, i.anchor, i.history];
    let mut protected = vec![object(raw)?, f];
    let mut originals = Vec::new();
    for s in spans {
        protected.push(range(s.data as usize, s.size)?);
        originals.push(B64.encode(unsafe { original(s) }?));
    }
    let f06 = unsafe { std::slice::from_raw_parts(f06, n) };
    if f06 == [0; 32] {
        return Err(2.into());
    }
    let q = data::Open {
        version: 1,
        purpose: data::PURPOSE.into(),
        registered_read_resource: String::new(),
        registered_source_resource: B64.encode(i.source),
        f06_record_digest: B64.encode(f06),
        registration_original: originals[0].clone(),
        issuer_credential_original: originals[1].clone(),
        anchor_credential_original: originals[2].clone(),
        history_envelope_original: originals[3].clone(),
    };
    Ok((q, protected))
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_open_v1(
    i: *const Input,
    f: *const u8,
    n: usize,
    out: *mut *mut Client,
    status: *mut Status,
) {
    if !status_disjoint(status,i as usize,std::mem::size_of::<Input>())||!status_disjoint(status,out as usize,std::mem::size_of::<*mut Client>())||!status_disjoint(status,f as usize,n){return}
    if aligned(i).is_ok(){let q=unsafe{&*i};for span in[q.registration,q.issuer,q.anchor,q.history]{if span.size>0&&!status_disjoint(status,span.data as usize,span.size){return}}}
    boundary(status, || {
        let r = (|| {
            aligned(out)?;
            let (mut q, protected) = unsafe { input(i, f, n) }?;
            let outs = [object(out)?, object(status)?];
            disjoint(&outs)?;
            for a in outs {
                if protected.iter().any(|b| overlaps(a, *b)) {
                    return Err(2.into());
                }
            }
            if unsafe { !(*out).is_null() } {
                return Err(2.into());
            }
            let source = data::bytes(&q.registered_source_resource, 32, 32)?
                .try_into()
                .map_err(|_| 2)?;
            let row = resource::selected(Some(source), None)?;
            q.registered_read_resource = B64.encode(row.id);
            let (c, r) = Client::open(q, row);
            if let Some(mut c) = c {
                let k = (&mut *c as *mut Client) as usize;
                CLIENTS.with(|m| m.borrow_mut().insert(k, c));
                unsafe { *out = k as *mut Client };
            }
            r
        })();
        (false, r)
    })
}
#[unsafe(no_mangle)]
pub(super) extern "C" fn ynx_auth_registered_main_pair_current_v1(
    raw: *mut Client,
    s: *mut Status,
) {
    boundary(s, || {
        (
            false,
            (|| ClientGuard::take(raw as usize)?.get().current())(),
        )
    })
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_view_open_v1(
    raw: *mut Client,
    out: *mut *mut View,
    s: *mut Status,
) {
    if !status_disjoint(s,out as usize,std::mem::size_of::<*mut View>()){return}
    boundary(s, || {
        let r = (|| {
            aligned(out)?;
            disjoint(&[object(out)?, object(s)?])?;
            if unsafe { !(*out).is_null() } {
                return Err(2.into());
            }
            let mut g = ClientGuard::take(raw as usize)?;
            if overlaps(object(out)?, object(&*g.get())?) {
                return Err(2.into());
            }
            let (k, r) = g.get().open_view(raw as usize);
            if let Some(k) = k {
                unsafe { *out = k as *mut View }
            }
            r
        })();
        (false, r)
    })
}
fn view_current(c: &mut Client, key: usize) -> Result<()> {
    let v = c.views.get_mut(&key).ok_or(2)?;
    if v.parent == 0 || v.released || v.release_selected {
        return Err(8.into());
    }
    if let Some(e) = v.first {
        return Err(e);
    }
    v.window()?;
    c.current()?;
    c.views.get_mut(&key).unwrap().window()
}
#[unsafe(no_mangle)]
pub(super) extern "C" fn ynx_auth_registered_main_pair_view_current_v1(
    raw: *mut Client,
    v: *mut View,
    s: *mut Status,
) {
    boundary(s, || {
        (
            false,
            (|| {
                let mut g = ClientGuard::take(raw as usize)?;
                view_current(g.get(), v as usize)
            })(),
        )
    })
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_view_copy_v1(
    raw: *mut Client,
    v: *mut View,
    storage: *mut u8,
    cap: usize,
    out: *mut PairView,
    s: *mut Status,
) {
    if !status_disjoint(s,storage as usize,cap)||!status_disjoint(s,out as usize,std::mem::size_of::<PairView>()){return}
    boundary(s, || {
        let r = (|| {
            if cap < 8192 || cap > 8192 {
                return Err(2.into());
            }
            aligned(out)?;
            let output = [range(storage as usize, cap)?, object(out)?, object(s)?];
            disjoint(&output)?;
            if output.iter().any(|r| !owned_safe(*r)) {
                return Err(2.into());
            }
            let mut g = ClientGuard::take(raw as usize)?;
            let c = g.get();
            let view = c.views.get(&(v as usize)).ok_or(2)?;
            for a in output {
                if overlaps(a, object(&*c)?) || overlaps(a, object(&**view)?) {
                    return Err(2.into());
                }
                if let Some(p) = view.projection.as_ref() {
                    for st in p.application.iter().chain([
                        &p.classic_public,
                        &p.pq_public,
                        &p.account_issuer,
                        &p.account_subject,
                    ]) {
                        if overlaps(a, range(st.as_ptr() as usize, st.len())?) {
                            return Err(2.into());
                        }
                    }
                }
            }
            view_current(c, v as usize)?;
            let p = c
                .views
                .get(&(v as usize))
                .unwrap()
                .projection
                .clone()
                .ok_or(8)?;
            p.checked()?;
            let classic = data::bytes(&p.classic_public, 33, 33)?;
            let pq = data::bytes(&p.pq_public, 2592, 2592)?;
            let mut at = 0;
            let mut put = |b: &[u8]| -> Span {
                let ptr = unsafe { storage.add(at) };
                unsafe { std::ptr::copy_nonoverlapping(b.as_ptr(), ptr, b.len()) };
                at += b.len();
                Span {
                    data: ptr,
                    size: b.len(),
                }
            };
            let application = std::array::from_fn(|i| put(p.application[i].as_bytes()));
            let classic = put(&classic);
            let pq = put(&pq);
            let issuer = put(p.account_issuer.as_bytes());
            let subject = put(p.account_subject.as_bytes());
            unsafe {
                *out = PairView {
                    version: 1,
                    size: 192,
                    view: v as usize as u64,
                    application,
                    classic,
                    pq,
                    issuer,
                    subject,
                    not_before_ms: p.not_before_ms,
                    expires_ms: p.expires_ms,
                }
            }; // actual partial before post-current
            view_current(c, v as usize)
        })();
        (false, r)
    })
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_view_release_v1(
    raw: *mut Client,
    v: *mut *mut View,
    s: *mut Status,
) {
    if !status_disjoint(s,v as usize,std::mem::size_of::<*mut View>()){return}
    boundary(s, || {
        let mut done = false;
        let r = (|| {
            aligned(v)?;
            disjoint(&[object(v)?, object(s)?])?;
            let key = unsafe { *v } as usize;
            let mut g = ClientGuard::take(raw as usize)?;
            let c = g.get();
            let r = c.release(key);
            done = c.views.get(&key).is_some_and(|v| v.released);
            if done {
                unsafe { *v = std::ptr::null_mut() }
            }
            r
        })();
        (done, r)
    })
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_close_v1(
    raw: *mut *mut Client,
    s: *mut Status,
) {
    if !status_disjoint(s,raw as usize,std::mem::size_of::<*mut Client>()){return}
    boundary(s, || {
        let mut done = false;
        let r = (|| {
            aligned(raw)?;
            disjoint(&[object(raw)?, object(s)?])?;
            let key = unsafe { *raw } as usize;
            let mut g = ClientGuard::take(key)?;
            let c = g.get();
            let r = c.close();
            done = c.closed;
            if done {
                unsafe { *raw = std::ptr::null_mut() }
            }
            r
        })();
        (done, r)
    })
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_server_open_v1(
    id: *const u8,
    n: usize,
    fd: i32,
    out: *mut *mut admission::Server,
    s: *mut Status,
) {
    if !status_disjoint(s,id as usize,n)||!status_disjoint(s,out as usize,std::mem::size_of::<*mut admission::Server>()){return}
    boundary(s, || {
        let r = (|| {
            aligned(out)?;
            if n != 32 || unsafe { !(*out).is_null() } {
                return Err(2.into());
            }
            disjoint(&[range(id as usize, n)?, object(out)?, object(s)?])?;
            let id = unsafe { std::slice::from_raw_parts(id, n) }
                .try_into()
                .map_err(|_| 2)?;
            let (k, r) = admission::open(id, fd);
            if let Some(k) = k {
                unsafe { *out = k as *mut admission::Server }
            }
            r
        })();
        (false, r)
    })
}
#[unsafe(no_mangle)]
pub(super) extern "C" fn ynx_auth_registered_main_pair_server_current_v1(
    p: *mut admission::Server,
    s: *mut Status,
) {
    boundary(s, || (false, admission::current(p as usize)))
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_peer_open_v1(
    p: *mut admission::Server,
    fd: i32,
    out: *mut *mut admission::Peer,
    s: *mut Status,
) {
    if !status_disjoint(s,out as usize,std::mem::size_of::<*mut admission::Peer>()){return}
    boundary(s, || {
        let r = (|| {
            aligned(out)?;
            disjoint(&[object(out)?, object(s)?])?;
            if unsafe { !(*out).is_null() } {
                return Err(2.into());
            }
            let (k, r) = admission::peer_open(p as usize, fd);
            if let Some(k) = k {
                unsafe { *out = k as *mut admission::Peer }
            }
            r
        })();
        (false, r)
    })
}
#[unsafe(no_mangle)]
pub(super) extern "C" fn ynx_auth_registered_main_pair_peer_current_v1(
    p: *mut admission::Peer,
    s: *mut Status,
) {
    boundary(s, || (false, admission::peer_current(p as usize)))
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_peer_close_v1(
    p: *mut *mut admission::Peer,
    s: *mut Status,
) {
    if !status_disjoint(s,p as usize,std::mem::size_of::<*mut admission::Peer>()){return}
    boundary(s, || {
        if aligned(p).is_err() {
            return (false, Err(2.into()));
        }
        let (done, r) = admission::peer_close(unsafe { *p } as usize);
        if done {
            unsafe { *p = std::ptr::null_mut() }
        }
        (done, r)
    })
}
#[unsafe(no_mangle)]
pub(super) unsafe extern "C" fn ynx_auth_registered_main_pair_server_close_v1(
    p: *mut *mut admission::Server,
    s: *mut Status,
) {
    if !status_disjoint(s,p as usize,std::mem::size_of::<*mut admission::Server>()){return}
    boundary(s, || {
        if aligned(p).is_err() {
            return (false, Err(2.into()));
        }
        let (done, r) = admission::close(unsafe { *p } as usize);
        if done {
            unsafe { *p = std::ptr::null_mut() }
        }
        (done, r)
    })
}

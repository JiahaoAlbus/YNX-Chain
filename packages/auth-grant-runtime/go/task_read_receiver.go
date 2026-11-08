//go:build darwin || linux

package grantruntime

import (
	"context"
	"encoding/json"
	"errors"
	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"
	policy "ynx.local/authgrantpolicy"
)

var ErrTaskReadReceiverNotSupplied = errors.New("ORIGINAL_TASK_READ_RECEIVER_REGISTRATION_NOT_SUPPLIED")
var ErrTaskReadReceiverDraining = errors.New("ORIGINAL_TASK_READ_RECEIVER_CHILDREN_RETAINED")

const taskReadService = "ynx-ai-original-task-read-v1"

var taskReadPaths = [3]string{"/internal/ai/original-task-read/input", "/internal/ai/original-task-read/execute", "/internal/ai/original-task-read/query"}

// Private Root-owned configuration selection, NOT a Source signature format,
// grant, effect capability or public registration API. A release supplier must
// supply the independent accepted receiver-purpose Source before any such row
// can be admitted. No such Source-purpose binding/real row is supplied here.
type taskReadReceiverRelease struct {
	Source                                        releaseSelection
	SourceVersion                                 policy.SourceVersion
	Authority, Realm, Tenant, Namespace, Resource string
	RegistrationParent                            receiverDirectory
	RegistrationLeaf                              string
}

var originalTaskReadReceiverReleases = [...]taskReadReceiverRelease{}

// Retain every actual partial with FDs until physical closure. A dropped Go
// reference must not let os.File GC close an ambiguous child/its parents.
var originalTaskReadReceiverCustody sync.Map // *TaskReadReceiverRuntime -> struct{}
type receiverRoute struct {
	Method, Path            string
	MaxBodyBytes, TimeoutMS int64
}

// This is bounded private postbuild transport configuration DATA ONLY, not a
// new signed Source projection/approval grammar. It does not contain keys.
type taskReadReceiverRegistration struct {
	Version, Resource, Authority, Realm, Tenant, Namespace            string
	SourceVersion                                                     policy.SourceVersion
	Local, Peer                                                       receiverProcess
	SocketParent                                                      receiverDirectory
	SocketLeaf                                                        string
	Routes                                                            []receiverRoute
	ReadHeaderTimeoutMS, ReadTimeoutMS, WriteTimeoutMS, IdleTimeoutMS int64
	MaxHeaderBytes                                                    int
	IssuedMS, ExpiresMS                                               string
}
type TaskReadReceiverRuntime struct {
	mu                      sync.Mutex
	work                    sync.Mutex
	source                  *Runtime
	proof                   *heldSource
	registration            *receiverFile
	images                  []*receiverFile
	socketDirectory         *receiverFile
	proofDrain, sourceDrain *receiverDocumentDrain
	selection               taskReadReceiverRelease
	record                  taskReadReceiverRegistration
	socket                  string
	socketInfo              os.FileInfo
	handed                  bool
	first, errorClose       error
	retired, closed         bool
	active                  int
	floor                   int64
	deadline                time.Time
	clock                   func() time.Time
}

// Normal zero-input construction. No path, handler, Source, PID, Config or
// provider is accepted. An optional missing receiver never retires a separate
// still-valid grant/current Source. Always adopt a nonnull returned partial.
func OpenOriginalTaskReadReceiverRuntime() (*TaskReadReceiverRuntime, error) {
	if len(originalTaskReadReceiverReleases) != 1 {
		r := &TaskReadReceiverRuntime{clock: time.Now, first: errors.Join(ErrUnavailable, ErrTaskReadReceiverNotSupplied)}
		return r, r.first
	}
	for _, s := range originalTaskReadReceiverReleases {
		return openTaskReadReceiverRuntime(context.Background(), s, 0)
	}
	return nil, ErrTaskReadReceiverNotSupplied
}
func openTaskReadReceiverRuntime(ctx context.Context, s taskReadReceiverRelease, rootUID uint32) (r *TaskReadReceiverRuntime, err error) {
	r = &TaskReadReceiverRuntime{selection: s, clock: time.Now, floor: -1}
	defer func() {
		if err != nil {
			r.first = err
		}
	}()
	if ctx == nil || s.Source.Authority != s.Authority || s.Source.Realm != s.Realm || s.Source.Tenant != s.Tenant || s.Authority == "" || s.Realm == "" || s.Tenant == "" || s.Namespace == "" || s.Resource == "" || s.SourceVersion.Authority != s.Authority {
		return r, ErrUnavailable
	}
	originalTaskReadReceiverCustody.Store(r, struct{}{})
	r.source, err = openProtectedRuntime(s.Source)
	if err != nil {
		return r, err
	}
	p := r.source.projection
	if p.Snapshot.Version != s.SourceVersion {
		return r, ErrCurrent
	}
	if p.Snapshot.Issuer.Status!="active"||p.Snapshot.Issuer.Ref!=p.Issuer.Principal||p.Snapshot.Issuer.Epoch!=p.Issuer.Epoch||p.Snapshot.Holder.Status!="active"||p.Snapshot.Holder.Ref!=p.Holder.Principal||p.Snapshot.Holder.Epoch!=p.Holder.Epoch{return r,ErrCurrent}
	// Reuse the original E21/E3/Core dual-AND path ONLY to authenticate SAME
	// Source provenance. No Policy.OpenCheck, NEW test/reserve/claim or grant
	// effect authorization is used as receiver registration/approval.
	held, e := r.source.OpenTaskGrantSource(ctx, p.Snapshot.Grant.Binding, p.GrantProof, p.HolderProof)
	if held != nil {
		var ok bool
		r.proof, ok = held.(*heldSource)
		if !ok {
			return r, ErrProof
		}
	}
	if e != nil {
		return r, e
	}
	if r.proof == nil {
		return r, ErrUnavailable
	}
	r.registration, err = holdReceiverRegistration(s.RegistrationParent, s.RegistrationLeaf, rootUID)
	if err != nil {
		return r, err
	}
	if err = decodePrivate(r.registration.raw, &r.record); err != nil {
		return r, err
	}
	if err = r.validateRecord(); err != nil {
		return r, err
	}
	for _, p := range []receiverProcess{r.record.Local, r.record.Peer} {
		image, e := openReceiverFile(protectedRef{Path: p.Image.Path, Bytes: p.Image.Bytes, SHA256: p.Image.SHA256}, rootUID, 256<<20, true)
		r.images = append(r.images, image)
		if e != nil {
			return r, e
		}
	}
	r.socketDirectory, err = holdReceiverSocketDirectory(r.record.SocketParent, uint32(os.Geteuid()))
	if err != nil {
		return r, err
	}
	r.socket = filepath.Join(r.record.SocketParent.Path, r.record.SocketLeaf)
	now := r.clock()
	end, _ := exactUint(r.record.ExpiresMS)
	sourceEnd, _ := exactUint(p.Snapshot.Expires)
	if sourceEnd < end {
		end = sourceEnd
	}
	if now.UnixMilli() < 0 || uint64(now.UnixMilli()) >= end {
		return r, ErrCurrent
	}
	remaining := end - uint64(now.UnixMilli())
	if remaining > uint64((1<<63-1)/int64(time.Millisecond)) {
		return r, ErrProof
	}
	r.deadline = now.Add(time.Duration(remaining) * time.Millisecond)
	if err = r.Current(ctx); err != nil {
		return r, err
	}
	return r, nil
}
func (r *TaskReadReceiverRuntime) validateRecord() error {
	s, p := r.selection, r.record
	if p.Version != "AUTH-ORIGINAL-TASK-READ-RECEIVER/private-v1" || p.Resource != s.Resource || p.Authority != s.Authority || p.Realm != s.Realm || p.Tenant != s.Tenant || p.Namespace != s.Namespace || p.SourceVersion != s.SourceVersion {
		return ErrProof
	}
	if p.Local.PID != os.Getpid() || p.Local.UID != uint32(os.Geteuid()) || p.Local.GID != uint32(os.Getegid()) || p.Local.UID == 0 || p.Peer.UID == 0 || p.Peer.PID <= 0 || p.Peer.Start == "" || p.Local.Start == "" {
		return ErrProof
	}
	if p.SocketParent.UID != p.Local.UID || p.SocketParent.GID != p.Local.GID || p.SocketParent.Mode != 0700 || p.SocketParent.Device == 0 || p.SocketParent.Inode == 0 || !filepath.IsAbs(p.SocketParent.Path) || filepath.Clean(p.SocketParent.Path) != p.SocketParent.Path || p.SocketLeaf == "" || filepath.Base(p.SocketLeaf) != p.SocketLeaf || p.SocketLeaf == "." || p.SocketLeaf == ".." || strings.ContainsAny(p.SocketLeaf, "\x00\\") {
		return ErrProof
	}
	if len(filepath.Join(p.SocketParent.Path, p.SocketLeaf)) > 103 {
		return ErrProof
	}
	from, e := exactUint(p.IssuedMS)
	if e != nil {
		return e
	}
	end, e := exactUint(p.ExpiresMS)
	if e != nil || from == 0 || end <= from || end > 9007199254740991 {
		return ErrProof
	}
	sourceFrom, e := exactUint(r.source.projection.Snapshot.ObservedAt)
	if e != nil {
		return e
	}
	sourceEnd, e := exactUint(r.source.projection.Snapshot.Expires)
	if e != nil || from < sourceFrom || end > sourceEnd {
		return ErrProof
	}
	if n, e := exactUint(p.SourceVersion.Revision); e != nil || n == 0 {
		return ErrProof
	}
	if n, e := exactUint(p.SourceVersion.PolicyRevision); e != nil || n == 0 {
		return ErrProof
	}
	if len(p.Routes) != 3 || p.MaxHeaderBytes < 1 || p.MaxHeaderBytes > 64<<10 {
		return ErrProof
	}
	seen := map[string]bool{}
	for _, route := range p.Routes {
		valid := false
		for _, path := range taskReadPaths {
			valid = valid || path == route.Path
		}
		if !valid || seen[route.Path] || route.Method != "POST" || route.MaxBodyBytes < 1 || route.MaxBodyBytes > 1<<20 || route.TimeoutMS < 1 || route.TimeoutMS > 60000 {
			return ErrProof
		}
		seen[route.Path] = true
	}
	for _, n := range []int64{p.ReadHeaderTimeoutMS, p.ReadTimeoutMS, p.WriteTimeoutMS, p.IdleTimeoutMS} {
		if n < 1 || n > 60000 {
			return ErrProof
		}
	}
	return nil
}
func (r *TaskReadReceiverRuntime) begin(ctx context.Context) error {
	if r == nil || ctx == nil {
		return ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.first != nil {
		return r.first
	}
	if r.retired || r.closed {
		return ErrRetired
	}
	r.active++
	return nil
}
func (r *TaskReadReceiverRuntime) end() { r.mu.Lock(); r.active--; r.mu.Unlock() }
func (r *TaskReadReceiverRuntime) post(ctx context.Context) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.first != nil {
		return r.first
	}
	if r.retired || r.closed {
		return ErrRetired
	}
	return nil
}
func (r *TaskReadReceiverRuntime) latch(ctx context.Context, e error) error {
	if e == nil {
		return nil
	}
	if ctx.Err() != nil {
		return e
	}
	r.mu.Lock()
	if r.first == nil {
		r.first = e
	}
	first := r.first
	r.mu.Unlock()
	return first
}
func (r *TaskReadReceiverRuntime) currentOriginal(ctx context.Context) error {
	if e := r.source.Current(ctx); e != nil {
		return e
	}
	if e := r.proof.current(ctx); e != nil {
		return e
	}
	if r.source.selection != r.selection.Source || r.proof.projection.Snapshot.Version != r.selection.SourceVersion {
		return ErrCurrent
	}
	if e := r.registration.current(); e != nil {
		return e
	}
	if !reflect.DeepEqual(r.registration.raw, mustReceiverRegistrationBytes(r.record)) {
		return ErrCurrent
	}
	for _, h := range r.images {
		if e := h.current(); e != nil {
			return e
		}
	}
	if e := r.assertProcesses(); e != nil {
		return e
	}
	if e := r.socketDirectory.current(); e != nil {
		return e
	}
	named, e := os.Lstat(r.socket)
	if e != nil && !os.IsNotExist(e) {
		return e
	}
	if e == nil {
		if !r.handed {
			return ErrCurrent
		}
		if e := receiverSocketInfo(named, r.record.Local.UID); e != nil {
			return e
		}
		if r.socketInfo == nil {
			r.socketInfo = named
		} else if !os.SameFile(r.socketInfo, named) {
			return ErrCurrent
		}
	} else if r.socketInfo != nil {
		return ErrCurrent
	}
	if e := r.checkWindow(); e != nil {
		return e
	}
	if e := r.registration.current(); e != nil {
		return e
	}
	for _, h := range r.images {
		if e := h.current(); e != nil {
			return e
		}
	}
	if e := r.assertProcesses(); e != nil {
		return e
	}
	if e := r.source.Current(ctx); e != nil {
		return e
	}
	if e := r.proof.current(ctx); e != nil {
		return e
	}
	if e := r.checkWindow(); e != nil {
		return e
	}
	return ctx.Err()
}
func (r *TaskReadReceiverRuntime) Current(ctx context.Context) error {
	if e := r.begin(ctx); e != nil {
		return e
	}
	defer r.end()
	r.work.Lock()
	defer r.work.Unlock()
	e := r.currentOriginal(ctx)
	if e != nil {
		return r.latch(ctx, e)
	}
	return r.post(ctx)
}
func (r *TaskReadReceiverRuntime) ReadOriginalTaskReadReceiverRegistration(ctx context.Context) (string, link.LocalCallerServerConfig, error) {
	var zero link.LocalCallerServerConfig
	if e := r.begin(ctx); e != nil {
		return "", zero, e
	}
	defer r.end()
	r.work.Lock()
	defer r.work.Unlock()
	if e := r.currentOriginal(ctx); e != nil {
		return "", zero, r.latch(ctx, e)
	}
	p := r.record
	cfg := link.LocalCallerServerConfig{Service: taskReadService, PeerUID: p.Peer.UID, PeerPID: p.Peer.PID, ReadHeaderTimeout: time.Duration(p.ReadHeaderTimeoutMS) * time.Millisecond, ReadTimeout: time.Duration(p.ReadTimeoutMS) * time.Millisecond, WriteTimeout: time.Duration(p.WriteTimeoutMS) * time.Millisecond, IdleTimeout: time.Duration(p.IdleTimeoutMS) * time.Millisecond, MaxHeaderBytes: p.MaxHeaderBytes}
	for _, v := range p.Routes {
		cfg.Routes = append(cfg.Routes, link.LocalCallerRoute{Method: v.Method, Path: v.Path, MaxBodyBytes: v.MaxBodyBytes, Timeout: time.Duration(v.TimeoutMS) * time.Millisecond})
	}
	if e := r.currentOriginal(ctx); e != nil {
		return "", zero, r.latch(ctx, e)
	}
	if e := r.post(ctx); e != nil {
		return "", zero, e
	}
	r.handed = true
	return r.socket, cfg, nil
}
func (r *TaskReadReceiverRuntime) Retire() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	r.retired = true
	r.mu.Unlock()
	return nil
}
func (r *TaskReadReceiverRuntime) Join() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.retired {
		return ErrRetired
	}
	if r.active != 0 {
		return ErrTaskReadReceiverDraining
	}
	return nil
}
func (r *TaskReadReceiverRuntime) Close() error {
	if r == nil {
		return nil
	}
	r.Retire()
	if e := r.Join(); e != nil {
		return e
	}
	r.work.Lock()
	defer r.work.Unlock()
	r.mu.Lock()
	closed := r.closed
	first := r.errorClose
	r.mu.Unlock()
	if closed {
		return first
	}
	var e error
	// Stop immediately at first physical ambiguity; never close a parent across
	// an unresolved child. The same owner/FD/first cause remains reachable.
	if e = r.socketDirectory.close(); e == nil {
		for i := len(r.images) - 1; i >= 0; i-- {
			if e = r.images[i].close(); e != nil {
				break
			}
		}
	}
	if e == nil {
		e = r.registration.close()
	}
	if e == nil && r.proof != nil {
		r.proof.Retire()
		if r.proofDrain == nil {
			r.proofDrain = newReceiverDocumentDrain(r.proof.held)
		}
		e = r.proofDrain.close()
	}
	if e == nil && r.source != nil {
		r.source.Retire()
		if r.sourceDrain == nil {
			r.sourceDrain = newReceiverDocumentDrain(r.source.held)
		}
		e = r.sourceDrain.close()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if e != nil {
		if r.errorClose == nil {
			r.errorClose = e
		}
		return r.errorClose
	}
	r.closed = true
	originalTaskReadReceiverCustody.Delete(r)
	return r.errorClose
}

// Scope comparison narrows two original owners; it creates no permission and
// does not let an expired/revoked effect projection authorize a receiver.
func (r *Runtime) AssertOriginalTaskReadReceiverScope(ctx context.Context, receiver *TaskReadReceiverRuntime) error {
	if ctx == nil || r == nil || receiver == nil {
		return ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	r.mu.Lock()
	s := r.selection
	r.mu.Unlock()
	if s.Authority != receiver.selection.Authority || s.Realm != receiver.selection.Realm || s.Tenant != receiver.selection.Tenant {
		return ErrProof
	}
	return receiver.Current(ctx)
}
func mustReceiverRegistrationBytes(p taskReadReceiverRegistration) []byte {
	b, e := json.Marshal(p)
	if e != nil {
		return nil
	}
	return b
}
func (r *TaskReadReceiverRuntime) checkWindow() error {
	now := r.clock()
	at := now.UnixMilli()
	from, _ := exactUint(r.record.IssuedMS)
	end, _ := exactUint(r.record.ExpiresMS)
	if at < 0 || at < r.floor || uint64(at) < from || uint64(at) >= end || !now.Before(r.deadline) {
		return ErrCurrent
	}
	r.floor = at
	return nil
}
func (r *TaskReadReceiverRuntime) assertProcesses() error {
	for _, expected := range []receiverProcess{r.record.Local, r.record.Peer} {
		actual, e := observeReceiverProcess(expected.PID)
		if e != nil {
			return e
		}
		if actual.Path != expected.Image.Path || actual.UID != expected.UID || actual.GID != expected.GID || actual.Start != expected.Start {
			return ErrCurrent
		}
	}
	return nil
}

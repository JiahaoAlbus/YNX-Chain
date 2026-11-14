//go:build linux || darwin

package consensus

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"os"
	"sync"
	"time"

	"github.com/cometbft/cometbft/node"
	"golang.org/x/sys/unix"
)

// pqFreshScopeBroker is minted only from the original qualified v4 capture.
// Public fields/FDs/Source IDs cannot construct it. It owns no Node lifecycle.
type pqFreshScopeBroker struct {
	mu, writeMu      sync.Mutex
	process, readCtx context.Context
	stopRead         context.CancelFunc
	original         *pqOriginalFreshBrokerLaunch
	conn             *net.UnixConn
	host             *pqObserverAccountHost
	hostReady        chan struct{}
	hostOnce         sync.Once
	done             chan struct{}
	highest          uint64
	records          map[uint64]*pqFreshScopeRecord
	active           int
	sealed           bool
	first            error
	transportOnce    sync.Once
	transportErr     error
	cleanupOnce      sync.Once
	cleanupErr       error
}
type pqFreshScopeRecord struct {
	id             uint64
	owner          *pqOriginalSourceLaunch
	source         *pqProtectedSourceParent
	scope          *pqObserverAccountLaunch
	status, reason uint32
	failure        sourceParentFailure
	first          error
	done           chan struct{}
}

func newOriginalFreshScopeBroker(process context.Context, original *pqOriginalFreshBrokerLaunch) (broker *pqFreshScopeBroker, err error) {
	if process == nil || original == nil || original.original == nil || original.brokerFile == nil {
		return nil, errFreshScopeBroker
	}
	ctx, cancel := context.WithCancel(process) // broker read cancellation, not Source.process
	b := &pqFreshScopeBroker{process: process, readCtx: ctx, stopRead: cancel, original: original, hostReady: make(chan struct{}), done: make(chan struct{}), records: make(map[uint64]*pqFreshScopeRecord)}
	defer func() {
		if err != nil {
			// A nonnil partial never started run(), but still has closing custody.
			b.seal(err)
			close(b.done)
		}
	}()
	if err := original.original.checkPeers(process); err != nil {
		return b, err
	}
	if err := checkSourceSocket(original.broker, original.original.processes[0], original.original.processes[2]); err != nil {
		return b, err
	}
	c, err := net.FileConn(original.brokerFile)
	if err != nil {
		return b, err
	}
	err = original.brokerFile.Close()
	original.brokerFile = nil // close was attempted once, even on UNKNOWN
	if err != nil {
		_ = c.Close()
		return b, err
	}
	var ok bool
	b.conn, ok = c.(*net.UnixConn)
	if !ok {
		_ = c.Close()
		return b, errFreshScopeBroker
	}
	go b.run()
	return b, nil
}

// Private normal entry calls this ONCE on its actual original Node/App. Scope
// creation neither waits for proof Ready nor rebuilds/rebinds that App/Node.
func (b *pqFreshScopeBroker) bindOriginalHost(n *node.Node, app *Application) error {
	host, err := bindPQObserverAccountHost(n, app)
	if err != nil {
		return err
	}
	return b.bindHost(host)
}

// Normal startup already owns this same stable host. Reuse its sealed pointer;
// do not construct another Node/App or accept a caller-provided host provider.
func (b *pqFreshScopeBroker) bindHost(host *pqObserverAccountHost) error {
	if host == nil {
		return errFreshScopeBroker
	}
	if err := host.sameOriginal(); err != nil {
		return err
	}
	used := false
	b.hostOnce.Do(func() { b.mu.Lock(); b.host = host; b.mu.Unlock(); close(b.hostReady); used = true })
	if !used {
		return errFreshScopeBroker
	}
	return nil
}
func (b *pqFreshScopeBroker) check() error {
	if err := b.original.original.checkPeers(b.process); err != nil {
		return err
	}
	raw, e := b.conn.SyscallConn()
	if e != nil {
		return e
	}
	var result error
	e = raw.Control(func(fd uintptr) {
		stamp := b.original.broker
		stamp.fd = int(fd)
		result = checkSourceSocket(stamp, b.original.original.processes[0], b.original.original.processes[2])
	})
	return errors.Join(e, result)
}
func (b *pqFreshScopeBroker) result(id uint64) error {
	b.mu.Lock()
	r := b.records[id]
	status, reason := uint32(4), uint32(7)
	var f sourceParentFailure
	if r != nil {
		status, reason, f = r.status, r.reason, r.failure
	}
	b.mu.Unlock()
	b.writeMu.Lock()
	defer b.writeMu.Unlock()
	if e := b.check(); e != nil {
		return e
	}
	_ = b.conn.SetWriteDeadline(time.Now().Add(5 * time.Second)) // IO bound, never Source expiry
	return writePQFreshResult(b.conn, b.original.original.generation, id, status, f, reason)
}
func (b *pqFreshScopeBroker) run() {
	defer close(b.done)
	stop := context.AfterFunc(b.readCtx, b.closeTransport)
	defer stop()
	for {
		frame, err := readPQFreshFrame(b.conn)
		if err != nil {
			closePQFreshReceived(frame.files)
			b.seal(err)
			return
		}
		if err = b.check(); err != nil {
			closePQFreshReceived(frame.files)
			b.seal(err)
			return
		}
		generation, id := binary.BigEndian.Uint64(frame.body[:8]), binary.BigEndian.Uint64(frame.body[8:16])
		if generation != b.original.original.generation || id == 0 {
			closePQFreshReceived(frame.files)
			b.seal(errFreshScopeBroker)
			return
		}
		if frame.kind == 3 {
			if err = b.result(id); err != nil {
				b.seal(err)
				return
			}
			continue
		}
		// All actual received files have closing custody before any paired refusal.
		b.mu.Lock()
		if b.sealed || id != b.highest+1 {
			b.mu.Unlock()
			closePQFreshReceived(frame.files)
			b.seal(errFreshScopeBroker)
			return
		}
		// Bounded terminal history; failed/UNKNOWN owners are never evicted.
		// When all retained slots carry debt, stop admission, not that owner.
		b.pruneClosedLocked()
		if len(b.records) >= 34 {
			b.mu.Unlock()
			closePQFreshReceived(frame.files)
			b.seal(errPQAccountWireCapacity)
			return
		}
		b.highest = id
		record := &pqFreshScopeRecord{id: id, status: 1, done: make(chan struct{})}
		b.records[id] = record
		if b.active >= 2 {
			record.status = 3
			record.reason = 3
			record.first = errPQAccountWireCapacity
			b.mu.Unlock()
			closePQFreshReceived(frame.files)
			close(record.done)
			if err = b.result(id); err != nil {
				b.seal(err)
				return
			}
			continue
		}
		b.active++
		b.mu.Unlock()
		owner, e := b.adopt(frame)
		b.mu.Lock()
		record.owner = owner
		b.mu.Unlock()
		if e != nil {
			if owner != nil {
				e = errors.Join(e, owner.closeUnused())
			} else {
				closePQFreshReceived(frame.files)
			}
			b.finish(record, e, 1)
			if b.result(id) != nil {
				b.seal(e)
				return
			}
			continue
		}
		// Exactly one causal reply per request. Later attach updates only local
		// state; a QUERY is needed for its new result, never unsolicited frames.
		if err = b.result(id); err != nil {
			b.seal(err)
			go b.scope(record)
			return
		}
		go b.scope(record)
	}
}
func (b *pqFreshScopeBroker) adopt(f pqFreshBrokerFrame) (*pqOriginalSourceLaunch, error) {
	original := b.original.original
	account := sourcePortStamp{f.files[0], binary.BigEndian.Uint64(f.body[16:24]), binary.BigEndian.Uint64(f.body[24:32])}
	control := sourcePortStamp{f.files[1], binary.BigEndian.Uint64(f.body[32:40]), binary.BigEndian.Uint64(f.body[40:48])}
	owner := &pqOriginalSourceLaunch{generation: original.generation, profile: original.profile, processes: original.processes, account: account, control: control, accountFile: os.NewFile(uintptr(account.fd), "original fresh Core account"), controlFile: os.NewFile(uintptr(control.fd), "original fresh Core Source parent")}
	// No public origin bit. This private factory is called solely after a frame
	// received on the qualified captured broker and rechecked same process pins.
	for _, p := range []sourcePortStamp{account, control} {
		if p.inode == 0 {
			return owner, errFreshScopeBroker
		}
		var st unix.Stat_t
		if unix.Fstat(p.fd, &st) != nil || st.Uid != uint32(os.Geteuid()) {
			return owner, errFreshScopeBroker
		}
		if err := checkSourceSocket(p, original.processes[2], original.processes[2]); err != nil {
			return owner, err
		}
		for _, old := range []sourcePortStamp{original.current4, original.account, original.control, b.original.broker} {
			if p.device == old.device && p.inode == old.inode {
				return owner, errFreshScopeBroker
			}
		}
	}
	if account.device == control.device && account.inode == control.inode {
		return owner, errFreshScopeBroker
	}
	b.mu.Lock()
	for _, r := range b.records {
		if r.owner == nil {
			continue
		}
		for _, old := range []sourcePortStamp{r.owner.account, r.owner.control} {
			if old.device == account.device && old.inode == account.inode || old.device == control.device && old.inode == control.inode {
				b.mu.Unlock()
				return owner, errFreshScopeBroker
			}
		}
	}
	b.mu.Unlock()
	c, e := net.FileConn(owner.controlFile)
	if e != nil {
		return owner, e
	}
	if e = owner.controlFile.Close(); e != nil {
		_ = c.Close()
		return owner, e
	}
	owner.controlFile = nil
	var ok bool
	owner.sourceConn, ok = c.(*net.UnixConn)
	if !ok {
		_ = c.Close()
		return owner, errFreshScopeBroker
	}
	return owner, nil
}
func (b *pqFreshScopeBroker) scope(r *pqFreshScopeRecord) {
	owner := r.owner
	source, err := receiveOriginalSourceParentWithReadContext(b.process, b.readCtx, owner)
	b.mu.Lock()
	r.source = source
	sealed := b.sealed
	b.mu.Unlock()
	if err == nil && (sealed || b.readCtx.Err() != nil) {
		err = context.Canceled
	}
	if err == nil {
		err = b.readCtx.Err()
	}
	if err == nil {
		select {
		case <-b.hostReady:
		case <-b.readCtx.Done():
			err = b.readCtx.Err()
		}
	}
	if err == nil {
		err = b.readCtx.Err()
	}
	if err == nil {
		b.mu.Lock()
		host := b.host
		b.mu.Unlock()
		var scope *pqObserverAccountLaunch
		scope, err = source.attachOriginalAccountScope(host, owner)
		b.mu.Lock()
		r.scope = scope
		if err == nil && b.sealed {
			err = context.Canceled
		}
		if err == nil {
			r.status = 2
		}
		b.mu.Unlock()
	}
	if err != nil {
		if source != nil {
			source.cancel(context.Canceled, sourceParentFailure{reason: 4})
		}
		if r.scope != nil {
			// Attachment may have completed while seal raced it. Retire Source
			// but preserve this same SDK97 worker until its actual cleanup drains.
			r.scope.original.mu.Lock()
			wire := r.scope.original.wire
			r.scope.original.mu.Unlock()
			if wire != nil {
				<-wire.done
			}
			err = errors.Join(err, r.scope.close())
		}
		if source != nil {
			err = errors.Join(err, source.closeLocal())
		}
		err = errors.Join(err, owner.closeUnused())
		b.finish(r, err, 4)
		return
	}
	r.scope.original.mu.Lock()
	wire := r.scope.original.wire
	r.scope.original.mu.Unlock()
	if wire != nil {
		<-wire.done
	}
	// Core local worker EOF is local data only. The Native actual typed child
	// retains its Source loan until its OWN SDK/Source drain token completes.
	if source != nil {
		err = source.closeLocal()
	}
	err = errors.Join(err, r.scope.close(), owner.closeUnused())
	b.finish(r, err, 0)
}
func (b *pqFreshScopeBroker) finish(r *pqFreshScopeRecord, err error, reason uint32) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if r.first == nil {
		r.first = err
	}
	if err != nil {
		r.status = 3
		r.reason = reason
		var f sourceParentFailure
		if errors.As(err, &f) {
			r.failure = f
		}
	} else {
		r.status = 5
	}
	b.active--
	close(r.done)
	b.pruneClosedLocked()
}

func (b *pqFreshScopeBroker) pruneClosedLocked() {
	// Never evict unknown/active debt. Strict highest scope counter prevents
	// replay after bounded terminal history; old QUERY returns UNKNOWN_ID.
	terminal := 0
	for _, x := range b.records {
		select {
		case <-x.done:
			if x.first == nil {
				terminal++
			}
		default:
		}
	}
	for terminal > 32 {
		oldest := uint64(0)
		for id, x := range b.records {
			select {
			case <-x.done:
				if x.first == nil && (oldest == 0 || id < oldest) {
					oldest = id
				}
			default:
			}
		}
		if oldest == 0 {
			break
		}
		delete(b.records, oldest)
		terminal--
	}
}

func (b *pqFreshScopeBroker) failure() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.first
}

func (b *pqFreshScopeBroker) closeTransport() {
	b.transportOnce.Do(func() {
		if b.conn != nil {
			b.transportErr = b.conn.Close()
		}
	})
}
func (b *pqFreshScopeBroker) seal(cause error) {
	b.mu.Lock()
	if b.first == nil {
		b.first = cause
	}
	b.sealed = true
	sources := make([]*pqProtectedSourceParent, 0, len(b.records))
	for _, r := range b.records {
		if r.source != nil {
			sources = append(sources, r.source)
		}
	}
	b.mu.Unlock()
	b.stopRead()
	for _, source := range sources {
		source.cancel(context.Canceled, sourceParentFailure{reason: 4})
	}
}

// Close seals NEW offers only; it retains and joins every same-scope actual
// worker before releasing local FD custody. It never stops the stable Node.
func (b *pqFreshScopeBroker) Close(ctx context.Context) error {
	if b == nil {
		return nil
	}
	if ctx == nil {
		return errFreshScopeBroker
	}
	b.seal(context.Canceled)
	select {
	case <-b.done:
	case <-ctx.Done():
		return errors.Join(errFreshScopeBroker, ctx.Err())
	}
	b.mu.Lock()
	records := make([]*pqFreshScopeRecord, 0, len(b.records))
	for _, r := range b.records {
		records = append(records, r)
	}
	b.mu.Unlock()
	for _, r := range records {
		select {
		case <-r.done:
		case <-ctx.Done():
			return errors.Join(errFreshScopeBroker, ctx.Err())
		}
	}
	b.cleanupOnce.Do(func() {
		b.closeTransport()
		b.cleanupErr = b.transportErr
		if b.original.brokerFile != nil {
			b.cleanupErr = errors.Join(b.cleanupErr, b.original.brokerFile.Close())
			b.original.brokerFile = nil
		}
		for _, r := range records {
			b.cleanupErr = errors.Join(b.cleanupErr, r.first)
		}
	})
	// The original startup exclusively closes its initial v3-compatible owner;
	// this broker closes only its own port and fresh per-scope owners.
	return errors.Join(b.failure(), b.cleanupErr)
}

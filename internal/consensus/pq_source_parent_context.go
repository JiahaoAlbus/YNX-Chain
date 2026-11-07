//go:build linux || darwin

// Package consensus files in this directory are private Core adoption source.
// They are not an exported P09 Source API. Core integrates the same files into
// its owning consensus package beside the actual c943 private callpoint.
package consensus

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const sourceParentFrameMax = 1040

var errSourceParent = errors.New("original protected Source parent unavailable or already consumed")
var errSourceParentLoss = errors.New("original Source parent transport lost; remote completion unknown")

type sourceParentSelection struct {
	generation, deadlineMs, minimumHeight         uint64
	canonicalOwner, chainID, sourceID, instanceID string
}
type sourceParentFailure struct {
	present bool
	code    int32
	reason  uint32
}

func (e sourceParentFailure) Error() string {
	return fmt.Sprintf("original Source parent canceled present=%t code=%d reason=%d", e.present, e.code, e.reason)
}

type pqProtectedSourceParent struct {
	mu                                  sync.Mutex
	process                             context.Context
	original                            *pqOriginalSourceLaunch
	selection                           sourceParentSelection
	originalDeadline, effectiveDeadline time.Time
	done, readerDone                    chan struct{}
	conn                                *net.UnixConn
	first                               error
	ctxErr                              error
	terminal, consumed                  bool
	timer                               *time.Timer
	stopProcess                         func() bool
}

func (p *pqProtectedSourceParent) Deadline() (time.Time, bool)      { return p.effectiveDeadline, true }
func (p *pqProtectedSourceParent) Done() <-chan struct{}            { return p.done }
func (p *pqProtectedSourceParent) Err() error                       { p.mu.Lock(); defer p.mu.Unlock(); return p.ctxErr }
func (p *pqProtectedSourceParent) Value(key any) any                { return p.process.Value(key) }
func (p *pqProtectedSourceParent) cause() error                     { p.mu.Lock(); defer p.mu.Unlock(); return p.first }
func (p *pqProtectedSourceParent) originalSourceDeadlineMs() uint64 { return p.selection.deadlineMs }
func (p *pqProtectedSourceParent) cancel(ctxErr, cause error) {
	p.mu.Lock()
	if p.terminal {
		p.mu.Unlock()
		return
	}
	p.terminal = true
	p.ctxErr = ctxErr
	if p.first == nil {
		p.first = cause
	}
	close(p.done)
	timer := p.timer
	p.mu.Unlock()
	if timer != nil {
		timer.Stop()
	}
	if p.conn != nil {
		_ = p.conn.Close()
	}
}
func sourceText(s string, max int) bool {
	if len(s) == 0 || len(s) > max || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func sourceCanonical(s string) bool {
	if len(s) != 42 || s[:2] != "0x" {
		return false
	}
	for _, c := range s[2:] {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func readSourceFrame(r io.Reader) (byte, []byte, error) {
	var h [16]byte
	if _, err := io.ReadFull(r, h[:]); err != nil {
		return 0, nil, err
	}
	n := binary.BigEndian.Uint32(h[12:])
	if string(h[:8]) != "YNXSPAR1" || binary.BigEndian.Uint16(h[8:10]) != 1 || h[11] != 0 || n > 1024 || (h[10] != 1 && h[10] != 2) {
		return 0, nil, errSourceParent
	}
	b := make([]byte, int(n))
	_, err := io.ReadFull(r, b)
	return h[10], b, err
}
func decodeSourceBind(b []byte, generation uint64) (sourceParentSelection, error) {
	var s sourceParentSelection
	if len(b) < 72 {
		return s, errSourceParent
	}
	s.generation = binary.BigEndian.Uint64(b[:8])
	s.deadlineMs = binary.BigEndian.Uint64(b[8:16])
	s.minimumHeight = binary.BigEndian.Uint64(b[16:24])
	s.canonicalOwner = string(b[24:66])
	if s.generation == 0 || s.generation != generation || s.deadlineMs == 0 || s.deadlineMs > math.MaxInt64 || s.minimumHeight == 0 || !sourceCanonical(s.canonicalOwner) {
		return s, errSourceParent
	}
	a, c, d := int(binary.BigEndian.Uint16(b[66:68])), int(binary.BigEndian.Uint16(b[68:70])), int(binary.BigEndian.Uint16(b[70:72]))
	if a < 1 || a > 128 || c < 1 || c > 128 || d < 1 || d > 128 || len(b) != 72+a+c+d {
		return s, errSourceParent
	}
	s.chainID = string(b[72 : 72+a])
	s.sourceID = string(b[72+a : 72+a+c])
	s.instanceID = string(b[72+a+c:])
	if !sourceText(s.chainID, 128) || !sourceText(s.sourceID, 128) || !sourceText(s.instanceID, 128) {
		return s, errSourceParent
	}
	return s, nil
}
func decodeSourceCancel(b []byte, generation uint64) (sourceParentFailure, error) {
	var f sourceParentFailure
	if len(b) != 20 || binary.BigEndian.Uint64(b[:8]) != generation || generation == 0 || binary.BigEndian.Uint32(b[8:12]) > 1 {
		return f, errSourceParent
	}
	f = sourceParentFailure{binary.BigEndian.Uint32(b[8:12]) == 1, int32(binary.BigEndian.Uint32(b[12:16])), binary.BigEndian.Uint32(b[16:20])}
	if f.reason < 1 || f.reason > 5 {
		return f, errSourceParent
	}
	return f, nil
}

// Only the same verified original Core bootstrap calls this private receiver.
// This is not a constructor accepting public fields, callbacks or an FD setter.
func receiveOriginalSourceParent(process context.Context, original *pqOriginalSourceLaunch) (*pqProtectedSourceParent, error) {
	return receiveOriginalSourceParentWithReadContext(process, process, original)
}

// readCtx may interrupt ONLY the initial BIND read; all post-BIND lifetime,
// original capture seal and process-loss guard keep the actual Node process.
func receiveOriginalSourceParentWithReadContext(process, readCtx context.Context, original *pqOriginalSourceLaunch) (*pqProtectedSourceParent, error) {
	if process == nil || readCtx == nil || original == nil {
		return nil, errSourceParent
	}
	if err := original.claimSourceParent(process); err != nil {
		return nil, err
	}
	conn := original.sourceConn
	stop := context.AfterFunc(readCtx, func() { _ = conn.Close() })
	kind, b, err := readSourceFrame(conn)
	if readCtx.Err() != nil {
		stop()
		_ = conn.Close()
		return nil, readCtx.Err()
	}
	if err != nil {
		stop()
		_ = conn.Close()
		return nil, errors.Join(errSourceParentLoss, err)
	}
	if err = original.check(process); err != nil {
		stop()
		_ = conn.Close()
		return nil, err
	}
	if kind == 2 {
		f, e := decodeSourceCancel(b, original.generation)
		stop()
		_ = conn.Close()
		if e != nil {
			return nil, e
		}
		return nil, f
	}
	selection, err := decodeSourceBind(b, original.generation)
	if err != nil {
		stop()
		_ = conn.Close()
		return nil, err
	}
	stop()
	p := armOriginalSourceClock(process, selection, conn)
	p.original = original // same private capture, never another Source/port tuple
	original.mu.Lock()
	original.sourceContext = p // sealed only after original capture/BIND checks
	original.mu.Unlock()
	go func() {
		defer close(p.readerDone)
		kind, b, e := readSourceFrame(conn)
		if e != nil {
			p.cancel(context.Canceled, errors.Join(errSourceParentLoss, e))
			return
		}
		if e = original.checkControlIdentity(process); e != nil {
			p.cancel(context.Canceled, e)
			return
		}
		if kind != 2 {
			p.cancel(context.Canceled, errSourceParent)
			return
		}
		f, e := decodeSourceCancel(b, selection.generation)
		if e != nil {
			p.cancel(context.Canceled, e)
			return
		}
		p.cancel(context.Canceled, f)
	}()
	return p, nil
}

// A private clock alone is not a qualified Source. Only receiveOriginalSourceParent
// can couple the original capture and this exact context. Ordinary contexts and
// wrappers cannot select different transport cleanup semantics.
func (p *pqProtectedSourceParent) ownsOriginalCapture() bool {
	if p == nil || p.original == nil || p.conn == nil {
		return false
	}
	o := p.original
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.sourceClaimed && o.sourceContext == p && o.sourceConn == p.conn && o.generation == p.selection.generation
}

func (p *pqProtectedSourceParent) cleanupOnly() bool {
	if !p.ownsOriginalCapture() || p.process.Err() != nil {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.terminal || errors.Is(p.first, errSourceParentLoss) {
		return false
	}
	var originalFailure sourceParentFailure
	return errors.As(p.first, &originalFailure) || errors.Is(p.first, context.DeadlineExceeded)
}

// armOriginalSourceClock is called only AFTER protected qualification/BIND.
// Unit controls may inspect the timer, but it is not an authority factory.
func armOriginalSourceClock(process context.Context, selection sourceParentSelection, conn *net.UnixConn) *pqProtectedSourceParent {
	deadline := time.UnixMilli(int64(selection.deadlineMs))
	effective := deadline
	if parent, ok := process.Deadline(); ok && parent.Before(effective) {
		effective = parent
	}
	p := &pqProtectedSourceParent{process: process, selection: selection, originalDeadline: deadline, effectiveDeadline: effective, done: make(chan struct{}), readerDone: make(chan struct{}), conn: conn}
	p.mu.Lock()
	p.timer = time.AfterFunc(time.Until(effective), func() { p.cancel(context.DeadlineExceeded, context.DeadlineExceeded) })
	p.mu.Unlock()
	p.stopProcess = context.AfterFunc(process, func() {
		e := process.Err()
		if e == nil {
			e = context.Canceled
		}
		p.cancel(e, e)
	})
	if err := process.Err(); err != nil {
		p.cancel(err, err)
	} else if !effective.After(time.Now()) {
		p.cancel(context.DeadlineExceeded, context.DeadlineExceeded)
	}
	return p
}

func (p *pqProtectedSourceParent) closeLocal() error {
	p.cancel(context.Canceled, context.Canceled)
	<-p.readerDone
	if p.stopProcess != nil {
		p.stopProcess()
	}
	return p.cause()
}

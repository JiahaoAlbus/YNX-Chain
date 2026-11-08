//go:build darwin && cgo

package productreadsource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"golang.org/x/sys/unix"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// PUBLIC fixture only: an independently tested actual OS boundary, not a
// normal Root row. Production NEVER derives expected from this observer.
func publicShopOwnedExpected(t *testing.T) securelink.LocalCallerExpectedProcess {
	t.Helper()
	exe, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	exe, e = filepath.EvalSymlinks(exe)
	if e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile(exe)
	if e != nil || len(raw) == 0 || len(raw) > 128<<20 {
		t.Fatal("PUBLIC image", e)
	}
	info, e := unix.SysctlKinfoProc("kern.proc.pid", os.Getpid())
	if e != nil {
		t.Fatal(e)
	}
	return securelink.LocalCallerExpectedProcess{UID: uint32(os.Geteuid()), PID: os.Getpid(), StartKind: securelink.LocalCallerDarwinProcessStart, StartA: uint64(info.Proc.P_starttime.Sec), StartB: uint64(info.Proc.P_starttime.Usec), ImagePath: exe, ImageBytes: uint64(len(raw)), ImageSHA256: sha256.Sum256(raw)}
}

func TestShopOwnedExchangeActualSameSocketAndRelease(t *testing.T) {
	c, calls := publicShopClient(t, publicReply)
	if e := c.captureIndependentServerExpected(publicShopOwnedExpected(t)); e != nil {
		t.Fatal(e)
	}
	r, e := c.readOriginalAtObserved(c.ctx, "order-001")
	if e != nil || r == nil || r.exchange == nil {
		t.Fatal("same actual exchange", e)
	}
	if calls.Load() != 1 || !bytes.Equal(r.original.Body, publicShopBody) {
		t.Fatal("original packet/attempt")
	}
	life := r.exchange.Lifetime()
	if !life.Peer.SameOriginalConnection || !life.Peer.ProcessIdentityAvailable {
		t.Fatalf("wrong original connection %+v", life)
	}
	if life.Peer.TerminalEOFObserved && life.Peer.LivenessProved {
		t.Fatal("FIN promoted to liveness")
	}
	if _, done := c.Close(); done || c.source.children.Load() != 1 {
		t.Fatal("premature Source release")
	}
	if e, done := r.Release(); e != nil || !done {
		t.Fatal("owned cleanup", e, done)
	}
	if e := r.exchange.AssertOriginalClosed(); e != nil {
		t.Fatal("missing physical witness", e)
	}
	if c.source.children.Load() != 0 {
		t.Fatal("Source child debt")
	}
	if e, done := c.Close(); e != nil || !done {
		t.Fatal("parent close", e, done)
	}
	if calls.Load() != 1 {
		t.Fatal("cleanup replayed GET")
	}
}
func TestShopOwnedExchangeWrongRegisteredStartAndImage(t *testing.T) {
	for _, kind := range []string{"start", "image", "missing"} {
		t.Run(kind, func(t *testing.T) {
			c, calls := publicShopClient(t, publicReply)
			expected := publicShopOwnedExpected(t)
			switch kind {
			case "start":
				expected.StartA++
			case "image":
				expected.ImageSHA256[0] ^= 1
			case "missing":
				expected = securelink.LocalCallerExpectedProcess{}
				c.expectedPeer = securelink.LocalCallerExpectedProcess{} // PUBLIC fixture: model new constructor before any selected row
			}
			if kind == "missing" {
				if e := c.captureIndependentServerExpected(expected); e == nil {
					t.Fatal("missing reviewed expectation accepted")
				}
			} else if e := c.captureIndependentServerExpected(expected); e != nil {
				t.Fatal(e)
			}
			r, e := c.readOriginalAtObserved(c.ctx, "order-001")
			if e == nil || r == nil || r.exchange == nil {
				t.Fatal("owned partial lost", e)
			}
			if calls.Load() != 0 {
				t.Fatal("bad registered identity dispatched")
			}
			if _, done := r.Release(); !done {
				t.Fatal("actual failed partial did not close")
			}
			if e := r.exchange.AssertOriginalClosed(); e != nil {
				t.Fatal(e)
			}
			if _, done := c.Close(); !done {
				t.Fatal("parent failure debt")
			}
		})
	}
}
func TestShopOwnedExchangeLateSourceRevokeRetainsBody(t *testing.T) {
	c, calls := publicShopClient(t, func(w http.ResponseWriter, r *http.Request, a *Authority) { a.Retire(); publicReply(w, r, a) })
	if e := c.captureIndependentServerExpected(publicShopOwnedExpected(t)); e != nil {
		t.Fatal(e)
	}
	r, first := c.readOriginalAtObserved(c.ctx, "order-001")
	if first == nil || r == nil || r.exchange == nil || !bytes.Equal(r.original.Body, publicShopBody) {
		t.Fatal("late original dropped", first)
	}
	if _, e := r.ReadOriginalTransportDATA(); e == nil {
		t.Fatal("revoked Source published")
	}
	if _, done := r.Release(); !done {
		t.Fatal("late cleanup")
	}
	if e := r.exchange.AssertOriginalClosed(); e != nil {
		t.Fatal(e)
	}
	if e, done := c.Close(); !done || e != first {
		t.Fatal("first vs physical", e, first, done)
	}
	if calls.Load() != 1 {
		t.Fatal("second GET")
	}
}

// The normal zeroarg factory still refuses before any server identity or HTTP.
func TestShopOwnedExchangeEmptyRootEarlyRefusal(t *testing.T) {
	c, e := OpenOriginalShopPrivateClient(context.Background())
	if c == nil || e == nil {
		t.Fatal("Root-empty normal constructor")
	}
	if c.expectedPeer != (securelink.LocalCallerExpectedProcess{}) {
		t.Fatal("default peer was fabricated")
	}
	if _, done := c.Close(); !done {
		t.Fatal("Root-empty partial cleanup")
	}
}

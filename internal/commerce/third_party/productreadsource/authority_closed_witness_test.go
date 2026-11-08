package productreadsource

import (
	"context"
	"errors"
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
	"testing"
)

type publicZeroCloseError struct{ Code int }

func (e *publicZeroCloseError) Error() string { return "PUBLIC original code-zero failure" }
func publicFDParent(t *testing.T) (*Authority, *originalFile) {
	t.Helper()
	home, e := os.UserHomeDir()
	if e != nil {
		t.Fatal(e)
	}
	dir, e := os.MkdirTemp(filepath.Join(home, ".codex"), "PUBLIC-shop-parent-FD-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	path := filepath.Join(dir, "PUBLIC.original")
	raw := []byte("PUBLIC original Root-file fixture only")
	if e = os.WriteFile(path, raw, 0600); e != nil {
		t.Fatal(e)
	}
	a := &Authority{parent: context.Background(), changed: make(chan struct{}, 1), files: originalFiles{uid: uint32(os.Geteuid())}}
	if _, e = a.files.hold(path, rawDigest(raw), int64(len(raw))); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { a.files.close() })
	return a, a.files.files[0]
}
func TestShopV4ParentWitnessDoneFirstZeroAndSourceFailure(t *testing.T) {
	for _, first := range []error{&publicZeroCloseError{0}, errors.New("PUBLIC prior Source verification failure")} {
		a, f := publicFDParent(t)
		a.first = first
		a.files.first = first
		if e := a.Close(); e != first {
			t.Fatal("first replaced", e)
		}
		if e := a.AssertOriginalClosed(); e != nil {
			t.Fatal("actual FD done + first must release map", e)
		}
		if !f.closeCalled || !f.closeReturned || !f.closeDone || f.closeUnknown {
			t.Fatal("actual nil OS close not recorded")
		}
		if e := a.Close(); e != first {
			t.Fatal(e)
		}
		if e := a.AssertOriginalClosed(); e != nil {
			t.Fatal(e)
		}
	}
}
func TestShopV4ParentWitnessChildrenAndOwnerPhase(t *testing.T) {
	a, f := publicFDParent(t)
	a.children.Store(1)
	if e := a.Close(); !errors.Is(e, ErrPending) {
		t.Fatal(e)
	}
	if a.closed || a.files.closeSelected || f.closeCalled {
		t.Fatal("child debt cannot select FD close")
	}
	if e := a.AssertOriginalClosed(); !errors.Is(e, ErrPending) {
		t.Fatal(e)
	}
	a.children.Store(0)
	if e := a.Close(); e != nil {
		t.Fatal(e)
	}
	if e := a.AssertOriginalClosed(); e != nil {
		t.Fatal(e)
	}
	partial := &Authority{parent: context.Background(), changed: make(chan struct{}, 1)}
	partial.closed = true
	if e := partial.AssertOriginalClosed(); !errors.Is(e, ErrPending) {
		t.Fatal("a.closed alone cannot prove physical close", e)
	}
}
func TestShopV4ParentWitnessZeroAndNilRefuse(t *testing.T) {
	var a *Authority
	if !errors.Is(a.AssertOriginalClosed(), ErrDenied) {
		t.Fatal("nil witness")
	}
	a = &Authority{}
	if !errors.Is(a.Close(), ErrDenied) || !errors.Is(a.AssertOriginalClosed(), ErrDenied) {
		t.Fatal("zero Authority cannot panic/prove closed")
	}
}
func TestShopV4ParentWitnessForeignFDNotClosedOrRetried(t *testing.T) {
	a, f := publicFDParent(t)
	fd := int(f.file.Fd())
	if e := unix.Close(fd); e != nil {
		t.Fatal(e)
	}
	foreignPath := filepath.Join(filepath.Dir(f.path), "PUBLIC.foreign")
	if e := os.WriteFile(foreignPath, []byte("PUBLIC foreign owner"), 0600); e != nil {
		t.Fatal(e)
	}
	foreign, e := os.Open(foreignPath)
	if e != nil {
		t.Fatal(e)
	}
	if int(foreign.Fd()) != fd {
		foreign.Close()
		t.Fatal("PUBLIC same-number FD fixture did not reuse exact FD")
	}
	// The foreign file belongs to this test, NOT the original Source. Teardown
	// closes it first, then closes the obsolete wrapper before any new FD opens.
	defer func() { foreign.Close(); f.file.Close() }()
	if e = a.Close(); e == nil {
		t.Fatal("foreign descriptor must fail original identity")
	}
	if !f.closeUnknown || f.closeCalled || f.closeDone {
		t.Fatal("must refuse before physical close dispatch")
	}
	if e = a.AssertOriginalClosed(); !errors.Is(e, ErrUnknown) {
		t.Fatal(e)
	}
	if _, e = foreign.Stat(); e != nil {
		t.Fatal("original close touched foreign FD", e)
	}
	first := a.first
	for i := 0; i < 5; i++ {
		if e = a.Close(); e != first {
			t.Fatal(e)
		}
		if e = a.AssertOriginalClosed(); !errors.Is(e, ErrUnknown) {
			t.Fatal(e)
		}
	}
	if _, e = foreign.Stat(); e != nil {
		t.Fatal("unknown close retried foreign FD", e)
	}
}

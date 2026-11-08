//go:build (darwin || linux) && auth_public_fd_close_controls

package productreadsource

import (
	"errors"
	"os"
	"testing"
)

func TestShopV4ParentWitnessCloseCodeZeroUnknownNoRetry(t *testing.T) {
	for _, late := range []bool{false, true} {
		a, f := publicFDParent(t)
		first := &publicZeroCloseError{0}
		calls := 0
		originalPUBLICFDclose = func(file *os.File) error {
			if file == f.file {
				calls++
				if late {
					if e := file.Close(); e != nil {
						t.Fatal(e)
					}
				}
				return first
			}
			return file.Close()
		}
		e := a.Close()
		originalPUBLICFDclose = nil
		if !errors.Is(e, ErrUnknown) || !errors.Is(e, first) {
			t.Fatal("parent must retain original code zero + unknown", e)
		}
		if calls != 1 || !f.closeCalled || !f.closeReturned || f.closeDone || !f.closeUnknown {
			t.Fatal("OS error cannot be classified as completion")
		}
		for i := 0; i < 4; i++ {
			if !errors.Is(a.AssertOriginalClosed(), ErrUnknown) {
				t.Fatal("witness cleared unknown")
			}
			_ = a.Close()
		}
		if calls != 1 {
			t.Fatal("selected UNKNOWN close was replayed")
		}
		// PUBLIC fixture owns this process-local test FD; this is not a production
		// original-owner retry or a claim that its earlier UNKNOWN was resolved.
		if !late {
			f.file.Close()
		}
	}
}

func TestShopV4ParentWitnessDirectoryCloseUnknownIsIndependent(t *testing.T) {
	a, f := publicFDParent(t)
	d := a.files.dirs[len(a.files.dirs)-1]
	first := &publicZeroCloseError{0}
	calls := 0
	originalPUBLICFDclose = func(file *os.File) error {
		if file == d.file {
			calls++
			if e := file.Close(); e != nil {
				t.Fatal(e)
			}
			return first
		}
		return file.Close()
	}
	e := a.Close()
	originalPUBLICFDclose = nil
	if !errors.Is(e, first) || !f.closeDone || !d.closeUnknown || d.closeDone || !d.closeReturned || calls != 1 {
		t.Fatal("file done must not mask directory UNKNOWN", e)
	}
	for i := 0; i < 4; i++ {
		if !errors.Is(a.AssertOriginalClosed(), ErrUnknown) {
			t.Fatal("directory debt ignored")
		}
		_ = a.Close()
	}
	if calls != 1 {
		t.Fatal("directory close redispatched")
	}
}

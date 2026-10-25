package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPQMemberCaseStreamingExecutablePinRetainsChecks(t *testing.T) {
	dir, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	raw := []byte("original executable bytes for hashing only; never executed")
	path := filepath.Join(dir, "original")
	if e = os.WriteFile(path, raw, 0700); e != nil {
		t.Fatal(e)
	}
	pin := pqCaseTestSHA(raw)
	if e = verifyPQCaseExecutablePin(path, pin, 1024); e != nil {
		t.Fatal(e)
	}
	if _, e = readPQCasePinned(path, pin, 1024, true); e != nil {
		t.Fatal("original comparison rejected same bytes", e)
	}
	for name, check := range map[string]func() error{
		"pin":         func() error { return verifyPQCaseExecutablePin(path, pqCaseTestSHA([]byte("other")), 1024) },
		"bound":       func() error { return verifyPQCaseExecutablePin(path, pin, int64(len(raw)-1)) },
		"relative":    func() error { return verifyPQCaseExecutablePin("original", pin, 1024) },
		"invalid-pin": func() error { return verifyPQCaseExecutablePin(path, "", 1024) },
	} {
		t.Run(name, func(t *testing.T) {
			if check() == nil {
				t.Fatal("streaming removed original rejection")
			}
		})
	}
	link := filepath.Join(dir, "link")
	os.Symlink(path, link)
	if verifyPQCaseExecutablePin(link, pin, 1024) == nil {
		t.Fatal("symlink accepted")
	}
	os.Chmod(path, 0600)
	if verifyPQCaseExecutablePin(path, pin, 1024) == nil {
		t.Fatal("non-executable accepted")
	}
	os.Chmod(path, 0722)
	if verifyPQCaseExecutablePin(path, pin, 1024) == nil {
		t.Fatal("group/other writable accepted")
	}
	os.Chmod(path, 0700)
	os.WriteFile(path, []byte("changed"), 0700)
	if verifyPQCaseExecutablePin(path, pin, 1024) == nil {
		t.Fatal("changed bytes accepted")
	}
}

// Same original executable, external SHA, bounds and GOMAXPROCS/GOMEMLIMIT.
// This measures checksum-only overhead, not consensus proof or chain TPS.
func BenchmarkPQMemberCaseExecutablePin(b *testing.B) {
	path := os.Getenv("YNX_PERF_PQ_PROOF_VERIFIER")
	if path == "" {
		b.Skip("requires original verifier executable for paired checksum measurement")
	}
	path, e := filepath.EvalSymlinks(path)
	if e != nil {
		b.Fatal(e)
	}
	raw, e := os.ReadFile(path)
	if e != nil {
		b.Fatal(e)
	}
	pin, size := pqCaseTestSHA(raw), int64(len(raw))
	raw = nil
	b.Run("before-readall", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(size)
		for i := 0; i < b.N; i++ {
			if _, e := readPQCasePinned(path, pin, 128<<20, true); e != nil {
				b.Fatal(e)
			}
		}
	})
	b.Run("after-stream", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(size)
		for i := 0; i < b.N; i++ {
			if e := verifyPQCaseExecutablePin(path, pin, 128<<20); e != nil {
				b.Fatal(e)
			}
		}
	})
}

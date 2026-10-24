package developerauthority

// Actual held-file pinner, not a hash cache or replacement file admission.
// PUBLIC ordinary data files only; never an executable/Root/key fixture.
import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func r231HeldFile(t *testing.T) (verifierHeldFile, string) {
	t.Helper()
	home, e := os.UserHomeDir()
	if e != nil {
		t.Fatal(e)
	}
	dir, e := os.MkdirTemp(home, ".ynx-auth-pin-stream-PUBLIC-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	path := filepath.Join(dir, "PUBLIC-data-not-executable")
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	chunk := make([]byte, 65536)
	for i := range chunk {
		chunk[i] = byte(i % 251)
	}
	digest := sha256.New()
	for range 64 {
		if _, e = f.Write(chunk); e != nil {
			t.Fatal(e)
		}
		digest.Write(chunk)
	}
	if e = f.Close(); e != nil {
		t.Fatal(e)
	}
	h, e := verifierOpen(OriginalVerifierFile{Path: path, Bytes: 4 << 20, SHA256: hex.EncodeToString(digest.Sum(nil))})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { h.file.Close() })
	return h, path
}
func TestR231HeldPinStreamsAllBytesWithBoundedAllocation(t *testing.T) {
	h, _ := r231HeldFile(t)
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	e := h.check()
	runtime.ReadMemStats(&after)
	if e != nil {
		t.Fatal(e)
	}
	allocated := after.TotalAlloc - before.TotalAlloc
	t.Logf("PUBLIC 4MiB complete exact-held-file hash allocated=%d bytes", allocated)
	if allocated > 512<<10 {
		t.Fatalf("full-file verification materializes unbounded image buffers: %d > 512KiB", allocated)
	}
}
func TestR231HeldPinStillChecksLastByteSizeAndNamedIdentity(t *testing.T) {
	t.Run("last-byte", func(t *testing.T) {
		h, p := r231HeldFile(t)
		f, e := os.OpenFile(p, os.O_WRONLY, 0)
		if e != nil {
			t.Fatal(e)
		}
		defer f.Close()
		if _, e = f.WriteAt([]byte{255}, h.pin.Bytes-1); e != nil {
			t.Fatal(e)
		}
		if e = h.check(); e == nil {
			t.Fatal("last byte hash bypassed")
		}
	})
	t.Run("append", func(t *testing.T) {
		h, p := r231HeldFile(t)
		f, e := os.OpenFile(p, os.O_WRONLY|os.O_APPEND, 0)
		if e != nil {
			t.Fatal(e)
		}
		defer f.Close()
		f.Write([]byte{1})
		if e = h.check(); e == nil {
			t.Fatal("size drift")
		}
	})
	t.Run("symlink-substitution", func(t *testing.T) {
		h, p := r231HeldFile(t)
		other := p + ".held"
		if e := os.Rename(p, other); e != nil {
			t.Fatal(e)
		}
		if e := os.Symlink(other, p); e != nil {
			t.Fatal(e)
		}
		if e := h.check(); e == nil {
			t.Fatal("named inode bypassed")
		}
		if _, e := h.file.Seek(0, io.SeekStart); e != nil {
			t.Fatal("original FD lost")
		}
	})
}

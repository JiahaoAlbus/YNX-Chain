package developerauthority

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"testing"
)

// Low-level actual held-FD I/O only. These PUBLIC temporary files never qualify
// the protected Source/Node constructor or bypass its ancestor policy.
func streamingPublicFile(t *testing.T, size int64) (*os.File, OriginalVerifierFile) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "PUBLIC-pinned-bytes")
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = f.Close() })
	block := bytes.Repeat([]byte{0x5a}, 64<<10)
	digest := sha256.New()
	for left := size; left > 0; {
		n := int64(len(block))
		if left < n {
			n = left
		}
		if _, e = f.Write(block[:n]); e != nil {
			t.Fatal(e)
		}
		digest.Write(block[:n])
		left -= n
	}
	if e = f.Sync(); e != nil {
		t.Fatal(e)
	}
	return f, OriginalVerifierFile{path, size, hex.EncodeToString(digest.Sum(nil))}
}
func TestOriginalIDEFactoryStreamingPinnerFullBytesBoundedAllocation(t *testing.T) {
	f, pin := streamingPublicFile(t, 32<<20)
	scratch := make([]byte, 64<<10)
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	if e := verifierDigestHeld(f, pin, scratch); e != nil {
		t.Fatal(e)
	}
	runtime.ReadMemStats(&after)
	allocated := after.TotalAlloc - before.TotalAlloc
	t.Logf("PUBLIC_STREAMING_PIN bytes=%d allocatedBytes=%d", pin.Bytes, allocated)
	if allocated > 2<<20 {
		t.Fatalf("full-file growing allocation remains: %d bytes for %d-byte pin", allocated, pin.Bytes)
	}
	var one [1]byte
	if _, e := f.ReadAt(one[:], pin.Bytes-1); e != nil {
		t.Fatal("borrowed descriptor was closed", e)
	}
}
func TestOriginalIDEFactoryStreamingPinnerEveryByteAndLengthStillVerified(t *testing.T) {
	for _, mutation := range []string{"last-byte", "append", "truncate"} {
		t.Run(mutation, func(t *testing.T) {
			f, pin := streamingPublicFile(t, 192<<10)
			scratch := bytes.Repeat([]byte{0xaa}, 64<<10)
			switch mutation {
			case "last-byte":
				if _, e := f.WriteAt([]byte{1}, pin.Bytes-1); e != nil {
					t.Fatal(e)
				}
			case "append":
				if _, e := f.WriteAt([]byte{1}, pin.Bytes); e != nil {
					t.Fatal(e)
				}
			case "truncate":
				if e := f.Truncate(pin.Bytes - 1); e != nil {
					t.Fatal(e)
				}
			}
			if e := verifierDigestHeld(f, pin, scratch); e == nil {
				t.Fatal("changed complete original accepted")
			}
			if !bytes.Equal(scratch, make([]byte, len(scratch))) {
				t.Fatal("scratch retained bytes after rejection")
			}
		})
	}
}
func TestOriginalIDEFactoryStreamingPinnerIdentityCtimeAndNamedReplacement(t *testing.T) {
	f, pin := streamingPublicFile(t, 64<<10)
	before, e := f.Stat()
	if e != nil {
		t.Fatal(e)
	}
	original := before.Sys().(*syscall.Stat_t)
	if e = f.Chmod(0400); e != nil {
		t.Fatal(e)
	}
	if e = f.Chmod(0600); e != nil {
		t.Fatal(e)
	}
	if e = os.Chtimes(pin.Path, before.ModTime(), before.ModTime()); e != nil {
		t.Fatal(e)
	}
	changed, e := f.Stat()
	if e != nil {
		t.Fatal(e)
	}
	if verifierStableStat(original, changed.Sys().(*syscall.Stat_t)) {
		t.Fatal("restored mode/mtime concealed changed ctime")
	}
	alias := pin.Path + "-hardlink"
	if e = os.Link(pin.Path, alias); e != nil {
		t.Fatal(e)
	}
	linked, e := f.Stat()
	if e != nil {
		t.Fatal(e)
	}
	if verifierStableStat(changed.Sys().(*syscall.Stat_t), linked.Sys().(*syscall.Stat_t)) {
		t.Fatal("hardlink drift accepted")
	}
	if e = os.Remove(alias); e != nil {
		t.Fatal(e)
	}
	retained := pin.Path + "-original"
	if e = os.Rename(pin.Path, retained); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink(retained, pin.Path); e != nil {
		t.Fatal(e)
	}
	named, e := os.Lstat(pin.Path)
	if e != nil {
		t.Fatal(e)
	}
	if verifierStableStat(original, named.Sys().(*syscall.Stat_t)) {
		t.Fatal("named symlink replacement accepted")
	}
}
func TestOriginalIDEFactoryStreamingPinnerConcurrentBorrowedFDNoOffsetOrClose(t *testing.T) {
	f, pin := streamingPublicFile(t, 64<<10)
	if _, e := f.Seek(7, io.SeekStart); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	fail := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); fail <- verifierDigestHeld(f, pin, make([]byte, 64<<10)) }()
	}
	wg.Wait()
	close(fail)
	for e := range fail {
		if e != nil {
			t.Fatal(e)
		}
	}
	pos, e := f.Seek(0, io.SeekCurrent)
	if e != nil || pos != 7 {
		t.Fatal("borrowed FD offset/custody changed", pos, e)
	}
}

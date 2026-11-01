//go:build linux || darwin

package taskactionv6

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestPinsRejectSymlinkAndFIFOWithoutFollowingOrBlocking(t *testing.T) {
	dir, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	p, body := filepath.Join(dir, "original"), []byte("PUBLIC")
	if os.WriteFile(p, body, 0600) != nil {
		t.Fatal("write")
	}
	hash := sha256.Sum256(body)
	pin := FilePin{Bytes: int64(len(body)), SHA256: hex.EncodeToString(hash[:])}
	if e := verifyFile(context.Background(), p, pin); e != nil {
		t.Fatal(e)
	}
	link := filepath.Join(dir, "alias")
	if os.Symlink(p, link) != nil {
		t.Fatal("symlink")
	}
	if verifyFile(context.Background(), link, pin) == nil {
		t.Fatal("symlink accepted")
	}
	fifo := filepath.Join(dir, "fifo")
	if syscall.Mkfifo(fifo, 0600) != nil {
		t.Fatal("fifo")
	}
	if verifyFile(context.Background(), fifo, pin) == nil {
		t.Fatal("FIFO accepted")
	}
}

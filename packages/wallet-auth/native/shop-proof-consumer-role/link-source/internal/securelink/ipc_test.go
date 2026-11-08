//go:build linux || darwin

package securelink

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLINK01PrivateIPCChecksOSPeerAndDirectory(t *testing.T) {
	dir, err := os.MkdirTemp("", "yl-ipc-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "s")
	uid := uint32(os.Geteuid())
	listener, err := ListenPrivate(path, uid)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	accepted := make(chan error, 1)
	go func() {
		c, e := listener.Accept()
		if e == nil {
			e = checkPeerUID(c, uid)
			_ = c.Close()
		}
		accepted <- e
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	conn, err := DialPrivate(ctx, path, uid)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err = <-accepted; err != nil {
		t.Fatal(err)
	}
	if err = checkPeerUID(conn, uid+1); !errors.Is(err, ErrDenied) {
		t.Fatal("wrong OS principal accepted", err)
	}
	if _, err = DialPrivate(ctx, path, uid+1); err == nil {
		t.Fatal("wrong socket owner accepted")
	}
	if _, err = ListenPrivate(path, uid); err == nil {
		t.Fatal("existing endpoint was overwritten")
	}
	if err = os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err = NewIPCBackend(path, uid); !errors.Is(err, ErrDenied) {
		t.Fatal("public IPC directory accepted", err)
	}
}
func TestLINK01IPCRejectsNonSocketAndSymlinkParent(t *testing.T) {
	dir, err := os.MkdirTemp("", "yl-ipc-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	_ = os.Chmod(dir, 0700)
	path := filepath.Join(dir, "file")
	if err = os.WriteFile(path, []byte("not a socket"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = DialPrivate(context.Background(), path, uint32(os.Geteuid())); !errors.Is(err, ErrDenied) {
		t.Fatal("non-socket accepted", err)
	}
	alias := dir + "-link"
	if err = os.Symlink(dir, alias); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(alias)
	if _, err = ListenPrivate(filepath.Join(alias, "sock"), uint32(os.Geteuid())); !errors.Is(err, ErrDenied) {
		t.Fatal("symlink parent accepted", err)
	}
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	if err = checkPeerUID(a, uint32(os.Geteuid())); !errors.Is(err, ErrDenied) {
		t.Fatal("non-OS connection authenticated", err)
	}
}

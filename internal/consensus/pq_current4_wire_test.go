//go:build linux || darwin

package consensus

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"net"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func current4Socketpair(t *testing.T) (*os.File, *net.UnixConn) {
	t.Helper()
	fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if err != nil {
		t.Fatal(err)
	}
	left := os.NewFile(uintptr(fds[0]), "PUBLIC Current4 server")
	right := os.NewFile(uintptr(fds[1]), "PUBLIC Current4 client")
	c, err := net.FileConn(right)
	_ = right.Close()
	if err != nil {
		_ = left.Close()
		t.Fatal(err)
	}
	u := c.(*net.UnixConn)
	t.Cleanup(func() { _ = left.Close(); _ = u.Close() })
	if err = u.SetDeadline(time.Now().Add(15 * time.Second)); err != nil {
		t.Fatal(err)
	}
	return left, u
}
func current4Frame(op byte, seq uint64, body []byte) []byte {
	b := make([]byte, 24+len(body))
	copy(b, "YNC4")
	binary.BigEndian.PutUint16(b[4:6], 1)
	b[6] = 1
	b[7] = op
	binary.BigEndian.PutUint64(b[8:16], seq)
	binary.BigEndian.PutUint32(b[16:20], uint32(len(body)))
	copy(b[24:], body)
	return b
}
func current4Exchange(t *testing.T, c *net.UnixConn, op byte, seq uint64, body []byte) []byte {
	t.Helper()
	if _, err := c.Write(current4Frame(op, seq, body)); err != nil {
		t.Fatal(err)
	}
	h := make([]byte, 24)
	if _, err := io.ReadFull(c, h); err != nil {
		t.Fatal("actual Current4 response", err)
	}
	if !bytes.Equal(h[:4], []byte("YNC4")) || binary.BigEndian.Uint16(h[4:6]) != 1 || h[6] != 2 || h[7] != op || binary.BigEndian.Uint64(h[8:16]) != seq || binary.BigEndian.Uint32(h[20:]) != 0 {
		t.Fatal("response header differs")
	}
	n := binary.BigEndian.Uint32(h[16:20])
	if n < 8 || n > pqCurrent4PolicyMax+66 {
		t.Fatal("response bound")
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(c, b); err != nil {
		t.Fatal(err)
	}
	if binary.BigEndian.Uint32(b[:4]) != 0 || binary.BigEndian.Uint32(b[4:8]) > 1 {
		t.Fatal("invented error code/presence")
	}
	return b
}
func current4Expect(t *testing.T, b []byte, size int, denied bool, extra uint32) {
	t.Helper()
	present := uint32(0)
	if denied {
		present = 1
	}
	if len(b) != size || binary.BigEndian.Uint32(b[4:8]) != present {
		t.Fatal("wire result shape or independent error presence differs")
	}
	if size == 12 && binary.BigEndian.Uint32(b[8:]) != extra {
		t.Fatal("owner/drain bit differs")
	}
}

func TestPQCurrent4WirePUBLICStrictFramesAndOSPeer(t *testing.T) {
	t.Run("independent_peer", func(t *testing.T) {
		f, _ := current4Socketpair(t)
		peer := pqCurrent4Peer{uint32(os.Getuid()), int32(os.Getpid())}
		if err := pqCurrent4CheckEndpoint(f, peer); err != nil {
			t.Fatal("actual socketpair OS credentials", err)
		}
		for _, bad := range []pqCurrent4Peer{{peer.uid ^ 1, peer.pid}, {peer.uid, peer.pid + 1}, {peer.uid, 0}} {
			if pqCurrent4CheckEndpoint(f, bad) == nil {
				t.Fatal("wrong independent peer accepted")
			}
		}
		file, err := os.CreateTemp(t.TempDir(), "not-socket")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		if pqCurrent4CheckEndpoint(file, peer) == nil {
			t.Fatal("regular descriptor admitted")
		}
	})
	valid := current4Frame(pqCurrent4Capture, 1, append(make([]byte, 32), []byte("0xae45b350fbc6f5e66aa18c43fe464f0c5229a7e0")...))
	cases := map[string]func([]byte) []byte{
		"magic":                       func(b []byte) []byte { b[0] ^= 1; return b },
		"version":                     func(b []byte) []byte { b[5] = 2; return b },
		"kind":                        func(b []byte) []byte { b[6] = 2; return b },
		"op":                          func(b []byte) []byte { b[7] = 7; return b },
		"reserved":                    func(b []byte) []byte { b[23] = 1; return b },
		"zero_sequence":               func(b []byte) []byte { b[15] = 0; return b },
		"gap_sequence":                func(b []byte) []byte { b[15] = 2; return b },
		"wrapped_sequence":            func(b []byte) []byte { binary.BigEndian.PutUint64(b[8:16], math.MaxUint64); return b },
		"huge_body_before_allocation": func(b []byte) []byte { binary.BigEndian.PutUint32(b[16:20], math.MaxUint32); return b[:24] },
		"wrong_capture_size":          func(b []byte) []byte { b[19] = 73; return b },
		"read_before_capture":         func(b []byte) []byte { return current4Frame(pqCurrent4Read, 1, make([]byte, 8)) },
		"trailing":                    func(b []byte) []byte { return append(b, 1) },
		"pipelined":                   func(b []byte) []byte { return append(b, current4Frame(pqCurrent4Current, 2, nil)...) },
		"truncated_header":            func(b []byte) []byte { return b[:12] },
		"truncated_body":              func(b []byte) []byte { return b[:50] },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			f, c := current4Socketpair(t)
			conn, err := net.FileConn(f)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			w := &pqCurrent4Wire{conn: conn.(*net.UnixConn)}
			if _, err = c.Write(mutate(bytes.Clone(valid))); err != nil {
				t.Fatal(err)
			}
			if name == "truncated_header" || name == "truncated_body" {
				_ = c.CloseWrite()
			}
			if _, _, _, err = w.request(); err == nil {
				t.Fatal("malformed frame admitted")
			}
			if w.sequence != 0 {
				t.Fatal("malformed input consumed a future operation")
			}
		})
	}
	t.Run("SCM_RIGHTS_refused_and_not_retained", func(t *testing.T) {
		f, c := current4Socketpair(t)
		conn, err := net.FileConn(f)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		pipe, err := os.Open(os.DevNull)
		if err != nil {
			t.Fatal(err)
		}
		defer pipe.Close()
		if _, _, err = c.WriteMsgUnix(valid, unix.UnixRights(int(pipe.Fd())), nil); err != nil {
			t.Fatal(err)
		}
		w := &pqCurrent4Wire{conn: conn.(*net.UnixConn)}
		if _, _, _, err = w.request(); !errors.Is(err, errPQCurrent4Frame) {
			t.Fatal("ancillary descriptor admitted", err)
		}
	})
}

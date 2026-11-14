//go:build linux || darwin

package consensus

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// DATA vector for P09 writeBootstrap/writeBrokerBootstrap's existing layout.
// These invented coordinates can only be decoded, never qualify an OS launch.
func freshLaunchDATA(version uint16) []byte {
	var b bytes.Buffer
	put := func(v any) { _ = binary.Write(&b, binary.BigEndian, v) }
	put(uint32(10))
	put(uint64(7))
	put(uint64(1))
	put(uint64(10))
	for i := 0; i < 3; i++ {
		start, path := "start", fmt.Sprintf("/PUBLIC/image-%d", i)
		put(uint32(100 + i))
		put(uint32(501))
		put(uint16(len(start)))
		put(uint16(len(path)))
		b.Write(bytes.Repeat([]byte{byte(i + 1)}, 32))
		b.WriteString(start)
		b.WriteString(path)
	}
	for i := uint32(1); i <= 2; i++ {
		put(i)
		put(uint32(10 + i))
		put(uint64(1))
		put(uint64(10 + i))
	}
	if version == 4 {
		put(uint32(3))
		put(uint32(13))
		put(uint64(1))
		put(uint64(13))
		put(uint32(4))
		put(uint32(0))
		put(uint64(0))
		put(uint64(0))
	}
	raw := make([]byte, 16)
	copy(raw, "YNC4LCH1")
	binary.BigEndian.PutUint16(raw[8:10], version)
	raw[10] = 1
	binary.BigEndian.PutUint32(raw[12:], uint32(b.Len()))
	return append(raw, b.Bytes()...)
}

func TestPQOriginalSourceLaunchVersionsDATA(t *testing.T) {
	for _, version := range []uint16{3, 4} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			raw := freshLaunchDATA(version)
			original, fresh, err := decodeOriginalSourceLaunch(raw, pqOriginalSourceProfile{}, 0)
			if err != nil || original == nil || original.generation != 7 || (fresh != nil) != (version == 4) {
				t.Fatal("original version DATA", err)
			}
			if original.sourceConn != nil || original.current4File != nil || original.profile.codeProfile != nil {
				t.Fatal("decoder adopted/authorized DATA")
			}
			if _, _, err = decodeOriginalSourceLaunch(raw, pqOriginalSourceProfile{}, version); err != nil {
				t.Fatal(err)
			}
			if _, _, err = decodeOriginalSourceLaunch(raw, pqOriginalSourceProfile{}, 7-version); err == nil {
				t.Fatal("version-specific entry accepted other version")
			}
			if err = original.check(context.Background()); err == nil {
				t.Fatal("DATA acquired CODE authority")
			}
			for n := 0; n < len(raw); n++ {
				if _, _, err = decodeOriginalSourceLaunch(raw[:n], pqOriginalSourceProfile{}, 0); err == nil {
					t.Fatalf("accepted truncation %d", n)
				}
			}
		})
	}
	for _, tc := range []struct {
		name   string
		change func([]byte) []byte
	}{
		{"unknown-version", func(b []byte) []byte { binary.BigEndian.PutUint16(b[8:], 5); return b }},
		{"wrong-role", func(b []byte) []byte { b[10] = 2; return b }},
		{"reserved", func(b []byte) []byte { b[11] = 1; return b }},
		{"broker-fd-alias", func(b []byte) []byte { binary.BigEndian.PutUint32(b[len(b)-44:], 10); return b }},
		{"broker-object-alias", func(b []byte) []byte { binary.BigEndian.PutUint64(b[len(b)-32:], 10); return b }},
		{"broker-wrong-purpose", func(b []byte) []byte { binary.BigEndian.PutUint32(b[len(b)-48:], 1); return b }},
		{"stop-fd", func(b []byte) []byte { binary.BigEndian.PutUint32(b[len(b)-20:], 14); return b }},
		{"stop-device", func(b []byte) []byte { binary.BigEndian.PutUint64(b[len(b)-16:], 1); return b }},
		{"stop-inode", func(b []byte) []byte { binary.BigEndian.PutUint64(b[len(b)-8:], 1); return b }},
		{"stop-purpose", func(b []byte) []byte { binary.BigEndian.PutUint32(b[len(b)-24:], 3); return b }},
		{"trailing", func(b []byte) []byte {
			b = append(b, 0)
			binary.BigEndian.PutUint32(b[12:], uint32(len(b)-16))
			return b
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := decodeOriginalSourceLaunch(tc.change(freshLaunchDATA(4)), pqOriginalSourceProfile{}, 0); err == nil {
				t.Fatal("accepted malformed closed v4")
			}
		})
	}
}

func freshWirePair(t *testing.T) (*net.UnixConn, *net.UnixConn) {
	t.Helper()
	fds, e := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if e != nil {
		t.Fatal(e)
	}
	var pair [2]*net.UnixConn
	for i, fd := range fds {
		f := os.NewFile(uintptr(fd), "PUBLIC unnamed broker")
		c, err := net.FileConn(f)
		_ = f.Close()
		if err != nil {
			t.Fatal(err)
		}
		pair[i] = c.(*net.UnixConn)
		t.Cleanup(func() { _ = c.Close() })
		_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	}
	return pair[0], pair[1]
}
func freshWireFrame(kind byte) []byte {
	n := 16
	if kind == 1 {
		n = 48
	}
	b := make([]byte, 16+n)
	copy(b, "YNXSBKR1")
	binary.BigEndian.PutUint16(b[8:], 1)
	b[10] = kind
	binary.BigEndian.PutUint32(b[12:], uint32(n))
	binary.BigEndian.PutUint64(b[16:], 7)
	binary.BigEndian.PutUint64(b[24:], 1)
	return b
}

func TestPQFreshScopeBrokerWireDATA(t *testing.T) {
	for _, tc := range []struct {
		name string
		kind byte
		fds  int
		bad  bool
	}{
		{"offer-two-owned", 1, 2, false}, {"query-no-fds", 3, 0, false}, {"offer-missing", 1, 0, true}, {"offer-extra", 1, 3, true}, {"query-rights", 3, 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			receiver, sender := freshWirePair(t)
			var supplied []*os.File
			var rights []int
			for i := 0; i < tc.fds; i++ {
				f, e := os.CreateTemp(t.TempDir(), "PUBLIC-fd")
				if e != nil {
					t.Fatal(e)
				}
				defer f.Close()
				supplied = append(supplied, f)
				rights = append(rights, int(f.Fd()))
			}
			var oob []byte
			if len(rights) > 0 {
				oob = unix.UnixRights(rights...)
			}
			if _, _, e := sender.WriteMsgUnix(freshWireFrame(tc.kind), oob, nil); e != nil {
				t.Fatal(e)
			}
			frame, e := readPQFreshFrame(receiver)
			if (e != nil) != tc.bad {
				t.Fatalf("shape error=%v", e)
			}
			if len(frame.files) != tc.fds {
				t.Fatal("failed parser lost actual received FD closing custody")
			}
			for _, fd := range frame.files {
				flags, err := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0)
				if err != nil || flags&unix.FD_CLOEXEC == 0 {
					t.Fatal("received FD not held/CLOEXEC", err)
				}
			}
			closePQFreshReceived(frame.files)
			for _, fd := range frame.files {
				var st unix.Stat_t
				if err := unix.Fstat(fd, &st); !errors.Is(err, unix.EBADF) {
					t.Fatal("received FD not closed", err)
				}
			}
			for _, f := range supplied {
				if _, err := f.Stat(); err != nil {
					t.Fatal("receiver closed supplier's distinct FD", err)
				}
			}
		})
	}
	t.Run("truncated-frame-retains-rights", func(t *testing.T) {
		receiver, sender := freshWirePair(t)
		f, e := os.CreateTemp(t.TempDir(), "PUBLIC")
		if e != nil {
			t.Fatal(e)
		}
		defer f.Close()
		if _, _, e = sender.WriteMsgUnix(freshWireFrame(1)[:9], unix.UnixRights(int(f.Fd())), nil); e != nil {
			t.Fatal(e)
		}
		_ = sender.Close()
		frame, e := readPQFreshFrame(receiver)
		defer closePQFreshReceived(frame.files)
		if e == nil || len(frame.files) != 1 {
			t.Fatal("partial frame lost descriptor", e)
		}
	})
	t.Run("wrong-magic", func(t *testing.T) {
		receiver, sender := freshWirePair(t)
		b := freshWireFrame(3)
		b[0] = 'x'
		_, _ = sender.Write(b)
		if _, e := readPQFreshFrame(receiver); e == nil {
			t.Fatal("magic")
		}
	})
	t.Run("actual-result-failure-zero", func(t *testing.T) {
		receiver, sender := freshWirePair(t)
		done := make(chan error, 1)
		go func() { done <- writePQFreshResult(sender, 7, 2, 3, sourceParentFailure{present: true, code: 0}, 4) }()
		b := make([]byte, 48)
		if _, e := io.ReadFull(receiver, b); e != nil {
			t.Fatal(e)
		}
		if e := <-done; e != nil {
			t.Fatal(e)
		}
		if string(b[:8]) != "YNXSBKR1" || b[10] != 2 || binary.BigEndian.Uint64(b[24:]) != 2 || binary.BigEndian.Uint32(b[36:]) != 1 || binary.BigEndian.Uint32(b[40:]) != 0 || binary.BigEndian.Uint32(b[44:]) != 4 {
			t.Fatal("failure present/code0 changed")
		}
		if _, e := encodePQFreshResult(7, 2, 3, sourceParentFailure{code: 1}, 4); e == nil {
			t.Fatal("absent failure nonzero code accepted")
		}
	})
}

func TestPQFreshScopeBrokerPartialCustodyDATA(t *testing.T) {
	t.Run("constructor-failure-is-joinable", func(t *testing.T) {
		fd, e := os.CreateTemp(t.TempDir(), "PUBLIC-unqualified")
		if e != nil {
			t.Fatal(e)
		}
		defer fd.Close()
		fresh := &pqOriginalFreshBrokerLaunch{original: &pqOriginalSourceLaunch{}, brokerFile: fd}
		b, e := newOriginalFreshScopeBroker(context.Background(), fresh)
		if b == nil || e == nil {
			t.Fatal("unqualified capture admitted")
		}
		first := e
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		e = b.Close(ctx)
		if !errors.Is(e, first) || errors.Is(e, context.DeadlineExceeded) {
			t.Fatal("partial constructor failed to close without started worker", e)
		}
		if _, e = fd.Stat(); !errors.Is(e, os.ErrClosed) {
			t.Fatal("original partial FD not closed", e)
		}
		if e = b.Close(ctx); !errors.Is(e, first) {
			t.Fatal("first cause lost on readback", e)
		}
	})
	t.Run("closed-history-never-evicts-unknown", func(t *testing.T) {
		first := errors.New("PUBLIC retained uncertainty")
		b := &pqFreshScopeBroker{records: make(map[uint64]*pqFreshScopeRecord)}
		for i := uint64(1); i <= 36; i++ {
			r := &pqFreshScopeRecord{id: i, done: make(chan struct{})}
			close(r.done)
			if i == 1 {
				r.first = first
			}
			b.records[i] = r
		}
		active := &pqFreshScopeRecord{id: 37, done: make(chan struct{})}
		b.records[37] = active
		b.pruneClosedLocked()
		if b.records[1] == nil || b.records[1].first != first || b.records[37] != active || len(b.records) != 34 {
			t.Fatal("active/UNKNOWN history discarded or unbounded")
		}
	})
	t.Run("versions-cannot-bypass-current", func(t *testing.T) {
		// This calls the actual capture, but deliberately has no real Auth actor.
		// Both versions must fail before touching stdin or adopting claimed FDs.
		old := os.Stdin
		defer func() { os.Stdin = old }()
		sourceBootstrapOnce.Lock()
		entered := sourceBootstrapOnce.entered
		sourceBootstrapOnce.Unlock()
		defer func() {
			sourceBootstrapOnce.Lock()
			sourceBootstrapOnce.entered = entered
			sourceBootstrapOnce.Unlock()
		}()
		profile := pqOriginalSourceProfile{images: [3]string{strings.Repeat("1", 64), strings.Repeat("2", 64), strings.Repeat("3", 64)}}
		for _, version := range []uint16{3, 4} {
			input, writer, e := os.Pipe()
			if e != nil {
				t.Fatal(e)
			}
			raw := freshLaunchDATA(version)
			if _, e = writer.Write(raw); e != nil {
				t.Fatal(e)
			}
			_ = writer.Close()
			os.Stdin = input
			sourceBootstrapOnce.Lock()
			sourceBootstrapOnce.entered = false
			sourceBootstrapOnce.Unlock()
			original, fresh, e := captureOriginalSourceLaunchVersions(context.Background(), context.Background(), profile, 0)
			if e == nil || original != nil || fresh != nil {
				t.Fatal("absent actual CODE was admitted")
			}
			remaining, e := io.ReadAll(input)
			_ = input.Close()
			if e != nil || !bytes.Equal(remaining, raw) {
				t.Fatal("unqualified capture consumed stdin", e)
			}
		}
	})
}

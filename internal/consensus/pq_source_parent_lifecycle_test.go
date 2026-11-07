//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// PUBLIC lifecycle fixture only. It installs the exact private pointer seal
// normally written by receiveOriginalSourceParent, without claiming to qualify
// an Auth Source or three production images. No public production constructor
// accepts this fixture, a bool, clock fields, or a supplied arbitrary FD.
func publicSealedSourceClock(t *testing.T, process context.Context, selection sourceParentSelection) *pqProtectedSourceParent {
	t.Helper()
	fd, _ := current4Socketpair(t)
	c, err := net.FileConn(fd)
	if err != nil {
		t.Fatal(err)
	}
	_ = fd.Close()
	conn := c.(*net.UnixConn)
	p := armOriginalSourceClock(process, selection, conn)
	original := &pqOriginalSourceLaunch{generation: selection.generation, sourceConn: conn, sourceClaimed: true, sourceContext: p}
	p.original = original
	t.Cleanup(func() {
		p.cancel(context.Canceled, context.Canceled)
		if p.stopProcess != nil {
			p.stopProcess()
		}
	})
	return p
}

func TestPQSourceParentPUBLICQualifiedCleanupAndLoss(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	for _, mode := range []string{"bare-private-clock", "ordinary-parent", "source-loss", "process-after-source-cancel", "explicit-owner-close"} {
		t.Run(mode, func(t *testing.T) {
			process, cancel := context.WithCancel(context.Background())
			defer cancel()
			selection := sourceParentSelection{generation: 1, deadlineMs: uint64(time.Now().Add(20 * time.Second).UnixMilli())}
			p := publicSealedSourceClock(t, process, selection)
			var parent context.Context = p
			if mode == "bare-private-clock" {
				parent = armOriginalSourceClock(process, selection, nil)
				if parent.(*pqProtectedSourceParent).ownsOriginalCapture() {
					t.Fatal("clock minted qualified capture")
				}
			}
			if mode == "ordinary-parent" {
				parent = process
			}
			w, conn := accountWireAttach(t, f, f.expected.Owner, parent)
			opened, _ := accountWireExchange(t, conn, pqAccountWireOpen, 1, [32]byte{})
			if opened.failure {
				t.Fatal("original account OPEN failed")
			}
			switch mode {
			case "source-loss":
				p.cancel(context.Canceled, errSourceParentLoss)
			case "process-after-source-cancel":
				p.cancel(context.Canceled, sourceParentFailure{present: true, code: 0, reason: 1})
				failed, _ := accountWireExchange(t, conn, pqAccountWireRead, 2, opened.reader)
				if !failed.failure {
					t.Fatal("retired Source remained productive")
				}
				cancel()
			case "explicit-owner-close":
				p.cancel(context.Canceled, sourceParentFailure{present: true, code: 0, reason: 1})
				_ = w.closeWalletPolicyAccountProofChild()
			default:
				cancel()
			}
			accountWireWait(t, w)
			if !accountWireHandler(t, w).IsClosed() {
				t.Fatal("loss/owner close retained reader debt")
			}
			if mode == "source-loss" && !errors.Is(w.cause(), errSourceParentLoss) {
				t.Fatal("Source transport loss replaced by secondary socket close", w.cause())
			}
			if mode == "process-after-source-cancel" || mode == "explicit-owner-close" {
				var first sourceParentFailure
				if !errors.As(w.cause(), &first) || !first.present || first.code != 0 {
					t.Fatal("Source failure0 replaced during physical cleanup", w.cause())
				}
			}
		})
	}
}

func TestPQSourceParentPUBLICOriginalUnnamedSocket(t *testing.T) {
	fd, _ := current4Socketpair(t)
	var st unix.Stat_t
	if err := unix.Fstat(int(fd.Fd()), &st); err != nil {
		t.Fatal(err)
	}
	stamp := sourcePortStamp{fd: int(fd.Fd()), device: uint64(st.Dev), inode: uint64(st.Ino)}
	identity := pqSourceProcessIdentity{PID: int32(os.Getpid()), UID: uint32(os.Getuid())}
	if err := checkSourceSocket(stamp, identity, identity); err != nil {
		t.Fatal("original unnamed pair rejected", err)
	}
	stamp.inode++
	if err := checkSourceSocket(stamp, identity, identity); !errors.Is(err, errSourceParent) {
		t.Fatal("changed original inode accepted", err)
	}
	// Independently observe this PUBLIC test process, not argv or bootstrap's
	// reported image. This is OS identity DATA, never a qualified Source profile.
	ctx := context.Background()
	actual, err := observePQSourceProcessIdentity(ctx, int32(os.Getpid()))
	if err != nil {
		t.Fatal("actual process identity", err)
	}
	if err = checkPQSourceProcessIdentity(ctx, actual); err != nil {
		t.Fatal("same held process identity", err)
	}
	for _, mode := range []string{"image-hash", "start-identity", "image-path", "uid", "canceled"} {
		t.Run(mode, func(t *testing.T) {
			changed := actual
			readCtx, cancel := context.WithCancel(ctx)
			defer cancel()
			switch mode {
			case "image-hash":
				changed.ImageSHA256 = strings.Repeat("0", 64)
			case "start-identity":
				changed.StartIdentity += "-changed"
			case "image-path":
				changed.ImagePath += ".other"
			case "uid":
				changed.UID++
			case "canceled":
				cancel()
			}
			if err := checkPQSourceProcessIdentity(readCtx, changed); err == nil {
				t.Fatal("changed original process identity accepted")
			}
		})
	}
}
